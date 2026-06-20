// routes/auth.js — Google OAuth + local session auth
const express = require('express');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { logAudit, getIp } = require('../middleware/auth');

const router = express.Router();

// ── Google OAuth ────────────────────────────────────────────────────────────
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=oauth_failed' }),
  async (req, res) => {
    try {
      // Update last_login
      await pool.query(`UPDATE users SET last_login = now() WHERE id = $1`, [req.user.id]);
      await logAudit({ tableName: 'users', recordId: req.user.id, action: 'LOGIN', description: 'Google OAuth login', userId: req.user.id, ipAddress: getIp(req) });
      res.redirect('/app.html');
    } catch (err) {
      res.redirect('/login.html?error=login_failed');
    }
  }
);

// ── Local login (email/password fallback) ────────────────────────────────────
router.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await pool.query(`SELECT * FROM users WHERE email = $1 AND is_active = true`, [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (!user.password_hash) return res.status(401).json({ error: 'Please use Google Sign-In for this account' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    req.session.user = { id: user.id, email: user.email, full_name: user.full_name, role: user.role, avatar_url: user.avatar_url };

    await pool.query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
    await logAudit({ tableName: 'users', recordId: user.id, action: 'LOGIN', description: 'Local login', userId: user.id, ipAddress: getIp(req) });

    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────
router.post('/api/auth/logout', async (req, res) => {
  const userId = req.user?.id || req.session?.userId;
  if (userId) {
    try {
      await logAudit({ tableName: 'users', recordId: userId, action: 'LOGOUT', description: 'User logged out', userId, ipAddress: getIp(req) });
    } catch (e) {
      console.error(e);
    }
  }

  if (req.logout && typeof req.logout === 'function') {
    req.logout((err) => {
      if (req.session) {
        req.session.destroy((err2) => {
          res.json({ ok: true });
        });
      } else {
        res.json({ ok: true });
      }
    });
  } else {
    if (req.session) {
      req.session.destroy((err) => {
        res.json({ ok: true });
      });
    } else {
      res.json({ ok: true });
    }
  }
});

// ── Current user ─────────────────────────────────────────────────────────────
router.get('/api/auth/me', async (req, res) => {
  const user = req.user || req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await pool.query(`
      SELECT u.id, u.login_id, u.email, u.full_name, u.role, u.avatar_url, u.last_login,
             json_agg(json_build_object('module', uar.module, 'access_type', uar.access_type)) FILTER (WHERE uar.id IS NOT NULL) as access_rights
      FROM users u
      LEFT JOIN user_access_rights uar ON uar.user_id = u.id
      WHERE u.id = $1 GROUP BY u.id
    `, [user.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
