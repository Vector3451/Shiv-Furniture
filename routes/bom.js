// routes/bom.js — Bill of Materials CRUD
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated, logAudit, getUserId } = require('../middleware/auth');

const router = express.Router();
router.use(isAuthenticated);

router.get('/', async (req, res) => {
  try {
    const { product_id, active } = req.query;
    let where = [];
    const params = [];
    if (active !== 'false') where.push('b.is_active = true');
    if (product_id) { params.push(product_id); where.push(`b.product_id = $${params.length}`); }
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await pool.query(`
      SELECT b.*, pr.name as product_name, pr.sku,
             (SELECT COUNT(*) FROM bom_components WHERE bom_id = b.id) as component_count,
             (SELECT COUNT(*) FROM bom_operations WHERE bom_id = b.id) as operation_count
      FROM bom b
      JOIN products pr ON pr.id = b.product_id
      ${wc}
      ORDER BY pr.name, b.version DESC
    `, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const bom = await pool.query(`
      SELECT b.*, pr.name as product_name, pr.sku
      FROM bom b JOIN products pr ON pr.id = b.product_id
      WHERE b.id = $1
    `, [req.params.id]);
    if (!bom.rows.length) return res.status(404).json({ error: 'BoM not found' });

    const components = await pool.query(`
      SELECT bc.*, pr.name as component_name, pr.sku, pr.unit_of_measure
      FROM bom_components bc
      JOIN products pr ON pr.id = bc.component_id
      WHERE bc.bom_id = $1
    `, [req.params.id]);

    const operations = await pool.query(`
      SELECT bo.*, wc.name as work_center_name
      FROM bom_operations bo
      LEFT JOIN work_centers wc ON wc.id = bo.work_center_id
      WHERE bo.bom_id = $1 ORDER BY bo.sequence_order
    `, [req.params.id]);

    res.json({ ...bom.rows[0], components: components.rows, operations: operations.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { product_id, name, version, quantity, notes, components, operations } = req.body;

    const bom = await client.query(`
      INSERT INTO bom (product_id, name, version, quantity, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [product_id, name, version || 1, quantity || 1, notes || null, getUserId(req)]);

    if (components?.length) {
      for (const c of components) {
        await client.query(`INSERT INTO bom_components (bom_id, component_id, quantity, notes) VALUES ($1,$2,$3,$4)`,
          [bom.rows[0].id, c.component_id, c.quantity, c.notes || null]);
      }
    }

    if (operations?.length) {
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        await client.query(`INSERT INTO bom_operations (bom_id, operation_name, duration_minutes, work_center_id, sequence_order, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [bom.rows[0].id, op.operation_name, op.duration_minutes || 30, op.work_center_id || null, i + 1, op.notes || null]);
      }
    }

    await logAudit({ tableName: 'bom', recordId: bom.rows[0].id, action: 'INSERT', description: `BoM created: ${name}`, userId: getUserId(req) });
    await client.query('COMMIT');
    res.status(201).json(bom.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { name, quantity, notes, is_active, components, operations } = req.body;

    await client.query(`UPDATE bom SET name=COALESCE($1,name), quantity=COALESCE($2,quantity), notes=COALESCE($3,notes), is_active=COALESCE($4,is_active) WHERE id=$5`,
      [name, quantity, notes, is_active, req.params.id]);

    if (components !== undefined) {
      await client.query(`DELETE FROM bom_components WHERE bom_id = $1`, [req.params.id]);
      for (const c of components) {
        await client.query(`INSERT INTO bom_components (bom_id, component_id, quantity, notes) VALUES ($1,$2,$3,$4)`,
          [req.params.id, c.component_id, c.quantity, c.notes || null]);
      }
    }

    if (operations !== undefined) {
      await client.query(`DELETE FROM bom_operations WHERE bom_id = $1`, [req.params.id]);
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        await client.query(`INSERT INTO bom_operations (bom_id, operation_name, duration_minutes, work_center_id, sequence_order, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.id, op.operation_name, op.duration_minutes || 30, op.work_center_id || null, i + 1, op.notes || null]);
      }
    }

    await logAudit({ tableName: 'bom', recordId: req.params.id, action: 'UPDATE', description: 'BoM updated', userId: getUserId(req) });
    await client.query('COMMIT');
    const result = await pool.query(`SELECT * FROM bom WHERE id = $1`, [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE bom SET is_active = false WHERE id = $1`, [req.params.id]);
    await logAudit({ tableName: 'bom', recordId: req.params.id, action: 'DELETE', description: 'BoM deactivated', userId: getUserId(req) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
