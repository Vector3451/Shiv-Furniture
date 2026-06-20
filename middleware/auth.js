// middleware/auth.js — Session authentication + role-based access control

const { pool } = require('../db');

// ── isAuthenticated ────────────────────────────────────────────────────────────
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Authentication required' });
}

// ── requireRole ───────────────────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user || req.session?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

// ── Admin only ────────────────────────────────────────────────────────────────
const adminOnly = requireRole('admin');

// ── Log audit ─────────────────────────────────────────────────────────────────
async function logAudit({ tableName, recordId, action, oldValues, newValues, description, userId, ipAddress, userAgent }) {
  try {
    await pool.query(`
      INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, description, user_id, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [tableName, recordId || null, action, oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null, description || null, userId || null, ipAddress || null, userAgent || null]);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

// ── getUser helper ────────────────────────────────────────────────────────────
function getUser(req) {
  return req.user || req.session?.user || null;
}

function getUserId(req) {
  const u = getUser(req);
  return u?.id || null;
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || null;
}

module.exports = { isAuthenticated, requireRole, adminOnly, logAudit, getUser, getUserId, getIp };
