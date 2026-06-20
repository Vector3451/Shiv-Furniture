// routes/parties.js — CRUD for Customers & Vendors
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated, logAudit, getUserId, getIp } = require('../middleware/auth');

const router = express.Router();
router.use(isAuthenticated);

router.get('/', async (req, res) => {
  try {
    const { role, search, limit = 100, offset = 0 } = req.query;
    let where = ['p.is_active = true'];
    const params = [];
    if (role === 'vendor') where.push('p.is_vendor = true');
    if (role === 'customer') where.push('p.is_customer = true');
    if (search) { params.push(`%${search}%`); where.push(`(p.name ILIKE $${params.length} OR p.email ILIKE $${params.length})`); }
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM sales_orders WHERE customer_party_id = p.id) as sales_count,
        (SELECT COUNT(*) FROM purchase_orders WHERE vendor_party_id = p.id) as purchase_count
      FROM parties p
      WHERE ${where.join(' AND ')}
      ORDER BY p.name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM parties p WHERE ${where.join(' AND ')}`, params.slice(0, -2));
    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM parties WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Party not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, gstin, address, city, state, pincode, is_vendor, is_customer } = req.body;
    if (!is_vendor && !is_customer) return res.status(400).json({ error: 'Must be vendor or customer (or both)' });

    const result = await pool.query(`
      INSERT INTO parties (name, email, phone, gstin, address, city, state, pincode, is_vendor, is_customer, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [name, email || null, phone || null, gstin || null, address || null, city || null, state || null, pincode || null, !!is_vendor, !!is_customer, getUserId(req)]);

    await logAudit({ tableName: 'parties', recordId: result.rows[0].id, action: 'INSERT', newValues: result.rows[0], userId: getUserId(req) });
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const old = await pool.query(`SELECT * FROM parties WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Party not found' });
    const o = old.rows[0];
    const { name, email, phone, gstin, address, city, state, pincode, is_vendor, is_customer, is_active } = req.body;

    const result = await pool.query(`
      UPDATE parties SET name=$1, email=$2, phone=$3, gstin=$4, address=$5, city=$6, state=$7, pincode=$8,
        is_vendor=$9, is_customer=$10, is_active=$11
      WHERE id=$12 RETURNING *
    `, [name||o.name, email??o.email, phone??o.phone, gstin??o.gstin, address??o.address,
        city??o.city, state??o.state, pincode??o.pincode, is_vendor??o.is_vendor, is_customer??o.is_customer, is_active??o.is_active, req.params.id]);

    await logAudit({ tableName: 'parties', recordId: req.params.id, action: 'UPDATE', oldValues: o, newValues: result.rows[0], userId: getUserId(req) });
    res.json(result.rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE parties SET is_active = false WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'parties', recordId: req.params.id, action: 'DELETE', userId: getUserId(req) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
