// routes/users.js — User management (admin only)
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { isAuthenticated, adminOnly, logAudit, getUserId } = require('../middleware/auth');

const router = express.Router();
router.use(isAuthenticated);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.login_id, u.email, u.full_name, u.role, u.is_active, u.avatar_url, u.last_login, u.created_at,
             json_agg(json_build_object('module', uar.module, 'access_type', uar.access_type)) FILTER (WHERE uar.id IS NOT NULL) as access_rights
      FROM users u
      LEFT JOIN user_access_rights uar ON uar.user_id = u.id
      GROUP BY u.id ORDER BY u.role, u.full_name
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { login_id, email, password, full_name, role, access_rights } = req.body;
    const hash = password ? await bcrypt.hash(password, 12) : null;

    const user = await client.query(`
      INSERT INTO users (login_id, email, password_hash, full_name, role)
      VALUES ($1,$2,$3,$4,$5) RETURNING id, login_id, email, full_name, role
    `, [login_id, email, hash, full_name, role || 'sales_user']);

    if (access_rights?.length) {
      for (const ar of access_rights) {
        await client.query(`INSERT INTO user_access_rights (user_id, module, access_type) VALUES ($1,$2,$3)`,
          [user.rows[0].id, ar.module, ar.access_type]);
      }
    }

    await logAudit({ tableName: 'users', recordId: user.rows[0].id, action: 'INSERT', description: `User created: ${login_id}`, userId: getUserId(req) });
    await client.query('COMMIT');
    res.status(201).json(user.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.put('/:id', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { full_name, role, is_active, password, access_rights } = req.body;

    const updates = [`full_name = COALESCE($1, full_name)`, `role = COALESCE($2, role)`, `is_active = COALESCE($3, is_active)`];
    const params = [full_name || null, role || null, is_active ?? null];

    if (password) { params.push(await bcrypt.hash(password, 12)); updates.push(`password_hash = $${params.length}`); }
    params.push(req.params.id);

    const result = await client.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, login_id, email, full_name, role, is_active`, params);

    if (access_rights !== undefined) {
      await client.query(`DELETE FROM user_access_rights WHERE user_id = $1`, [req.params.id]);
      for (const ar of access_rights) {
        await client.query(`INSERT INTO user_access_rights (user_id, module, access_type) VALUES ($1,$2,$3)`,
          [req.params.id, ar.module, ar.access_type]);
      }
    }

    await logAudit({ tableName: 'users', recordId: req.params.id, action: 'UPDATE', description: 'User updated', userId: getUserId(req) });
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.delete('/:id', adminOnly, async (req, res) => {
  try {
    if (req.params.id === getUserId(req)) return res.status(400).json({ error: 'Cannot deactivate yourself' });
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'users', recordId: req.params.id, action: 'DELETE', description: 'User deactivated', userId: getUserId(req) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
