// routes/products.js — Full CRUD for Products + Procurement Config
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated, logAudit, getUserId, getIp } = require('../middleware/auth');
const stockService = require('../services/stockService');

const router = express.Router();
router.use(isAuthenticated);

// ── GET /api/products ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { type, search, limit = 100, offset = 0, active = 'true' } = req.query;
    let where = [];
    const params = [];

    if (active !== 'all') { where.push(`p.is_active = true`); }
    if (type) { params.push(type); where.push(`p.product_type = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(`
      SELECT p.*, pp.strategy, pp.procurement_type, pp.procure_on_demand, pp.vendor_party_id,
             pp.bom_id, pp.lead_time_days, pp.min_order_qty, pp.reorder_point,
             pa.name as vendor_name, b.name as bom_name
      FROM products p
      LEFT JOIN product_procurement pp ON pp.product_id = p.id
      LEFT JOIN parties pa ON pa.id = pp.vendor_party_id
      LEFT JOIN bom b ON b.id = pp.bom_id
      ${whereClause}
      ORDER BY p.name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM products p ${whereClause}`, params.slice(0, -2));
    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, pp.strategy, pp.procurement_type, pp.procure_on_demand, pp.vendor_party_id,
             pp.bom_id, pp.lead_time_days, pp.min_order_qty, pp.reorder_point
      FROM products p
      LEFT JOIN product_procurement pp ON pp.product_id = p.id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/products ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { name, sku, description, product_type, sales_price, cost_price, unit_of_measure,
            min_stock_level, opening_qty, strategy, procurement_type, procure_on_demand,
            vendor_party_id, bom_id, lead_time_days, min_order_qty, reorder_point } = req.body;

    const userId = getUserId(req);

    const prod = await client.query(`
      INSERT INTO products (name, sku, description, product_type, sales_price, cost_price, unit_of_measure, min_stock_level, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [name, sku, description || null, product_type || 'finished_good', sales_price || 0, cost_price || 0, unit_of_measure || 'units', min_stock_level || 0, userId]);

    const product = prod.rows[0];

    // Insert procurement config
    await client.query(`
      INSERT INTO product_procurement (product_id, strategy, procurement_type, procure_on_demand, vendor_party_id, bom_id, lead_time_days, min_order_qty, reorder_point)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [product.id, strategy || 'MTS', procurement_type || 'purchase', procure_on_demand || false,
        vendor_party_id || null, bom_id || null, lead_time_days || 0, min_order_qty || 1, reorder_point || 0]);

    // Opening stock entry
    if (opening_qty && parseFloat(opening_qty) > 0) {
      await client.query(`UPDATE products SET on_hand_qty = $1 WHERE id = $2`, [opening_qty, product.id]);
      await client.query(`
        INSERT INTO stock_ledger (product_id, movement_type, reference_type, quantity, unit_cost, running_balance, notes, created_by)
        VALUES ($1,'opening','opening',$2,$3,$2,'Opening stock entry',$4)
      `, [product.id, opening_qty, cost_price || 0, userId]);
    }

    await logAudit({ tableName: 'products', recordId: product.id, action: 'INSERT', newValues: product, userId, ipAddress: getIp(req) });
    await client.query('COMMIT');
    res.status(201).json(product);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── PUT /api/products/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { name, description, product_type, sales_price, cost_price, unit_of_measure,
            min_stock_level, is_active, strategy, procurement_type, procure_on_demand,
            vendor_party_id, bom_id, lead_time_days, min_order_qty, reorder_point } = req.body;
    const userId = getUserId(req);

    const old = await client.query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Product not found' });

    const result = await client.query(`
      UPDATE products SET name=$1, description=$2, product_type=$3, sales_price=$4, cost_price=$5,
        unit_of_measure=$6, min_stock_level=$7, is_active=$8
      WHERE id=$9 RETURNING *
    `, [name || old.rows[0].name, description ?? old.rows[0].description,
        product_type || old.rows[0].product_type, sales_price ?? old.rows[0].sales_price,
        cost_price ?? old.rows[0].cost_price, unit_of_measure || old.rows[0].unit_of_measure,
        min_stock_level ?? old.rows[0].min_stock_level, is_active ?? old.rows[0].is_active, req.params.id]);

    // Upsert procurement
    await client.query(`
      INSERT INTO product_procurement (product_id, strategy, procurement_type, procure_on_demand, vendor_party_id, bom_id, lead_time_days, min_order_qty, reorder_point)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (product_id) DO UPDATE SET
        strategy=EXCLUDED.strategy, procurement_type=EXCLUDED.procurement_type,
        procure_on_demand=EXCLUDED.procure_on_demand, vendor_party_id=EXCLUDED.vendor_party_id,
        bom_id=EXCLUDED.bom_id, lead_time_days=EXCLUDED.lead_time_days,
        min_order_qty=EXCLUDED.min_order_qty, reorder_point=EXCLUDED.reorder_point
    `, [req.params.id, strategy || 'MTS', procurement_type || 'purchase', procure_on_demand || false,
        vendor_party_id || null, bom_id || null, lead_time_days || 0, min_order_qty || 1, reorder_point || 0]);

    await logAudit({ tableName: 'products', recordId: req.params.id, action: 'UPDATE', oldValues: old.rows[0], newValues: result.rows[0], userId, ipAddress: getIp(req) });
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── DELETE /api/products/:id (soft delete) ────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(`UPDATE products SET is_active = false WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found' });
    await logAudit({ tableName: 'products', recordId: req.params.id, action: 'DELETE', description: 'Soft delete', userId: getUserId(req) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/products/:id/adjust-stock ──────────────────────────────────────
router.post('/:id/adjust-stock', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { quantity, reason } = req.body;
    const userId = getUserId(req);
    const qty = parseFloat(quantity);
    if (isNaN(qty)) return res.status(400).json({ error: 'Invalid quantity' });

    const result = await stockService.applyMovement({
      client, productId: req.params.id, movementType: 'adjustment',
      referenceType: 'adjustment', quantity: qty, notes: reason || 'Manual adjustment', userId
    });
    await logAudit({ tableName: 'products', recordId: req.params.id, action: 'ACTION', description: `Stock adjustment: ${qty > 0 ? '+' : ''}${qty} — ${reason}`, userId });
    await client.query('COMMIT');
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;
