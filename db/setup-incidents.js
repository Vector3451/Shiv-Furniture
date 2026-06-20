// db/setup-incidents.js — Create and seed incident/SLA tracking tables
require('./dns-override');
require('dotenv').config();
const { Client } = require('pg');

async function setup() {
  console.log('🔌 Connecting to Neon PostgreSQL...');
  
  let client;
  let retries = 5;
  while (retries > 0) {
    try {
      client = new Client({ 
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 15000 // 15s to handle Neon cold starts
      });
      await client.connect();
      console.log('✅ Connected successfully!');
      break;
    } catch (err) {
      console.log(`⚠️ Connection attempt failed. Retries remaining: ${retries - 1}. Error: ${err.message}`);
      retries--;
      if (retries === 0) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  try {
    // 1. Create incidents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        number VARCHAR(20) NOT NULL UNIQUE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        caller_id UUID NOT NULL REFERENCES users(id),
        caller_department VARCHAR(50) NOT NULL,
        assigned_department VARCHAR(50) NOT NULL,
        assigned_to UUID REFERENCES users(id),
        priority VARCHAR(5) NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3','P4')),
        status VARCHAR(30) NOT NULL DEFAULT 'New' CHECK (status IN ('New','Assigned','In Progress','On Hold','Resolved','Closed')),
        sla_due_at TIMESTAMPTZ NOT NULL,
        sla_status VARCHAR(20) NOT NULL DEFAULT 'In Progress' CHECK (sla_status IN ('In Progress','Near Breach','Breached','Completed','Paused')),
        sla_breached_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    console.log('✓ Created incidents table.');

    // 2. Create incident_updates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS incident_updates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
        updated_by UUID NOT NULL REFERENCES users(id),
        update_type VARCHAR(20) NOT NULL CHECK (update_type IN ('work_note','comment','system_change')),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    console.log('✓ Created incident_updates table.');

    // 3. Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE INDEX IF NOT EXISTS idx_incidents_assigned_dept ON incidents(assigned_department);
      CREATE INDEX IF NOT EXISTS idx_incidents_priority ON incidents(priority);
      CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON incident_updates(incident_id);
    `);
    console.log('✓ Created database indexes.');

    // 4. Seed initial tickets if empty
    const checkIncidents = await client.query('SELECT COUNT(*) FROM incidents');
    if (parseInt(checkIncidents.rows[0].count) === 0) {
      console.log('🌱 Seeding sample B2B operational incidents...');

      // Get some user IDs to reference as caller and assignees
      const adminRes = await client.query("SELECT id FROM users WHERE login_id = 'ADM001'");
      const salesRes = await client.query("SELECT id FROM users WHERE login_id = 'SAL001'");
      const mfgRes = await client.query("SELECT id FROM users WHERE login_id = 'MFG001'");
      const invRes = await client.query("SELECT id FROM users WHERE login_id = 'INV001'");
      const purRes = await client.query("SELECT id FROM users WHERE login_id = 'PUR001'");

      const adminId = adminRes.rows[0]?.id;
      const salesId = salesRes.rows[0]?.id;
      const mfgId = mfgRes.rows[0]?.id;
      const invId = invRes.rows[0]?.id;
      const purId = purRes.rows[0]?.id;

      if (!adminId || !salesId || !mfgId || !invId) {
        console.log('⚠️ Could not find seeded users. Database setup-schema or seed must be run first.');
        return;
      }

      // We will seed 4 incidents with P1, P2, P3, and P4 status
      const now = new Date();

      // Incident 1: P1 Critical (Shopfloor Blocked) - In Progress (Nearly Breached)
      const p1Sla = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins remaining
      const inc1 = await client.query(`
        INSERT INTO incidents (number, title, description, caller_id, caller_department, assigned_department, assigned_to, priority, status, sla_due_at, sla_status, created_at)
        VALUES ('INC0001', 'CNC Cutter Machine Main Motor Overheat Failure', 
                'Assembly Line is completely blocked. Wood planks cannot be cut. The main electrical spindle is reporting thermal overload error and will not engage. Need urgent engineering/maintenance inspection.',
                $1, 'manufacturing_user', 'manufacturing_user', $2, 'P1', 'In Progress', $3, 'In Progress', now() - interval '1 hour 45 minutes')
        RETURNING id
      `, [mfgId, mfgId, p1Sla]);

      // Incident 2: P2 High (SLA Breached)
      const p2Sla = new Date(now.getTime() - 2 * 60 * 60 * 1000); // Breached 2 hours ago
      const inc2 = await client.query(`
        INSERT INTO incidents (number, title, description, caller_id, caller_department, assigned_department, assigned_to, priority, status, sla_due_at, sla_status, created_at, sla_breached_at)
        VALUES ('INC0002', 'Fabric shipment delay from supplier Verma Fabrics', 
                'PO0004 for Brown Velvet fabric was expected 3 days ago. Vendor reports logistical delay due to interstate permit checks. Need procurement admin escalation to solve or arrange local vendor backup.',
                $1, 'sales_user', 'purchase_user', $2, 'P2', 'Assigned', $3, 'Breached', now() - interval '10 hours', $3)
        RETURNING id
      `, [salesId, purId, p2Sla]);

      // Incident 3: P3 Moderate (Inventory Count Discrepancy) - New (Safe)
      const p3Sla = new Date(now.getTime() + 20 * 60 * 60 * 1000); // 20 hours remaining
      const inc3 = await client.query(`
        INSERT INTO incidents (number, title, description, caller_id, caller_department, assigned_department, priority, status, sla_due_at, sla_status, created_at)
        VALUES ('INC0003', 'MDF Board stock count variance in System vs Physical Warehouse', 
                'System displays 100 sheets of RM-MDF-003, but physical warehouse count shows only 85 sheets. Need inventory manager audit reconciliation.',
                $1, 'manufacturing_user', 'inventory_manager', 'P3', 'New', $2, 'In Progress', now() - interval '4 hours')
        RETURNING id
      `, [mfgId, p3Sla]);

      // Incident 4: P4 Low (Resolved) - SLA Completed
      const p4Sla = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const inc4 = await client.query(`
        INSERT INTO incidents (number, title, description, caller_id, caller_department, assigned_department, assigned_to, priority, status, sla_due_at, sla_status, created_at)
        VALUES ('INC0004', 'Configure new barcode labels printer for packaging unit', 
                'Need setup and testing of the newly arrived labels printer in packing floor. Device model is Zebra ZD421.',
                $1, 'inventory_manager', 'admin', $2, 'P4', 'Resolved', $3, 'Completed', now() - interval '1 day')
        RETURNING id
      `, [invId, adminId, p4Sla]);

      // Seed updates/timeline for these tickets
      const ids = {
        inc1: inc1.rows[0].id,
        inc2: inc2.rows[0].id,
        inc3: inc3.rows[0].id,
        inc4: inc4.rows[0].id
      };

      // INC0001 updates
      await client.query(`
        INSERT INTO incident_updates (incident_id, updated_by, update_type, content, created_at) VALUES
          ($1, $2, 'system_change', 'Ticket created and priority set to P1 Critical.', now() - interval '1 hour 45 minutes'),
          ($1, $2, 'comment', 'Maintenance team notified. Spindle oil check initiated.', now() - interval '1 hour 30 minutes'),
          ($1, $3, 'work_note', 'Attempting electrical breaker reset. If thermal fault persists, we will need to swap the backup Siemens contactor relay.', now() - interval '45 minutes')
      `, [ids.inc1, mfgId, adminId]);

      // INC0002 updates
      await client.query(`
        INSERT INTO incident_updates (incident_id, updated_by, update_type, content, created_at) VALUES
          ($1, $2, 'system_change', 'Ticket created and assigned to Purchasing department.', now() - interval '10 hours'),
          ($1, $3, 'work_note', 'Contacted Verma Fabrics dispatch team. They confirm the truck has been stuck at Haryana border checkpost since yesterday. Attempting to clear GST e-way bill error.', now() - interval '6 hours'),
          ($1, $2, 'comment', 'Is there any update on this? The customer is asking for their velvet chair delivery schedule.', now() - interval '3 hours')
      `, [ids.inc2, salesId, purId]);

      // INC0003 updates
      await client.query(`
        INSERT INTO incident_updates (incident_id, updated_by, update_type, content, created_at) VALUES
          ($1, $2, 'system_change', 'Ticket logged and routed to Inventory Management group.', now() - interval '4 hours')
      `, [ids.inc3, mfgId]);

      // INC0004 updates
      await client.query(`
        INSERT INTO incident_updates (incident_id, updated_by, update_type, content, created_at) VALUES
          ($1, $2, 'system_change', 'Ticket created and assigned to admin.', now() - interval '1 day'),
          ($1, $3, 'work_note', 'Zebra drivers installed on local packaging terminal. Configured print label layout template.', now() - interval '18 hours'),
          ($1, $3, 'comment', 'Label printer has been calibrated and test prints were successful. Closing the incident.', now() - interval '2 hours'),
          ($1, $3, 'system_change', 'Ticket status changed to Resolved. SLA status marked Completed.', now() - interval '2 hours')
      `, [ids.inc4, invId, adminId]);

      console.log('✓ Seeded sample incident and update log records.');
    } else {
      console.log('ℹ Incidents already populated. Skipping seed.');
    }

    console.log('🚀 Database setup completed successfully!');
  } catch (err) {
    console.error('❌ Error during setup:', err.message);
    throw err;
  } finally {
    if (client) await client.end();
  }
}

// Running setup
setup()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
