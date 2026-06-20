// routes/payments.js — Razorpay payment integration
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { isAuthenticated, getUserId } = require('../middleware/auth');

const router = express.Router();
router.use(isAuthenticated);

function getRazorpay() {
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

// Create Razorpay order for a Sales Order
router.post('/create', async (req, res) => {
  try {
    const { sales_order_id } = req.body;
    const so = await pool.query(`SELECT * FROM sales_orders WHERE id = $1`, [sales_order_id]);
    if (!so.rows.length) return res.status(404).json({ error: 'Sales order not found' });
    if (so.rows[0].status === 'cancelled') return res.status(400).json({ error: 'Order is cancelled' });
    if (so.rows[0].payment_status === 'paid') return res.status(400).json({ error: 'Already paid' });

    const amountPaise = Math.round(parseFloat(so.rows[0].total_amount) * 100);
    if (amountPaise <= 0) return res.status(400).json({ error: 'Order amount must be > 0' });

    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === 'your_razorpay_key_id_here') {
      return res.status(400).json({ error: 'Razorpay not configured. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env' });
    }

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: so.rows[0].order_number,
      notes: { sales_order_id, order_number: so.rows[0].order_number }
    });

    // Save payment record
    await pool.query(`
      INSERT INTO payments (sales_order_id, razorpay_order_id, amount, currency, status)
      VALUES ($1,$2,$3,'INR','pending')
      ON CONFLICT (razorpay_order_id) DO NOTHING
    `, [sales_order_id, order.id, so.rows[0].total_amount]);

    await pool.query(`UPDATE sales_orders SET status = 'payment_pending', payment_status = 'pending' WHERE id = $1`, [sales_order_id]);

    res.json({ razorpay_order_id: order.id, amount: amountPaise, currency: 'INR', key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verify Razorpay payment signature
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, sales_order_id } = req.body;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    await pool.query(`
      UPDATE payments SET razorpay_payment_id=$1, razorpay_signature=$2, status='paid', paid_at=now()
      WHERE razorpay_order_id=$3
    `, [razorpay_payment_id, razorpay_signature, razorpay_order_id]);

    await pool.query(`UPDATE sales_orders SET payment_status = 'paid', status = 'payment_done' WHERE id = $1`, [sales_order_id]);

    res.json({ ok: true, message: 'Payment verified successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get payment info for a sales order
router.get('/so/:soId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, so.order_number, so.total_amount
      FROM payments p
      JOIN sales_orders so ON so.id = p.sales_order_id
      WHERE p.sales_order_id = $1
      ORDER BY p.created_at DESC LIMIT 1
    `, [req.params.soId]);
    res.json(result.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
