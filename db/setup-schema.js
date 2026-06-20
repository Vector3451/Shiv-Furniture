// db/setup-schema.js
// Full Mini ERP Schema — drops and recreates everything
// Run: node db/setup-schema.js

require('dotenv').config();
const { Client } = require('pg');

async function setupSchema() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('🔌 Connecting to Neon PostgreSQL...');
    await client.connect();
    console.log('✅ Connected!\n');

    // DROP all triggers first
    console.log('🧹 Dropping existing objects...');
    await client.query(`
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN SELECT event_object_table, trigger_name FROM information_schema.triggers
                 WHERE trigger_schema = 'public' LOOP
          EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.trigger_name) || ' ON ' || quote_ident(r.event_object_table) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // DROP tables in dependency order
    await client.query(`
      DROP TABLE IF EXISTS payments CASCADE;
      DROP TABLE IF EXISTS job_queue CASCADE;
      DROP TABLE IF EXISTS audit_logs CASCADE;
      DROP TABLE IF EXISTS stock_ledger CASCADE;
      DROP TABLE IF EXISTS work_orders CASCADE;
      DROP TABLE IF EXISTS manufacturing_orders CASCADE;
      DROP TABLE IF EXISTS purchase_order_lines CASCADE;
      DROP TABLE IF EXISTS purchase_orders CASCADE;
      DROP TABLE IF EXISTS sales_order_lines CASCADE;
      DROP TABLE IF EXISTS sales_orders CASCADE;
      DROP TABLE IF EXISTS bom_operations CASCADE;
      DROP TABLE IF EXISTS bom_components CASCADE;
      DROP TABLE IF EXISTS bom CASCADE;
      DROP TABLE IF EXISTS product_procurement CASCADE;
      DROP TABLE IF EXISTS work_centers CASCADE;
      DROP TABLE IF EXISTS parties CASCADE;
      DROP TABLE IF EXISTS products CASCADE;
      DROP TABLE IF EXISTS user_access_rights CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      
      -- Leftover unused tables to clean up from database
      DROP TABLE IF EXISTS boms CASCADE;
      DROP TABLE IF EXISTS customer_analytics CASCADE;
      DROP TABLE IF EXISTS customers CASCADE;
      DROP TABLE IF EXISTS notifications CASCADE;
      DROP TABLE IF EXISTS number_sequences CASCADE;
      DROP TABLE IF EXISTS order_timelines CASCADE;
      DROP TABLE IF EXISTS product_categories CASCADE;
      DROP TABLE IF EXISTS sales_forecasts CASCADE;
      DROP TABLE IF EXISTS stock_alerts CASCADE;
      DROP TABLE IF EXISTS vendor_performances CASCADE;
      DROP TABLE IF EXISTS vendors CASCADE;
      DROP TABLE IF EXISTS manufacturing_efficiencies CASCADE;

      DROP SEQUENCE IF EXISTS party_seq CASCADE;
      DROP SEQUENCE IF EXISTS sales_order_seq CASCADE;
      DROP SEQUENCE IF EXISTS purchase_order_seq CASCADE;
      DROP SEQUENCE IF EXISTS manufacturing_order_seq CASCADE;
    `);

    // Drop all user-defined functions
    await client.query(`
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN
          SELECT p.proname, p.oid
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              JOIN pg_extension e ON e.oid = d.refobjid
              WHERE d.objid = p.oid AND d.deptype = 'e'
            )
        LOOP
          EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    console.log('✅ Cleared.\n');

    // EXTENSION
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // SHARED TRIGGER
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $$ LANGUAGE plpgsql;
    `);

    // ── 1. USERS ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE users (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          login_id    VARCHAR(12) NOT NULL UNIQUE,
          email       VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255),
          google_id   VARCHAR(255) UNIQUE,
          avatar_url  TEXT,
          full_name   VARCHAR(255) NOT NULL,
          role        VARCHAR(50) NOT NULL CHECK (role IN ('admin','sales_user','purchase_user','manufacturing_user','inventory_manager','business_owner')),
          is_active   BOOLEAN NOT NULL DEFAULT true,
          last_login  TIMESTAMPTZ,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TRIGGER trg_users_updated_at
          BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await client.query(`
      CREATE TABLE user_access_rights (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module      VARCHAR(50) NOT NULL CHECK (module IN ('products','sales','purchase','manufacturing','bom','inventory','audit_logs','users')),
          access_type VARCHAR(20) NOT NULL CHECK (access_type IN ('admin','user','none')),
          UNIQUE (user_id, module)
      );
    `);

    // ── 2. PRODUCTS ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE products (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name            VARCHAR(255) NOT NULL,
          sku             VARCHAR(100) NOT NULL UNIQUE,
          description     TEXT,
          product_type    VARCHAR(20) NOT NULL DEFAULT 'finished_good' CHECK (product_type IN ('raw_material','finished_good','component')),
          sales_price     DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (sales_price >= 0),
          cost_price      DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
          on_hand_qty     DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
          reserved_qty    DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
          free_to_use_qty DECIMAL(12,2) GENERATED ALWAYS AS (on_hand_qty - reserved_qty) STORED,
          unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'units',
          min_stock_level DECIMAL(12,2) NOT NULL DEFAULT 0,
          image_url       TEXT,
          is_active       BOOLEAN NOT NULL DEFAULT true,
          created_by      UUID,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (reserved_qty <= on_hand_qty)
      );
      CREATE TRIGGER trg_products_updated_at
          BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    // ── 3. PARTIES ────────────────────────────────────────────────────────
    await client.query(`
      CREATE SEQUENCE party_seq START 1;
      CREATE TABLE parties (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          seq_no      INT NOT NULL DEFAULT nextval('party_seq') UNIQUE,
          party_code  VARCHAR(10) UNIQUE,
          name        VARCHAR(255) NOT NULL,
          email       VARCHAR(255),
          phone       VARCHAR(50),
          gstin       VARCHAR(20),
          address     TEXT,
          city        VARCHAR(100),
          state       VARCHAR(100),
          pincode     VARCHAR(10),
          is_vendor   BOOLEAN NOT NULL DEFAULT false,
          is_customer BOOLEAN NOT NULL DEFAULT false,
          is_active   BOOLEAN NOT NULL DEFAULT true,
          created_by  UUID,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (is_vendor = true OR is_customer = true)
      );
      CREATE TRIGGER trg_parties_updated_at
          BEFORE UPDATE ON parties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_party_code()
      RETURNS TRIGGER AS $$
      BEGIN
          IF NEW.is_vendor AND NOT NEW.is_customer THEN
              NEW.party_code := 'VEN' || LPAD(NEW.seq_no::text, 3, '0');
          ELSIF NEW.is_customer AND NOT NEW.is_vendor THEN
              NEW.party_code := 'CUS' || LPAD(NEW.seq_no::text, 3, '0');
          ELSE
              NEW.party_code := 'PTY' || LPAD(NEW.seq_no::text, 3, '0');
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_parties_code
          BEFORE INSERT ON parties FOR EACH ROW EXECUTE FUNCTION set_party_code();
    `);

    // ── 4. PRODUCT_PROCUREMENT ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE product_procurement (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id        UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
          procure_on_demand BOOLEAN NOT NULL DEFAULT false,
          procurement_type  VARCHAR(20) NOT NULL DEFAULT 'purchase' CHECK (procurement_type IN ('purchase','manufacturing')),
          strategy          VARCHAR(10) NOT NULL DEFAULT 'MTS' CHECK (strategy IN ('MTS','MTO')),
          vendor_party_id   UUID REFERENCES parties(id),
          bom_id            UUID,
          lead_time_days    INT DEFAULT 0 CHECK (lead_time_days >= 0),
          min_order_qty     DECIMAL(12,2) DEFAULT 1 CHECK (min_order_qty > 0),
          reorder_point     DECIMAL(12,2) DEFAULT 0,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TRIGGER trg_product_procurement_updated_at
          BEFORE UPDATE ON product_procurement FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    // ── 5. BOM ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE bom (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          name        VARCHAR(255) NOT NULL,
          version     INT NOT NULL DEFAULT 1,
          quantity    DECIMAL(12,2) NOT NULL DEFAULT 1,
          notes       TEXT,
          is_active   BOOLEAN NOT NULL DEFAULT true,
          created_by  UUID,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (product_id, version)
      );
      CREATE TRIGGER trg_bom_updated_at
          BEFORE UPDATE ON bom FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await client.query(`
      ALTER TABLE product_procurement
          ADD CONSTRAINT fk_procurement_bom FOREIGN KEY (bom_id) REFERENCES bom(id);
    `);

    await client.query(`
      CREATE TABLE bom_components (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          bom_id       UUID NOT NULL REFERENCES bom(id) ON DELETE CASCADE,
          component_id UUID NOT NULL REFERENCES products(id),
          quantity     DECIMAL(12,4) NOT NULL CHECK (quantity > 0),
          notes        TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // ── 6. WORK CENTERS ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE work_centers (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name        VARCHAR(255) NOT NULL,
          description TEXT,
          capacity    INT DEFAULT 1,
          is_active   BOOLEAN NOT NULL DEFAULT true,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TRIGGER trg_work_centers_updated_at
          BEFORE UPDATE ON work_centers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE bom_operations (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          bom_id           UUID NOT NULL REFERENCES bom(id) ON DELETE CASCADE,
          operation_name   VARCHAR(255) NOT NULL,
          duration_minutes INT NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
          work_center_id   UUID REFERENCES work_centers(id),
          sequence_order   INT NOT NULL DEFAULT 1,
          notes            TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // ── 7. SALES ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE SEQUENCE sales_order_seq START 1;
      CREATE TABLE sales_orders (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number      VARCHAR(20) UNIQUE,
          customer_party_id UUID NOT NULL REFERENCES parties(id),
          status            VARCHAR(30) NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','confirmed','payment_pending','payment_done','partially_delivered','fully_delivered','cancelled')),
          payment_status    VARCHAR(30) NOT NULL DEFAULT 'unpaid'
              CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded')),
          order_date        DATE NOT NULL DEFAULT CURRENT_DATE,
          expected_delivery DATE,
          total_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
          discount_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
          tax_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
          notes             TEXT,
          shipping_address  TEXT,
          procurement_triggered BOOLEAN DEFAULT false,
          created_by        UUID REFERENCES users(id),
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TRIGGER trg_sales_orders_updated_at
          BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_sales_order_number()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.order_number := 'SO' || LPAD(nextval('sales_order_seq')::text, 4, '0');
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_sales_orders_number
          BEFORE INSERT ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_sales_order_number();
    `);

    await client.query(`
      CREATE TABLE sales_order_lines (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
          product_id     UUID NOT NULL REFERENCES products(id),
          sequence_order INT NOT NULL DEFAULT 0,
          quantity       DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
          delivered_qty  DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
          unit_price     DECIMAL(12,2) NOT NULL CHECK (unit_price >= 0),
          line_total     DECIMAL(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (delivered_qty <= quantity)
      );
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION recalc_sales_order_total()
      RETURNS TRIGGER AS $$
      DECLARE target_order_id UUID := COALESCE(NEW.sales_order_id, OLD.sales_order_id);
      BEGIN
          UPDATE sales_orders SET total_amount = (
              SELECT COALESCE(SUM(line_total), 0) FROM sales_order_lines WHERE sales_order_id = target_order_id
          ) WHERE id = target_order_id;
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_sol_recalc_total
          AFTER INSERT OR UPDATE OR DELETE ON sales_order_lines FOR EACH ROW EXECUTE FUNCTION recalc_sales_order_total();
    `);

    // ── 8. PURCHASE ───────────────────────────────────────────────────────
    await client.query(`
      CREATE SEQUENCE purchase_order_seq START 1;
      CREATE TABLE purchase_orders (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number    VARCHAR(20) UNIQUE,
          vendor_party_id UUID NOT NULL REFERENCES parties(id),
          status          VARCHAR(30) NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','confirmed','partially_received','fully_received','cancelled')),
          order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
          expected_receipt DATE,
          total_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
          notes           TEXT,
          auto_generated  BOOLEAN DEFAULT false,
          source_so_id    UUID REFERENCES sales_orders(id),
          created_by      UUID REFERENCES users(id),
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TRIGGER trg_purchase_orders_updated_at
          BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_purchase_order_number()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.order_number := 'PO' || LPAD(nextval('purchase_order_seq')::text, 4, '0');
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_purchase_orders_number
          BEFORE INSERT ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_purchase_order_number();
    `);

    await client.query(`
      CREATE TABLE purchase_order_lines (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
          product_id        UUID NOT NULL REFERENCES products(id),
          sequence_order    INT NOT NULL DEFAULT 0,
          quantity          DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
          received_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
          unit_price        DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
          line_total        DECIMAL(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (received_qty <= quantity)
      );
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION recalc_purchase_order_total()
      RETURNS TRIGGER AS $$
      DECLARE target_order_id UUID := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
      BEGIN
          UPDATE purchase_orders SET total_amount = (
              SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = target_order_id
          ) WHERE id = target_order_id;
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_pol_recalc_total
          AFTER INSERT OR UPDATE OR DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION recalc_purchase_order_total();
    `);

    // ── 9. MANUFACTURING ──────────────────────────────────────────────────
    await client.query(`
      CREATE SEQUENCE manufacturing_order_seq START 1;
      CREATE TABLE manufacturing_orders (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number  VARCHAR(20) UNIQUE,
          product_id    UUID NOT NULL REFERENCES products(id),
          bom_id        UUID REFERENCES bom(id),
          quantity      DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
          produced_qty  DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (produced_qty >= 0),
          status        VARCHAR(30) NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','confirmed','in_progress','partially_produced','completed','cancelled')),
          priority      VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
          planned_start TIMESTAMPTZ,
          planned_end   TIMESTAMPTZ,
          actual_start  TIMESTAMPTZ,
          actual_end    TIMESTAMPTZ,
          assignee_id   UUID REFERENCES users(id),
          notes         TEXT,
          auto_generated BOOLEAN DEFAULT false,
          source_so_id  UUID REFERENCES sales_orders(id),
          created_by    UUID REFERENCES users(id),
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (produced_qty <= quantity)
      );
      CREATE TRIGGER trg_manufacturing_orders_updated_at
          BEFORE UPDATE ON manufacturing_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_manufacturing_order_number()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.order_number := 'MO' || LPAD(nextval('manufacturing_order_seq')::text, 4, '0');
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_manufacturing_orders_number
          BEFORE INSERT ON manufacturing_orders FOR EACH ROW EXECUTE FUNCTION set_manufacturing_order_number();
    `);

    await client.query(`
      CREATE TABLE work_orders (
          id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          manufacturing_order_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
          operation_name         VARCHAR(255) NOT NULL,
          work_center_id         UUID REFERENCES work_centers(id),
          sequence_order         INT NOT NULL DEFAULT 1,
          planned_duration_min   INT NOT NULL DEFAULT 30 CHECK (planned_duration_min > 0),
          actual_duration_min    INT,
          status                 VARCHAR(30) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','in_progress','completed','cancelled')),
          assignee_id            UUID REFERENCES users(id),
          started_at             TIMESTAMPTZ,
          completed_at           TIMESTAMPTZ,
          notes                  TEXT,
          created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TRIGGER trg_work_orders_updated_at
          BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    // ── 10. STOCK LEDGER ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE stock_ledger (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id      UUID NOT NULL REFERENCES products(id),
          movement_type   VARCHAR(30) NOT NULL
              CHECK (movement_type IN ('sale','purchase','manufacturing_in','manufacturing_out','adjustment','return','opening')),
          reference_type  VARCHAR(30) NOT NULL
              CHECK (reference_type IN ('sales_order','purchase_order','manufacturing_order','adjustment','return','opening')),
          reference_id    UUID,
          quantity        DECIMAL(12,2) NOT NULL,
          unit_cost       DECIMAL(12,2),
          running_balance DECIMAL(12,2) NOT NULL,
          notes           TEXT,
          created_by      UUID REFERENCES users(id),
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_stock_ledger_product ON stock_ledger(product_id);
      CREATE INDEX idx_stock_ledger_movement ON stock_ledger(movement_type);
      CREATE INDEX idx_stock_ledger_created ON stock_ledger(created_at DESC);
    `);

    // ── 11. PAYMENTS ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE payments (
          id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sales_order_id       UUID NOT NULL REFERENCES sales_orders(id),
          razorpay_order_id    VARCHAR(100) UNIQUE,
          razorpay_payment_id  VARCHAR(100),
          razorpay_signature   TEXT,
          amount               DECIMAL(14,2) NOT NULL,
          currency             VARCHAR(10) DEFAULT 'INR',
          status               VARCHAR(30) DEFAULT 'pending'
              CHECK (status IN ('pending','paid','failed','refunded')),
          payment_method       VARCHAR(50),
          paid_at              TIMESTAMPTZ,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TRIGGER trg_payments_updated_at
          BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    // ── 12. JOB QUEUE ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE job_queue (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_type     VARCHAR(100) NOT NULL,
          payload      JSONB NOT NULL,
          status       VARCHAR(30) DEFAULT 'pending'
              CHECK (status IN ('pending','processing','completed','failed')),
          attempts     INT DEFAULT 0,
          error        TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          processed_at TIMESTAMPTZ
      );
      CREATE INDEX idx_job_queue_status ON job_queue(status, created_at);
    `);

    // ── 13. AUDIT LOGS ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE audit_logs (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          table_name VARCHAR(100) NOT NULL,
          record_id  UUID,
          action     VARCHAR(20) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT','ACTION')),
          old_values JSONB,
          new_values JSONB,
          description TEXT,
          user_id    UUID REFERENCES users(id),
          ip_address VARCHAR(45),
          user_agent TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);
      CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX idx_audit_user ON audit_logs(user_id);
    `);

    // ── VALIDATION TRIGGERS ───────────────────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION validate_customer_party()
      RETURNS TRIGGER AS $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.customer_party_id AND is_customer = true) THEN
              RAISE EXCEPTION 'party % is not flagged as a customer', NEW.customer_party_id;
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_validate_so_customer
          BEFORE INSERT OR UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION validate_customer_party();

      CREATE OR REPLACE FUNCTION validate_vendor_party()
      RETURNS TRIGGER AS $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.vendor_party_id AND is_vendor = true) THEN
              RAISE EXCEPTION 'party % is not flagged as a vendor', NEW.vendor_party_id;
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_validate_po_vendor
          BEFORE INSERT OR UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION validate_vendor_party();
    `);

    // ── INDEXES ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX idx_users_role ON users(role);
      CREATE INDEX idx_users_active ON users(is_active);
      CREATE INDEX idx_products_sku ON products(sku);
      CREATE INDEX idx_products_active ON products(is_active);
      CREATE INDEX idx_products_type ON products(product_type);
      CREATE INDEX idx_parties_active ON parties(is_active);
      CREATE INDEX idx_bom_product ON bom(product_id);
      CREATE INDEX idx_sales_orders_status ON sales_orders(status);
      CREATE INDEX idx_sales_orders_customer ON sales_orders(customer_party_id);
      CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
      CREATE INDEX idx_mfg_orders_status ON manufacturing_orders(status);
      CREATE INDEX idx_mfg_orders_product ON manufacturing_orders(product_id);
      CREATE INDEX idx_work_orders_mo ON work_orders(manufacturing_order_id);
    `);

    console.log('✅ Schema applied successfully!\n');
    const res = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    console.log(`📋 ${res.rows.length} tables created:`);
    res.rows.forEach(r => console.log('  ✓', r.tablename));

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupSchema();
