// server.js — Mini ERP System — Full Express Application
// Run: npm run dev

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');

const { pool } = require('./db');
const jobQueue = require('./services/queue');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Passport Google OAuth setup ────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id_here') {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const googleId = profile.id;
      const avatar = profile.photos?.[0]?.value;
      const name = profile.displayName;

      // Find or create user
      let user = await pool.query(`SELECT * FROM users WHERE google_id = $1 OR email = $2`, [googleId, email]);

      if (!user.rows.length) {
        // Auto-create as sales_user; admin can promote later
        const loginId = `G${googleId.slice(0, 8)}`;
        user = await pool.query(`
          INSERT INTO users (login_id, email, google_id, avatar_url, full_name, role)
          VALUES ($1,$2,$3,$4,$5,'sales_user') RETURNING *
        `, [loginId, email, googleId, avatar, name]);
      } else {
        // Update google_id and avatar if linking
        await pool.query(`UPDATE users SET google_id=$1, avatar_url=$2 WHERE id=$3`, [googleId, avatar, user.rows[0].id]);
      }

      if (!user.rows[0].is_active) return done(null, false, { message: 'Account deactivated' });
      return done(null, user.rows[0]);
    } catch (err) { return done(err); }
  }));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query(`SELECT * FROM users WHERE id = $1 AND is_active = true`, [id]);
    done(null, result.rows[0] || false);
  } catch (err) { done(err); }
});

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.APP_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session with PostgreSQL store
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'mini-erp-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

app.use(passport.initialize());
app.use(passport.session());

// Attach session user to req.user if passport didn't (local login)
app.use((req, res, next) => {
  if (!req.user && req.session?.user) req.user = req.session.user;
  next();
});

// ── Static files ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Redirect root to login if not authenticated
app.get('/', (req, res) => {
  if (req.user) return res.redirect('/app.html');
  res.redirect('/login.html');
});

// Protect app.html
app.get('/app.html', (req, res, next) => {
  if (!req.user) return res.redirect('/login.html');
  next();
}, express.static(path.join(__dirname, 'public')));

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/parties', require('./routes/parties'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/purchase', require('./routes/purchase'));
app.use('/api/manufacturing', require('./routes/manufacturing'));
app.use('/api/bom', require('./routes/bom'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/analytics', require('./routes/analytics'));

// ── Work centers standalone ────────────────────────────────────────────────────
const { isAuthenticated } = require('./middleware/auth');
app.get('/api/work-centers', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM work_centers WHERE is_active = true ORDER BY name`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/work-centers', isAuthenticated, async (req, res) => {
  try {
    const { name, description, capacity } = req.body;
    const result = await pool.query(`INSERT INTO work_centers (name, description, capacity) VALUES ($1,$2,$3) RETURNING *`, [name, description || null, capacity || 1]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (err) { res.status(500).json({ status: 'error', db: 'disconnected' }); }
});

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 Mini ERP running at http://localhost:${PORT}`);
  console.log(`📊 API: http://localhost:${PORT}/api/analytics/summary`);
  console.log(`🔐 Login: http://localhost:${PORT}/login.html\n`);

  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'your_google_client_id_here') {
    console.log('⚠️  Google OAuth not configured — email/password login only');
  }
  if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === 'your_razorpay_key_id_here') {
    console.log('⚠️  Razorpay not configured — payment features disabled');
  }

  // Start job queue
  jobQueue.start(15000);
});
