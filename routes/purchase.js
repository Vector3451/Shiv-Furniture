// routes/purchase.js — Purchase Order lifecycle with goods receipt
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated, logAudit, getUserId } = require('../middleware/auth');
const stockService = require('../services/stockService');

const router = express.Router();
router.use(isAuthenticated);

router.get('/', async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    let where = [];
    const params = [];
    if (status) { params.push(status); where.push(`po.status = $${params.length}`); }
    params.push(parseInt(limit), parseInt(offset));
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await pool.query(`
      SELECT po.*, p.name as vendor_name, p.party_code, u.full_name as created_by_name,
             (SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id = po.id) as line_count
      FROM purchase_orders po
      JOIN parties p ON p.id = po.vendor_party_id
      LEFT JOIN users u ON u.id = po.created_by
      ${wc}
      ORDER BY po.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM purchase_orders po JOIN parties p ON p.id = po.vendor_party_id ${wc}`, params.slice(0, -2));
    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const po = await pool.query(`
      SELECT po.*, p.name as vendor_name, p.party_code, p.phone, p.email,
             u.full_name as created_by_name
      FROM purchase_orders po
      JOIN parties p ON p.id = po.vendor_party_id
      LEFT JOIN users u ON u.id = po.created_by
      WHERE po.id = $1
    `, [req.params.id]);
    if (!po.rows.length) return res.status(404).json({ error: 'PO not found' });

    const lines = await pool.query(`
      SELECT pol.*, pr.name as product_name, pr.sku, pr.unit_of_measure
      FROM purchase_order_lines pol
      JOIN products pr ON pr.id = pol.product_id
      WHERE pol.purchase_order_id = $1 ORDER BY pol.sequence_order
    `, [req.params.id]);

    res.json({ ...po.rows[0], lines: lines.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { vendor_party_id, expected_receipt, notes, lines } = req.body;
    if (!lines?.length) return res.status(400).json({ error: 'At least one line required' });

    const po = await client.query(`
      INSERT INTO purchase_orders (vendor_party_id, expected_receipt, notes, created_by)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [vendor_party_id, expected_receipt || null, notes || null, getUserId(req)]);

    for (let i = 0; i < lines.length; i++) {
      const { product_id, quantity, unit_price } = lines[i];
      await client.query(`
        INSERT INTO purchase_order_lines (purchase_order_id, product_id, quantity, unit_price, sequence_order)
        VALUES ($1,$2,$3,$4,$5)
      `, [po.rows[0].id, product_id, quantity, unit_price || 0, i + 1]);
    }

    await logAudit({ tableName: 'purchase_orders', recordId: po.rows[0].id, action: 'INSERT', description: 'PO created', userId: getUserId(req) });
    await client.query('COMMIT');
    res.status(201).json(po.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.post('/:id/confirm', async (req, res) => {
  try {
    const po = await pool.query(`SELECT * FROM purchase_orders WHERE id = $1`, [req.params.id]);
    if (!po.rows.length) return res.status(404).json({ error: 'PO not found' });
    if (po.rows[0].status !== 'draft') return res.status(400).json({ error: `Cannot confirm — status is ${po.rows[0].status}` });

    await pool.query(`UPDATE purchase_orders SET status = 'confirmed' WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'purchase_orders', recordId: req.params.id, action: 'UPDATE', description: 'PO confirmed', userId: getUserId(req) });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/receive', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { receipts } = req.body; // [{ line_id, qty }]
    const po = await client.query(`SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!po.rows.length) return res.status(404).json({ error: 'PO not found' });
    if (!['confirmed','partially_received'].includes(po.rows[0].status)) {
      return res.status(400).json({ error: `Cannot receive — status is ${po.rows[0].status}` });
    }

    for (const r of (receipts || [])) {
      const line = await client.query(`SELECT * FROM purchase_order_lines WHERE id = $1 AND purchase_order_id = $2`, [r.line_id, req.params.id]);
      if (!line.rows.length) continue;
      const l = line.rows[0];
      const receiveQty = Math.min(parseFloat(r.qty), parseFloat(l.quantity) - parseFloat(l.received_qty));
      if (receiveQty <= 0) continue;

      await client.query(`UPDATE purchase_order_lines SET received_qty = received_qty + $1 WHERE id = $2`, [receiveQty, r.line_id]);
      await stockService.applyMovement({ client, productId: l.product_id, movementType: 'purchase', referenceType: 'purchase_order', referenceId: req.params.id, quantity: receiveQty, unitCost: l.unit_price, notes: `Receipt for ${po.rows[0].order_number}`, userId: getUserId(req) });
    }

    const allLines = await client.query(`SELECT quantity, received_qty FROM purchase_order_lines WHERE purchase_order_id = $1`, [req.params.id]);
    const totalQty = allLines.rows.reduce((s, l) => s + parseFloat(l.quantity), 0);
    const totalRec = allLines.rows.reduce((s, l) => s + parseFloat(l.received_qty), 0);
    const newStatus = totalRec >= totalQty ? 'fully_received' : 'partially_received';

    await client.query(`UPDATE purchase_orders SET status = $1 WHERE id = $2`, [newStatus, req.params.id]);
    await logAudit({ tableName: 'purchase_orders', recordId: req.params.id, action: 'UPDATE', description: `Goods received — status: ${newStatus}`, userId: getUserId(req) });
    await client.query('COMMIT');
    res.json({ ok: true, status: newStatus, received: totalRec, total: totalQty });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const po = await pool.query(`SELECT * FROM purchase_orders WHERE id = $1`, [req.params.id]);
    if (!po.rows.length) return res.status(404).json({ error: 'PO not found' });
    if (['fully_received','cancelled'].includes(po.rows[0].status)) return res.status(400).json({ error: 'Cannot cancel' });

    await pool.query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'purchase_orders', recordId: req.params.id, action: 'UPDATE', description: 'PO cancelled', userId: getUserId(req) });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
