// routes/analytics.js — Dashboard KPIs and chart data
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();
router.use(isAuthenticated);

router.get('/summary', async (req, res) => {
  try {
    const [
      products, parties, salesOrders, purchaseOrders, mfgOrders,
      stockValue, salesTotal, purchaseTotal, lowStock, workOrders, payments
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active FROM products`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE is_vendor) as vendors, COUNT(*) FILTER (WHERE is_customer) as customers FROM parties`),
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='confirmed') as confirmed, COUNT(*) FILTER (WHERE status='fully_delivered') as delivered, COUNT(*) FILTER (WHERE status='cancelled') as cancelled, COUNT(*) FILTER (WHERE status IN ('draft','confirmed','partially_delivered','payment_pending','payment_done')) as pending FROM sales_orders`),
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='confirmed') as confirmed, COUNT(*) FILTER (WHERE status='fully_received') as received, COUNT(*) FILTER (WHERE status='partially_received') as partial FROM purchase_orders`),
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='in_progress') as in_progress, COUNT(*) FILTER (WHERE status='completed') as completed, COUNT(*) FILTER (WHERE status='draft') as draft FROM manufacturing_orders`),
      pool.query(`SELECT COALESCE(SUM(on_hand_qty * cost_price),0) as total FROM products WHERE is_active=true`),
      pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM sales_orders WHERE status != 'cancelled'`),
      pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM purchase_orders WHERE status != 'cancelled'`),
      pool.query(`SELECT COUNT(*) as count FROM products WHERE on_hand_qty <= min_stock_level AND min_stock_level > 0 AND is_active = true`),
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='pending') as pending, COUNT(*) FILTER (WHERE status='completed') as completed FROM work_orders`),
      pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status='paid'`),
    ]);

    res.json({
      products: products.rows[0],
      parties: parties.rows[0],
      sales: { ...salesOrders.rows[0], total_revenue: salesTotal.rows[0].total },
      purchases: { ...purchaseOrders.rows[0], total_spent: purchaseTotal.rows[0].total },
      manufacturing: { ...mfgOrders.rows[0] },
      work_orders: workOrders.rows[0],
      stock: { total_value: stockValue.rows[0].total, low_stock_count: lowStock.rows[0].count },
      payments: { total_collected: payments.rows[0].total },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sales-trend', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const result = await pool.query(`
      SELECT DATE(order_date) as date, COUNT(*) as order_count, COALESCE(SUM(total_amount), 0) as revenue
      FROM sales_orders
      WHERE order_date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days' AND status != 'cancelled'
      GROUP BY DATE(order_date) ORDER BY date
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/product-types', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT product_type, COUNT(*) as count, COALESCE(SUM(on_hand_qty),0) as total_stock,
             COALESCE(SUM(on_hand_qty * cost_price),0) as stock_value
      FROM products WHERE is_active=true GROUP BY product_type
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mo-status', async (req, res) => {
  try {
    const result = await pool.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(quantity),0) as total_qty, COALESCE(SUM(produced_qty),0) as total_produced FROM manufacturing_orders GROUP BY status`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/top-products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.name, p.sku, p.product_type, p.on_hand_qty, p.cost_price, p.sales_price,
             (p.on_hand_qty * p.cost_price) as stock_value,
             (SELECT COALESCE(SUM(sol.quantity),0) FROM sales_order_lines sol WHERE sol.product_id = p.id) as total_sold
      FROM products p WHERE p.is_active=true
      ORDER BY stock_value DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const { limit = 100, table_name } = req.query;
    const params = [];
    let where = '';
    if (table_name) { params.push(table_name); where = `WHERE al.table_name = $1`; }
    params.push(parseInt(limit));

    const result = await pool.query(`
      SELECT al.*, u.full_name as user_name, u.role as user_role
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
