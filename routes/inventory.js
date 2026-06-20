// routes/inventory.js — Stock ledger + adjustments
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();
router.use(isAuthenticated);

router.get('/', async (req, res) => {
  try {
    const { product_id, type, limit = 100, offset = 0 } = req.query;
    let where = [];
    const params = [];
    if (product_id) { params.push(product_id); where.push(`sl.product_id = $${params.length}`); }
    if (type) { params.push(type); where.push(`sl.movement_type = $${params.length}`); }
    params.push(parseInt(limit), parseInt(offset));
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await pool.query(`
      SELECT sl.*, pr.name as product_name, pr.sku, pr.product_type, u.full_name as created_by_name
      FROM stock_ledger sl
      JOIN products pr ON pr.id = sl.product_id
      LEFT JOIN users u ON u.id = sl.created_by
      ${wc}
      ORDER BY sl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ledger', async (req, res) => {
  try {
    const { product_id, type, limit = 100, offset = 0 } = req.query;
    let where = [];
    const params = [];
    if (product_id) { params.push(product_id); where.push(`sl.product_id = $${params.length}`); }
    if (type) { params.push(type); where.push(`sl.movement_type = $${params.length}`); }
    params.push(parseInt(limit), parseInt(offset));
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await pool.query(`
      SELECT sl.*, pr.name as product_name, pr.sku, pr.product_type, u.full_name as created_by_name
      FROM stock_ledger sl
      JOIN products pr ON pr.id = sl.product_id
      LEFT JOIN users u ON u.id = sl.created_by
      ${wc}
      ORDER BY sl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM stock_ledger sl ${wc}`, params.slice(0, -2));
    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active=true) as total_products,
        (SELECT COALESCE(SUM(on_hand_qty * cost_price),0) FROM products WHERE is_active=true) as total_stock_value,
        (SELECT COUNT(*) FROM products WHERE is_active=true AND on_hand_qty <= min_stock_level AND min_stock_level > 0) as low_stock_count,
        (SELECT COUNT(*) FROM products WHERE is_active=true AND on_hand_qty = 0) as out_of_stock,
        (SELECT COUNT(*) FROM stock_ledger WHERE created_at >= CURRENT_DATE) as movements_today
    `);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/low-stock', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, pp.reorder_point, pp.min_order_qty, pp.procurement_type, pp.strategy,
             pa.name as vendor_name
      FROM products p
      LEFT JOIN product_procurement pp ON pp.product_id = p.id
      LEFT JOIN parties pa ON pa.id = pp.vendor_party_id
      WHERE p.is_active = true AND (p.on_hand_qty <= p.min_stock_level AND p.min_stock_level > 0)
      ORDER BY (p.on_hand_qty - p.min_stock_level) ASC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
