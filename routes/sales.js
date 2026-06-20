// routes/sales.js — Sales Order lifecycle with procurement & Razorpay
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated, logAudit, getUserId, getIp } = require('../middleware/auth');
const stockService = require('../services/stockService');
const procurement = require('../services/procurement');

const router = express.Router();
router.use(isAuthenticated);

// ── GET all sales orders ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, limit = 100, offset = 0, customer } = req.query;
    let where = [];
    const params = [];
    if (status) { params.push(status); where.push(`so.status = $${params.length}`); }
    if (customer) { params.push(`%${customer}%`); where.push(`p.name ILIKE $${params.length}`); }
    params.push(parseInt(limit), parseInt(offset));
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await pool.query(`
      SELECT so.*, p.name as customer_name, p.party_code, p.phone as customer_phone,
             u.full_name as created_by_name,
             (SELECT COUNT(*) FROM sales_order_lines WHERE sales_order_id = so.id) as line_count
      FROM sales_orders so
      JOIN parties p ON p.id = so.customer_party_id
      LEFT JOIN users u ON u.id = so.created_by
      ${wc}
      ORDER BY so.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM sales_orders so JOIN parties p ON p.id = so.customer_party_id ${wc}`, params.slice(0, -2));
    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET single SO with lines ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const so = await pool.query(`
      SELECT so.*, p.name as customer_name, p.party_code, p.phone, p.email, p.address,
             u.full_name as created_by_name
      FROM sales_orders so
      JOIN parties p ON p.id = so.customer_party_id
      LEFT JOIN users u ON u.id = so.created_by
      WHERE so.id = $1
    `, [req.params.id]);
    if (!so.rows.length) return res.status(404).json({ error: 'Sales order not found' });

    const lines = await pool.query(`
      SELECT sol.*, pr.name as product_name, pr.sku, pr.on_hand_qty, pr.free_to_use_qty, pr.unit_of_measure
      FROM sales_order_lines sol
      JOIN products pr ON pr.id = sol.product_id
      WHERE sol.sales_order_id = $1 ORDER BY sol.sequence_order
    `, [req.params.id]);

    res.json({ ...so.rows[0], lines: lines.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST create SO ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { customer_party_id, expected_delivery, notes, shipping_address, lines } = req.body;
    if (!lines?.length) return res.status(400).json({ error: 'At least one line item required' });

    const so = await client.query(`
      INSERT INTO sales_orders (customer_party_id, expected_delivery, notes, shipping_address, created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [customer_party_id, expected_delivery || null, notes || null, shipping_address || null, getUserId(req)]);

    for (let i = 0; i < lines.length; i++) {
      const { product_id, quantity, unit_price } = lines[i];
      await client.query(`
        INSERT INTO sales_order_lines (sales_order_id, product_id, quantity, unit_price, sequence_order)
        VALUES ($1,$2,$3,$4,$5)
      `, [so.rows[0].id, product_id, quantity, unit_price, i + 1]);
    }

    await logAudit({ tableName: 'sales_orders', recordId: so.rows[0].id, action: 'INSERT', description: `SO created`, userId: getUserId(req) });
    await client.query('COMMIT');

    // Fetch full SO
    const result = await pool.query(`SELECT so.*, p.name as customer_name FROM sales_orders so JOIN parties p ON p.id = so.customer_party_id WHERE so.id = $1`, [so.rows[0].id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST confirm SO ───────────────────────────────────────────────────────────
router.post('/:id/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const so = await client.query(`SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!so.rows.length) return res.status(404).json({ error: 'SO not found' });
    if (so.rows[0].status !== 'draft') return res.status(400).json({ error: `Cannot confirm — status is ${so.rows[0].status}` });

    const lines = await client.query(`SELECT * FROM sales_order_lines WHERE sales_order_id = $1`, [req.params.id]);
    const stockInfo = [];

    // Reserve stock for each line
    for (const line of lines.rows) {
      const result = await stockService.reserveStock({ client, productId: line.product_id, quantity: line.quantity });
      stockInfo.push({ product_id: line.product_id, reserved: result.reserved, shortage: result.shortage });
    }

    await client.query(`UPDATE sales_orders SET status = 'confirmed' WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'sales_orders', recordId: req.params.id, action: 'UPDATE', description: 'SO confirmed, stock reserved', userId: getUserId(req) });
    await client.query('COMMIT');

    // Trigger procurement async (for MTO products with shortage)
    const procActions = await procurement.triggerProcurement(req.params.id, getUserId(req));

    res.json({ ok: true, stock_info: stockInfo, procurement: procActions });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST deliver SO ───────────────────────────────────────────────────────────
router.post('/:id/deliver', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { deliveries } = req.body; // [{ line_id, qty }]
    const so = await client.query(`SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!so.rows.length) return res.status(404).json({ error: 'SO not found' });
    if (!['confirmed','payment_done','partially_delivered'].includes(so.rows[0].status)) {
      return res.status(400).json({ error: `Cannot deliver — status is ${so.rows[0].status}` });
    }

    for (const del of (deliveries || [])) {
      const line = await client.query(`SELECT * FROM sales_order_lines WHERE id = $1 AND sales_order_id = $2`, [del.line_id, req.params.id]);
      if (!line.rows.length) continue;
      const l = line.rows[0];
      const deliverQty = Math.min(parseFloat(del.qty), parseFloat(l.quantity) - parseFloat(l.delivered_qty));
      if (deliverQty <= 0) continue;

      await client.query(`UPDATE sales_order_lines SET delivered_qty = delivered_qty + $1 WHERE id = $2`, [deliverQty, del.line_id]);
      await stockService.consumeStock({ client, productId: l.product_id, quantity: deliverQty, movementType: 'sale', referenceType: 'sales_order', referenceId: req.params.id, notes: `Delivery for ${so.rows[0].order_number}`, userId: getUserId(req) });
    }

    // Recalculate status
    const allLines = await client.query(`SELECT quantity, delivered_qty FROM sales_order_lines WHERE sales_order_id = $1`, [req.params.id]);
    const totalQty = allLines.rows.reduce((s, l) => s + parseFloat(l.quantity), 0);
    const totalDel = allLines.rows.reduce((s, l) => s + parseFloat(l.delivered_qty), 0);
    const newStatus = totalDel >= totalQty ? 'fully_delivered' : 'partially_delivered';

    await client.query(`UPDATE sales_orders SET status = $1 WHERE id = $2`, [newStatus, req.params.id]);
    await logAudit({ tableName: 'sales_orders', recordId: req.params.id, action: 'UPDATE', description: `Delivery recorded — status: ${newStatus}`, userId: getUserId(req) });
    await client.query('COMMIT');
    res.json({ ok: true, status: newStatus, delivered: totalDel, total: totalQty });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST cancel SO ────────────────────────────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const so = await client.query(`SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!so.rows.length) return res.status(404).json({ error: 'SO not found' });
    if (['fully_delivered','cancelled'].includes(so.rows[0].status)) return res.status(400).json({ error: 'Cannot cancel this order' });

    // Release reserved stock
    const lines = await client.query(`SELECT * FROM sales_order_lines WHERE sales_order_id = $1`, [req.params.id]);
    for (const line of lines.rows) {
      const reservedPortion = parseFloat(line.quantity) - parseFloat(line.delivered_qty);
      if (reservedPortion > 0) {
        await stockService.releaseReservation({ client, productId: line.product_id, quantity: reservedPortion });
      }
    }

    await client.query(`UPDATE sales_orders SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'sales_orders', recordId: req.params.id, action: 'UPDATE', description: 'SO cancelled', userId: getUserId(req) });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── PUT update SO (draft only) ────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const so = await pool.query(`SELECT * FROM sales_orders WHERE id = $1`, [req.params.id]);
    if (!so.rows.length) return res.status(404).json({ error: 'SO not found' });
    if (so.rows[0].status !== 'draft') return res.status(400).json({ error: 'Can only edit draft orders' });
    const { expected_delivery, notes, shipping_address } = req.body;
    const result = await pool.query(`UPDATE sales_orders SET expected_delivery=$1, notes=$2, shipping_address=$3 WHERE id=$4 RETURNING *`,
      [expected_delivery, notes, shipping_address, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
