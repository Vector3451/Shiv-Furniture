// routes/incidents.js — ServiceNow Incidents & Service Desk APIs
const express = require('express');
const { pool } = require('../db');
const { isAuthenticated, logAudit, getUserId, getUser, getIp } = require('../middleware/auth');

const router = express.Router();
router.use(isAuthenticated);

// Helper to calculate SLA due time based on priority
function calculateSlaDue(priority) {
  const now = new Date();
  switch (priority) {
    case 'P1': // Critical: 2 hours
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    case 'P2': // High: 8 hours
      return new Date(now.getTime() + 8 * 60 * 60 * 1000);
    case 'P3': // Moderate: 24 hours
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case 'P4': // Low: 72 hours
      return new Date(now.getTime() + 72 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

// ── GET /api/incidents (Fetch all incidents) ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT inc.*, 
             c.full_name as caller_name, c.email as caller_email,
             a.full_name as assignee_name, a.email as assignee_email
      FROM incidents inc
      JOIN users c ON c.id = inc.caller_id
      LEFT JOIN users a ON a.id = inc.assigned_to
      ORDER BY 
        CASE inc.priority 
          WHEN 'P1' THEN 1 
          WHEN 'P2' THEN 2 
          WHEN 'P3' THEN 3 
          WHEN 'P4' THEN 4 
          ELSE 5 
        END, 
        inc.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/incidents (Create new incident) ─────────────────────────────────
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { title, description, priority = 'P3', assigned_department } = req.body;
    const callerId = getUserId(req);
    const user = getUser(req);
    const callerDept = user.role;

    if (!title || !assigned_department) {
      return res.status(400).json({ error: 'Title and Assigned Department are required' });
    }

    // 1. Generate INC sequence number
    const maxNumRes = await client.query("SELECT MAX(SUBSTRING(number FROM 4)::int) as max_num FROM incidents");
    const nextNum = (maxNumRes.rows[0].max_num || 0) + 1;
    const incNumber = 'INC' + String(nextNum).padStart(4, '0');

    // 2. Calculate SLA Due Date
    const slaDueAt = calculateSlaDue(priority);

    // 3. Insert Incident
    const incRes = await client.query(`
      INSERT INTO incidents (number, title, description, caller_id, caller_department, assigned_department, priority, status, sla_due_at, sla_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'New', $8, 'In Progress')
      RETURNING *
    `, [incNumber, title, description || null, callerId, callerDept, assigned_department, priority, slaDueAt]);

    const incident = incRes.rows[0];

    // 4. Log initial update timeline
    await client.query(`
      INSERT INTO incident_updates (incident_id, updated_by, update_type, content)
      VALUES ($1, $2, 'system_change', $3)
    `, [incident.id, callerId, `Incident created and routed to ${assigned_department} department.`]);

    await logAudit({
      tableName: 'incidents',
      recordId: incident.id,
      action: 'INSERT',
      description: `Incident logged: ${incNumber}`,
      userId: callerId,
      ipAddress: getIp(req)
    });

    await client.query('COMMIT');
    res.status(201).json(incident);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── GET /api/incidents/:id (Fetch single incident details + history) ───────────
router.get('/:id', async (req, res) => {
  try {
    const incRes = await pool.query(`
      SELECT inc.*, 
             c.full_name as caller_name, c.email as caller_email,
             a.full_name as assignee_name, a.email as assignee_email
      FROM incidents inc
      JOIN users c ON c.id = inc.caller_id
      LEFT JOIN users a ON a.id = inc.assigned_to
      WHERE inc.id = $1
    `, [req.params.id]);

    if (!incRes.rows.length) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const updatesRes = await pool.query(`
      SELECT iu.*, u.full_name as user_name, u.role as user_role
      FROM incident_updates iu
      JOIN users u ON u.id = iu.updated_by
      WHERE iu.incident_id = $1
      ORDER BY iu.created_at ASC
    `, [req.params.id]);

    const incident = incRes.rows[0];
    incident.updates = updatesRes.rows;

    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/incidents/:id (Update incident details / status / priority) ───────
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { status, priority, assigned_to, description, notes } = req.body;
    const userId = getUserId(req);
    const userObj = getUser(req);

    // Fetch existing incident
    const existRes = await client.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
    if (!existRes.rows.length) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    const exist = existRes.rows[0];

    const updates = [];
    const params = [];
    const systemLogs = [];

    // Check status changes
    if (status && status !== exist.status) {
      params.push(status);
      updates.push(`status = $${params.length}`);
      systemLogs.push(`Status changed from ${exist.status} to ${status}.`);

      // Update SLA status accordingly
      if (['Resolved', 'Closed'].includes(status)) {
        updates.push(`sla_status = 'Completed'`);
      } else if (status === 'On Hold') {
        updates.push(`sla_status = 'Paused'`);
      } else {
        // Resume SLA tracking
        // Check if breached
        const isBreached = new Date() > new Date(exist.sla_due_at);
        updates.push(`sla_status = '${isBreached ? 'Breached' : 'In Progress'}'`);
      }
    }

    // Check priority changes
    if (priority && priority !== exist.priority) {
      // If priority changes, SLA due date must be recalculated
      const newSlaDue = calculateSlaDue(priority);
      params.push(priority);
      updates.push(`priority = $${params.length}`);
      
      params.push(newSlaDue);
      updates.push(`sla_due_at = $${params.length}`);
      
      systemLogs.push(`Priority changed from ${exist.priority} to ${priority}. SLA adjusted.`);
    }

    // Check assignee changes
    if (assigned_to !== undefined && assigned_to !== exist.assigned_to) {
      params.push(assigned_to);
      updates.push(`assigned_to = $${params.length}`);
      
      if (assigned_to) {
        const uRes = await client.query('SELECT full_name FROM users WHERE id = $1', [assigned_to]);
        const name = uRes.rows[0]?.full_name || 'unknown user';
        systemLogs.push(`Assigned to ${name}.`);
        if (exist.status === 'New') {
          updates.push(`status = 'Assigned'`);
        }
      } else {
        systemLogs.push('Assigned user removed.');
      }
    }

    if (description && description !== exist.description) {
      params.push(description);
      updates.push(`description = $${params.length}`);
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      await client.query(`UPDATE incidents SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);

      // Write system updates timeline
      for (const log of systemLogs) {
        await client.query(`
          INSERT INTO incident_updates (incident_id, updated_by, update_type, content)
          VALUES ($1, $2, 'system_change', $3)
        `, [req.params.id, userId, log]);
      }

      await logAudit({
        tableName: 'incidents',
        recordId: req.params.id,
        action: 'UPDATE',
        description: `Incident updated: ${exist.number}. ${systemLogs.join(' ')}`,
        userId,
        ipAddress: getIp(req)
      });
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/incidents/:id/reassign (Reassign department) ───────────────────
router.post('/:id/reassign', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { department } = req.body;
    const userId = getUserId(req);
    const user = getUser(req);

    if (!department) {
      return res.status(400).json({ error: 'Department is required' });
    }

    const existRes = await client.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
    if (!existRes.rows.length) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    const exist = existRes.rows[0];

    // Restrict reassignment check: standard users can reassign but if they want to override SLAs
    // or reassign arbitrarily outside their own modules, we require Admin. Let's make it generic:
    // Any user can reassign, but if an Admin does it (especially elevated), it records as an Admin override.
    const isElevated = !!req.session?.isElevated;

    await client.query(`
      UPDATE incidents 
      SET assigned_department = $1, assigned_to = NULL, updated_at = now() 
      WHERE id = $2
    `, [department, req.params.id]);

    await client.query(`
      INSERT INTO incident_updates (incident_id, updated_by, update_type, content)
      VALUES ($1, $2, 'system_change', $3)
    `, [req.params.id, userId, `Assigned department changed from ${exist.assigned_department} to ${department} by ${user.full_name}${isElevated ? ' (Security Admin)' : ''}.`]);

    await logAudit({
      tableName: 'incidents',
      recordId: req.params.id,
      action: 'UPDATE',
      description: `Reassigned incident ${exist.number} to ${department}`,
      userId,
      ipAddress: getIp(req)
    });

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/incidents/:id/updates (Add comment / work note) ──────────────────
router.post('/:id/updates', async (req, res) => {
  try {
    const { content, update_type } = req.body;
    const userId = getUserId(req);

    if (!content || !update_type) {
      return res.status(400).json({ error: 'Content and Update Type are required' });
    }

    if (!['work_note', 'comment'].includes(update_type)) {
      return res.status(400).json({ error: 'Invalid update type' });
    }

    const existRes = await pool.query('SELECT number FROM incidents WHERE id = $1', [req.params.id]);
    if (!existRes.rows.length) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    await pool.query(`
      INSERT INTO incident_updates (incident_id, updated_by, update_type, content)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, userId, update_type, content]);

    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/incidents/:id/override-sla (Admin SLA Override) ──────────────────
router.post('/:id/override-sla', async (req, res) => {
  // Requires Elevated Role (Security Admin)
  if (!req.session?.isElevated) {
    return res.status(403).json({ error: 'This operation requires Elevated Role (Security Admin)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { new_sla_due } = req.body;
    const userId = getUserId(req);

    if (!new_sla_due) {
      return res.status(400).json({ error: 'New SLA Due Date is required' });
    }

    const existRes = await client.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
    if (!existRes.rows.length) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    const exist = existRes.rows[0];

    const slaDate = new Date(new_sla_due);
    const isBreached = new Date() > slaDate;

    await client.query(`
      UPDATE incidents 
      SET sla_due_at = $1, 
          sla_status = $2,
          sla_breached_at = $3,
          updated_at = now()
      WHERE id = $4
    `, [slaDate, isBreached ? 'Breached' : 'In Progress', isBreached ? new Date() : null, req.params.id]);

    await client.query(`
      INSERT INTO incident_updates (incident_id, updated_by, update_type, content)
      VALUES ($1, $2, 'system_change', $3)
    `, [req.params.id, userId, `SLA manual override by Security Admin. Due date set to ${slaDate.toLocaleString()}.`]);

    await logAudit({
      tableName: 'incidents',
      recordId: req.params.id,
      action: 'ACTION',
      description: `SLA override for incident ${exist.number}`,
      userId,
      ipAddress: getIp(req)
    });

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
