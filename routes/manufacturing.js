// routes/manufacturing.js — Manufacturing Order lifecycle + work orders + stock
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
    if (status) { params.push(status); where.push(`mo.status = $${params.length}`); }
    params.push(parseInt(limit), parseInt(offset));
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await pool.query(`
      SELECT mo.*, pr.name as product_name, pr.sku, b.name as bom_name,
             u.full_name as assignee_name, u2.full_name as created_by_name,
             (SELECT COUNT(*) FROM work_orders WHERE manufacturing_order_id = mo.id) as work_order_count,
             (SELECT COUNT(*) FROM work_orders WHERE manufacturing_order_id = mo.id AND status = 'completed') as completed_work_orders
      FROM manufacturing_orders mo
      JOIN products pr ON pr.id = mo.product_id
      LEFT JOIN bom b ON b.id = mo.bom_id
      LEFT JOIN users u ON u.id = mo.assignee_id
      LEFT JOIN users u2 ON u2.id = mo.created_by
      ${wc}
      ORDER BY mo.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM manufacturing_orders mo ${wc}`, params.slice(0, -2));
    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const mo = await pool.query(`
      SELECT mo.*, pr.name as product_name, pr.sku, b.name as bom_name,
             u.full_name as assignee_name
      FROM manufacturing_orders mo
      JOIN products pr ON pr.id = mo.product_id
      LEFT JOIN bom b ON b.id = mo.bom_id
      LEFT JOIN users u ON u.id = mo.assignee_id
      WHERE mo.id = $1
    `, [req.params.id]);
    if (!mo.rows.length) return res.status(404).json({ error: 'MO not found' });

    const workOrders = await pool.query(`
      SELECT wo.*, wc.name as work_center_name, u.full_name as assignee_name
      FROM work_orders wo
      LEFT JOIN work_centers wc ON wc.id = wo.work_center_id
      LEFT JOIN users u ON u.id = wo.assignee_id
      WHERE wo.manufacturing_order_id = $1 ORDER BY wo.sequence_order
    `, [req.params.id]);

    // Get components (from BoM, scaled to MO quantity)
    let components = [];
    if (mo.rows[0].bom_id) {
      const bom = await pool.query(`SELECT quantity as bom_qty FROM bom WHERE id = $1`, [mo.rows[0].bom_id]);
      const bomQty = parseFloat(bom.rows[0]?.bom_qty || 1);
      const moQty = parseFloat(mo.rows[0].quantity);
      const scale = moQty / bomQty;

      const comps = await pool.query(`
        SELECT bc.*, pr.name as component_name, pr.sku, pr.on_hand_qty, pr.free_to_use_qty, pr.unit_of_measure
        FROM bom_components bc
        JOIN products pr ON pr.id = bc.component_id
        WHERE bc.bom_id = $1
      `, [mo.rows[0].bom_id]);

      components = comps.rows.map(c => ({ ...c, required_qty: parseFloat(c.quantity) * scale }));
    }

    res.json({ ...mo.rows[0], work_orders: workOrders.rows, components });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { product_id, bom_id, quantity, planned_start, planned_end, assignee_id, notes, priority } = req.body;

    const mo = await client.query(`
      INSERT INTO manufacturing_orders (product_id, bom_id, quantity, planned_start, planned_end, assignee_id, notes, priority, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [product_id, bom_id || null, quantity, planned_start || null, planned_end || null, assignee_id || null, notes || null, priority || 'normal', getUserId(req)]);

    // Auto-generate work orders from BoM operations
    if (bom_id) {
      const ops = await client.query(`SELECT * FROM bom_operations WHERE bom_id = $1 ORDER BY sequence_order`, [bom_id]);
      for (const op of ops.rows) {
        await client.query(`
          INSERT INTO work_orders (manufacturing_order_id, operation_name, work_center_id, sequence_order, planned_duration_min)
          VALUES ($1,$2,$3,$4,$5)
        `, [mo.rows[0].id, op.operation_name, op.work_center_id, op.sequence_order, op.duration_minutes]);
      }
    }

    await logAudit({ tableName: 'manufacturing_orders', recordId: mo.rows[0].id, action: 'INSERT', description: 'MO created', userId: getUserId(req) });
    await client.query('COMMIT');
    res.status(201).json(mo.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.post('/:id/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mo = await client.query(`SELECT * FROM manufacturing_orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!mo.rows.length) return res.status(404).json({ error: 'MO not found' });
    if (mo.rows[0].status !== 'draft') return res.status(400).json({ error: `Cannot confirm — status is ${mo.rows[0].status}` });

    // Reserve components from BoM
    if (mo.rows[0].bom_id) {
      const bom = await client.query(`SELECT quantity as bom_qty FROM bom WHERE id = $1`, [mo.rows[0].bom_id]);
      const scale = parseFloat(mo.rows[0].quantity) / parseFloat(bom.rows[0].bom_qty || 1);
      const comps = await client.query(`SELECT * FROM bom_components WHERE bom_id = $1`, [mo.rows[0].bom_id]);
      for (const comp of comps.rows) {
        await stockService.reserveStock({ client, productId: comp.component_id, quantity: parseFloat(comp.quantity) * scale });
      }
    }

    await client.query(`UPDATE manufacturing_orders SET status = 'confirmed' WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'manufacturing_orders', recordId: req.params.id, action: 'UPDATE', description: 'MO confirmed', userId: getUserId(req) });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.post('/:id/start', async (req, res) => {
  try {
    const mo = await pool.query(`SELECT * FROM manufacturing_orders WHERE id = $1`, [req.params.id]);
    if (!mo.rows.length) return res.status(404).json({ error: 'MO not found' });
    if (mo.rows[0].status !== 'confirmed') return res.status(400).json({ error: `Cannot start — status is ${mo.rows[0].status}` });

    await pool.query(`UPDATE manufacturing_orders SET status = 'in_progress', actual_start = now() WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'manufacturing_orders', recordId: req.params.id, action: 'UPDATE', description: 'MO started', userId: getUserId(req) });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { produced_qty } = req.body;
    const mo = await client.query(`SELECT * FROM manufacturing_orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!mo.rows.length) return res.status(404).json({ error: 'MO not found' });
    if (!['confirmed','in_progress'].includes(mo.rows[0].status)) return res.status(400).json({ error: `Cannot complete — status is ${mo.rows[0].status}` });

    const qty = parseFloat(produced_qty || mo.rows[0].quantity);
    const scale = qty / parseFloat(mo.rows[0].quantity);

    // Consume components
    if (mo.rows[0].bom_id) {
      const bom = await client.query(`SELECT quantity as bom_qty FROM bom WHERE id = $1`, [mo.rows[0].bom_id]);
      const bomScale = parseFloat(mo.rows[0].quantity) / parseFloat(bom.rows[0].bom_qty || 1);
      const comps = await client.query(`SELECT * FROM bom_components WHERE bom_id = $1`, [mo.rows[0].bom_id]);

      for (const comp of comps.rows) {
        await stockService.consumeStock({ client, productId: comp.component_id, quantity: parseFloat(comp.quantity) * bomScale * scale, movementType: 'manufacturing_out', referenceType: 'manufacturing_order', referenceId: req.params.id, notes: `Components consumed for ${mo.rows[0].order_number}`, userId: getUserId(req) });
      }
    }

    // Add finished goods to stock
    await stockService.applyMovement({ client, productId: mo.rows[0].product_id, movementType: 'manufacturing_in', referenceType: 'manufacturing_order', referenceId: req.params.id, quantity: qty, unitCost: null, notes: `Finished goods from ${mo.rows[0].order_number}`, userId: getUserId(req) });

    const newStatus = qty >= parseFloat(mo.rows[0].quantity) ? 'completed' : 'partially_produced';
    await client.query(`UPDATE manufacturing_orders SET status = $1, produced_qty = $2, actual_end = now() WHERE id = $3`, [newStatus, qty, req.params.id]);
    await logAudit({ tableName: 'manufacturing_orders', recordId: req.params.id, action: 'UPDATE', description: `MO ${newStatus}. Produced: ${qty}`, userId: getUserId(req) });
    await client.query('COMMIT');
    res.json({ ok: true, status: newStatus, produced: qty });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// Work Orders
router.get('/:id/work-orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT wo.*, wc.name as work_center_name, u.full_name as assignee_name
      FROM work_orders wo
      LEFT JOIN work_centers wc ON wc.id = wo.work_center_id
      LEFT JOIN users u ON u.id = wo.assignee_id
      WHERE wo.manufacturing_order_id = $1 ORDER BY wo.sequence_order
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/work-orders/:woId/start', async (req, res) => {
  try {
    const wo = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [req.params.woId]);
    if (!wo.rows.length) return res.status(404).json({ error: 'Work order not found' });
    await pool.query(`UPDATE work_orders SET status = 'in_progress', started_at = now(), assignee_id = COALESCE($1, assignee_id) WHERE id = $2`, [getUserId(req), req.params.woId]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/work-orders/:woId/complete', async (req, res) => {
  try {
    const { actual_duration_min, notes } = req.body;
    const wo = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [req.params.woId]);
    if (!wo.rows.length) return res.status(404).json({ error: 'Work order not found' });
    if (wo.rows[0].status === 'completed') return res.status(400).json({ error: 'Already completed' });

    await pool.query(`UPDATE work_orders SET status = 'completed', completed_at = now(), actual_duration_min = $1, notes = COALESCE($2, notes) WHERE id = $3`,
      [actual_duration_min || null, notes || null, req.params.woId]);

    // Check if all WOs complete → auto-set MO to in_progress
    const allWO = await pool.query(`SELECT status FROM work_orders WHERE manufacturing_order_id = $1`, [wo.rows[0].manufacturing_order_id]);
    const allDone = allWO.rows.every(w => w.status === 'completed');
    if (allDone) {
      await pool.query(`UPDATE manufacturing_orders SET status = 'in_progress' WHERE id = $1 AND status = 'confirmed'`, [wo.rows[0].manufacturing_order_id]);
    }

    await logAudit({ tableName: 'work_orders', recordId: req.params.woId, action: 'UPDATE', description: 'Work order completed', userId: getUserId(req) });
    res.json({ ok: true, all_work_orders_done: allDone });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Work centers
router.get('/work-centers/list', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM work_centers WHERE is_active = true ORDER BY name`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
