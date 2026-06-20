// db/seed.js — Comprehensive seed data for Shiv Furniture ERP
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    console.log('🔌 Connected to Neon Database. Seeding comprehensive demo data...\n');

    // ── 1. USERS ──────────────────────────────────────────────────────────────
    console.log('👤 Seeding users...');
    const adminHash = await bcrypt.hash('admin123', 12);
    const userHash  = await bcrypt.hash('user123', 12);

    const userRows = await client.query(`
      INSERT INTO users (login_id, email, password_hash, full_name, role) VALUES
        ('ADM001', 'admin@shivfurniture.com', $1, 'Admin Kumar', 'admin'),
        ('SAL001', 'sales@shivfurniture.com', $2, 'Priya Singh', 'sales_user'),
        ('SAL002', 'sales2@shivfurniture.com', $2, 'Anil Sharma', 'sales_user'),
        ('PUR001', 'purchase@shivfurniture.com', $2, 'Ravi Sharma', 'purchase_user'),
        ('MFG001', 'manufacturing@shivfurniture.com', $2, 'Arjun Patel', 'manufacturing_user'),
        ('MFG002', 'manufacturing2@shivfurniture.com', $2, 'Sanjay Dutt', 'manufacturing_user'),
        ('INV001', 'inventory@shivfurniture.com', $2, 'Meera Joshi', 'inventory_manager'),
        ('OWN001', 'owner@shivfurniture.com', $1, 'Shiv Agarwal', 'business_owner')
      ON CONFLICT (email) DO NOTHING RETURNING id, login_id, role
    `, [adminHash, userHash]);
    console.log(`✓ Users created.`);

    // Get Admin ID
    const adminRes = await client.query(`SELECT id FROM users WHERE login_id = 'ADM001'`);
    const adminId = adminRes.rows[0]?.id;

    // ── 2. ACCESS RIGHTS ──────────────────────────────────────────────────────
    console.log('🔐 Configuring access rights...');
    const usersList = await client.query(`SELECT id, role FROM users`);
    const modules = ['products','sales','purchase','manufacturing','bom','inventory','audit_logs','users'];

    for (const u of usersList.rows) {
      for (const mod of modules) {
        let access = 'none';
        if (u.role === 'admin') access = 'admin';
        else if (u.role === 'business_owner') access = 'user';
        else if (u.role === 'sales_user' && ['sales','products','inventory'].includes(mod)) access = 'user';
        else if (u.role === 'purchase_user' && ['purchase','sales','inventory','products'].includes(mod)) access = 'user';
        else if (u.role === 'manufacturing_user' && ['manufacturing','bom','inventory'].includes(mod)) access = 'user';
        else if (u.role === 'inventory_manager' && ['inventory','products'].includes(mod)) access = 'admin';
        else if (u.role === 'inventory_manager') access = 'user';

        await client.query(`
          INSERT INTO user_access_rights (user_id, module, access_type) 
          VALUES ($1, $2, $3) 
          ON CONFLICT (user_id, module) DO NOTHING
        `, [u.id, mod, access]);
      }
    }
    console.log('✓ User access rights configured.');

    // ── 3. WORK CENTERS ───────────────────────────────────────────────────────
    console.log('🏭 Seeding work centers...');
    await client.query(`
      INSERT INTO work_centers (name, description, capacity) VALUES
        ('CNC Machine Bay', 'Precision wood cutting and planning machines', 2),
        ('Assembly Line A', 'Primary furniture joining & gluing station', 3),
        ('Assembly Line B', 'Secondary assembly for chairs and stools', 2),
        ('Paint Floor', 'Painting, varnishing, and mahogany polish spray floors', 4),
        ('Packaging Unit', 'Final packing, cushioning, and labelling', 5),
        ('Quality Control', 'Visual inspection and stability QC station', 2)
      ON CONFLICT DO NOTHING
    `);
    
    const wcIds = await client.query(`SELECT id, name FROM work_centers ORDER BY name`);
    const wcMap = {};
    wcIds.rows.forEach(w => wcMap[w.name] = w.id);
    console.log(`✓ Work centers set up.`);

    // ── 4. PARTIES ────────────────────────────────────────────────────────
    console.log('🤝 Seeding customer and vendor parties...');
    await client.query(`
      INSERT INTO parties (name, email, phone, gstin, address, city, state, pincode, is_vendor, is_customer) VALUES
        ('Roshan Enterprises', 'roshan@enterprise.com', '9876543210', '29ABCDE1234F1Z5', 'Plot 12, Industrial Area', 'Ahmedabad', 'Gujarat', '380001', true, false),
        ('Krishna Wood Suppliers', 'krishna@wood.com', '9765432109', '24XYZAB5678G2H6', '45 Timber Market', 'Surat', 'Gujarat', '395001', true, false),
        ('Mehta Hardware Co.', 'mehta@hardware.com', '9654321098', '27PQRST9012I3J7', '78 Hardware Bazaar', 'Mumbai', 'Maharashtra', '400001', true, false),
        ('Verma Fabrics Ltd.', 'verma@fabrics.com', '9543210987', '06UVWXY3456K4L8', '23 Textile Colony', 'Panipat', 'Haryana', '132103', true, false),
        ('Apex Timber & Logs', 'apex@timber.com', '9912345678', '24APTBL9912C1Z4', 'GIDC Sector 3', 'Gandhinagar', 'Gujarat', '382010', true, false),
        ('Global Adhesives Ltd', 'sales@globalglues.com', '9923456789', '24GLBGL7711B1Z2', 'Adhesive Park Road', 'Vadodara', 'Gujarat', '390001', true, false),
        ('Sunrise Exports', 'sunrise@exports.com', '9987654321', '29NOPQR6789S7T1', '88 Export Zone', 'Pune', 'Maharashtra', '411001', true, true),
        
        ('Raj Interiors Pvt Ltd', 'raj@interiors.com', '9432109876', '24RJINT8812A1Z1', 'Shop 5, Furniture Street', 'Bangalore', 'Karnataka', '560001', false, true),
        ('Modern Office Solutions', 'modern@office.com', '9321098765', '29DEFGH7890M5N9', '102 Business Park', 'Hyderabad', 'Telangana', '500001', false, true),
        ('HomeDecor Plus', 'home@decor.com', '9210987654', null, '67 Retail Hub', 'Chennai', 'Tamil Nadu', '600001', false, true),
        ('Corporate Furnishings', 'corporate@furnish.com', '9109876543', '07IJKLM2345O6P0', '34 Corporate Avenue', 'Gurugram', 'Haryana', '122001', false, true),
        ('City Mall Furniture', 'citymall@furniture.com', '9098765432', null, 'Mall Road, Block C', 'Jaipur', 'Rajasthan', '302001', false, true),
        ('Elite Spaces Design', 'elite@spaces.com', '9934567812', '24ELISP1122D1Z3', 'Design Studio, Alkapuri', 'Vadodara', 'Gujarat', '390007', false, true),
        ('Vertex Commercials', 'info@vertexcom.com', '9945678123', null, 'Commercial Plaza 4A', 'Indore', 'Madhya Pradesh', '452001', false, true),
        ('Prestige Properties', 'procure@prestige.com', '9956781234', '27PRSTG2233K1Z6', 'Prestige Tower, Bandra', 'Mumbai', 'Maharashtra', '400051', false, true)
      ON CONFLICT DO NOTHING
    `);

    const vendorIds = (await client.query(`SELECT id, name FROM parties WHERE is_vendor = true`)).rows;
    const customerIds = (await client.query(`SELECT id, name FROM parties WHERE is_customer = true`)).rows;
    console.log(`✓ Parties created.`);

    // ── 5. PRODUCTS ──────────────────────────────────────────────────────────
    console.log('🏷️  Seeding products catalog...');
    
    // Raw materials
    const rawList = [
      ['Teak Wood Plank (6ft)', 'RM-TWP-001', 'raw_material', 0, 850.00, 10000, 'pieces', 100],
      ['Pine Wood Sheet (4x8)', 'RM-PWS-002', 'raw_material', 0, 620.00, 10000, 'pieces', 80],
      ['MDF Board (18mm)', 'RM-MDF-003', 'raw_material', 0, 450.00, 10000, 'pieces', 60],
      ['MS Steel Rod (10mm)', 'RM-MSR-004', 'raw_material', 0, 280.00, 10000, 'kg', 50],
      ['Upholstery Foam (2")', 'RM-UPF-005', 'raw_material', 0, 180.00, 10000, 'sq_mt', 40],
      ['Fabric - Brown Velvet', 'RM-FBV-006', 'raw_material', 0, 320.00, 10000, 'meters', 30],
      ['Wood Screw (3")', 'RM-WSC-007', 'raw_material', 0, 2.50, 100000, 'pieces', 2000],
      ['Dowel Pin (8mm)', 'RM-DWP-008', 'raw_material', 0, 5.00, 100000, 'pieces', 1500],
      ['Wood Polish - Mahogany', 'RM-WPM-009', 'raw_material', 0, 650.00, 10000, 'liters', 20],
      ['Sandpaper (120 grit)', 'RM-SND-010', 'raw_material', 0, 25.00, 10000, 'pieces', 100],
      ['Corner Bracket (Metal)', 'RM-CBM-011', 'raw_material', 0, 35.00, 50000, 'pieces', 400],
      ['Hinge (3" Stainless)', 'RM-HNG-012', 'raw_material', 0, 45.00, 50000, 'pieces', 300],
      ['Handle (Chrome)', 'RM-HND-013', 'raw_material', 0, 120.00, 50000, 'pieces', 150],
      ['Glass Panel (Toughened)', 'RM-GLP-014', 'raw_material', 0, 950.00, 10000, 'pieces', 15],
      ['PVC Edge Tape (2m roll)', 'RM-PVC-015', 'raw_material', 0, 40.00, 10000, 'rolls', 50]
    ];

    for (const r of rawList) {
      await client.query(`
        INSERT INTO products (name, sku, product_type, sales_price, cost_price, on_hand_qty, unit_of_measure, min_stock_level, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (sku) DO NOTHING
      `, [...r, adminId]);
    }

    // Finished Goods
    const fgList = [
      ['Executive Wooden Table', 'FG-EWT-001', 'finished_good', 18500.00, 9200.00, 2000, 'pieces', 8],
      ['Office Chair (Ergonomic)', 'FG-OCE-002', 'finished_good', 12800.00, 6400.00, 2000, 'pieces', 10],
      ['Dining Table (6-seater)', 'FG-DT6-003', 'finished_good', 32000.00, 15800.00, 2000, 'pieces', 4],
      ['Wooden Wardrobe (3-door)', 'FG-WW3-004', 'finished_good', 28500.00, 14200.00, 2000, 'pieces', 3],
      ['Bookshelf (5-shelf)', 'FG-BS5-005', 'finished_good', 8900.00, 4400.00, 2000, 'pieces', 6],
      ['Coffee Table', 'FG-CFT-006', 'finished_good', 6500.00, 3200.00, 2000, 'pieces', 10],
      ['Sofa Set (3+2+1)', 'FG-SFA-007', 'finished_good', 65000.00, 32000.00, 2000, 'sets', 2],
      ['TV Cabinet', 'FG-TVC-008', 'finished_good', 11200.00, 5600.00, 2000, 'pieces', 5],
      ['Study Desk with Shelf', 'FG-SDS-009', 'finished_good', 9800.00, 4900.00, 2000, 'pieces', 6],
      ['Bed Frame (Queen)', 'FG-BFQ-010', 'finished_good', 22000.00, 11000.00, 2000, 'pieces', 4]
    ];

    for (const fg of fgList) {
      await client.query(`
        INSERT INTO products (name, sku, product_type, sales_price, cost_price, on_hand_qty, unit_of_measure, min_stock_level, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (sku) DO NOTHING
      `, [...fg, adminId]);
    }

    const allProducts = await client.query(`SELECT id, sku, name, cost_price, sales_price FROM products`);
    const prodMap = {};
    allProducts.rows.forEach(p => prodMap[p.sku] = p);
    console.log(`✓ Products created.`);

    // ── 6. PROCUREMENT CONFIG ─────────────────────────────────────────────────
    console.log('⚙️  Seeding procurement configurations...');
    for (const p of allProducts.rows) {
      const isRM = p.sku.startsWith('RM-');
      const isFG = p.sku.startsWith('FG-');
      
      await client.query(`
        INSERT INTO product_procurement (product_id, strategy, procurement_type, procure_on_demand, vendor_party_id, lead_time_days, min_order_qty, reorder_point)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (product_id) DO NOTHING
      `, [
        p.id, 
        isRM ? 'MTO' : 'MTS', 
        isRM ? 'purchase' : 'manufacturing', 
        true, 
        isRM ? vendorIds[0].id : null, 
        isRM ? 7 : 14, 
        isRM ? 5.00 : 1.00, 
        isRM ? 20.00 : 5.00
      ]);
    }
    console.log('✓ Procurement configurations mapped.');

    // ── 7. BILL OF MATERIALS (BOM) ───────────────────────────────────────────
    console.log('📋 Seeding Bill of Materials (BOM)...');
    
    // BOM 1: Executive Wooden Table (FG-EWT-001)
    const bom1 = await client.query(`
      INSERT INTO bom (product_id, name, version, quantity, notes, created_by)
      VALUES ($1, 'Executive Wooden Table v1', 1, 1, 'Standard premium executive teak wood table with edge finishing', $2)
      ON CONFLICT (product_id, version) DO NOTHING RETURNING id
    `, [prodMap['FG-EWT-001'].id, adminId]);

    if (bom1.rows.length) {
      const bId = bom1.rows[0].id;
      await client.query(`
        INSERT INTO bom_components (bom_id, component_id, quantity) VALUES
          ($1, $2, 4), -- 4 Teak Planks
          ($1, $3, 12), -- 12 Wood Screws
          ($1, $4, 0.5), -- 0.5L mahogany polish
          ($1, $5, 2), -- 2 sheets sandpaper
          ($1, $6, 0.25) -- edge tape
      `, [bId, prodMap['RM-TWP-001'].id, prodMap['RM-WSC-007'].id, prodMap['RM-WPM-009'].id, prodMap['RM-SND-010'].id, prodMap['RM-PVC-015'].id]);

      await client.query(`
        INSERT INTO bom_operations (bom_id, operation_name, duration_minutes, work_center_id, sequence_order) VALUES
          ($1, 'CNC Wood Cutting', 60, $2, 1),
          ($1, 'Frame & Top Joining', 90, $3, 2),
          ($1, 'Manual Sanding', 45, $4, 3),
          ($1, 'Mahogany Polish Spraying', 120, $5, 4),
          ($1, 'Quality Check', 20, $6, 5),
          ($1, 'Packaging', 15, $7, 6)
      `, [bId, wcMap['CNC Machine Bay'], wcMap['Assembly Line A'], wcMap['Paint Floor'], wcMap['Paint Floor'], wcMap['Quality Control'], wcMap['Packaging Unit']]);

      await client.query(`UPDATE product_procurement SET bom_id = $1, procurement_type = 'manufacturing' WHERE product_id = $2`, [bId, prodMap['FG-EWT-001'].id]);
    }

    // BOM 2: Office Chair Ergonomic (FG-OCE-002)
    const bom2 = await client.query(`
      INSERT INTO bom (product_id, name, version, quantity, notes, created_by)
      VALUES ($1, 'Office Chair Ergonomic v1', 1, 1, 'Standard office chair with velvet and foam cushioning', $2)
      ON CONFLICT (product_id, version) DO NOTHING RETURNING id
    `, [prodMap['FG-OCE-002'].id, adminId]);

    if (bom2.rows.length) {
      const bId = bom2.rows[0].id;
      await client.query(`
        INSERT INTO bom_components (bom_id, component_id, quantity) VALUES
          ($1, $2, 2), -- 2 MDF boards
          ($1, $3, 1), -- 1 sq_mt foam
          ($1, $4, 1.5), -- 1.5m velvet fabric
          ($1, $5, 8), -- 8 screws
          ($1, $6, 2) -- 2 steel rods
      `, [bId, prodMap['RM-MDF-003'].id, prodMap['RM-UPF-005'].id, prodMap['RM-FBV-006'].id, prodMap['RM-WSC-007'].id, prodMap['RM-MSR-004'].id]);

      await client.query(`
        INSERT INTO bom_operations (bom_id, operation_name, duration_minutes, work_center_id, sequence_order) VALUES
          ($1, 'MDF Cutting & Shaping', 40, $2, 1),
          ($1, 'Steel Frame Assembly', 45, $3, 2),
          ($1, 'Velvet Cushion Upholstery', 60, $4, 3),
          ($1, 'Final Chair Assembly', 30, $5, 4),
          ($1, 'Stability Inspection & Packing', 20, $6, 5)
      `, [bId, wcMap['CNC Machine Bay'], wcMap['Assembly Line B'], wcMap['Assembly Line A'], wcMap['Assembly Line B'], wcMap['Packaging Unit']]);

      await client.query(`UPDATE product_procurement SET bom_id = $1, procurement_type = 'manufacturing' WHERE product_id = $2`, [bId, prodMap['FG-OCE-002'].id]);
    }

    // BOM 3: Dining Table (FG-DT6-003)
    const bom3 = await client.query(`
      INSERT INTO bom (product_id, name, version, quantity, notes, created_by)
      VALUES ($1, 'Dining Table 6-Seater v1', 1, 1, 'Solid teak dining table with bracket joins', $2)
      ON CONFLICT (product_id, version) DO NOTHING RETURNING id
    `, [prodMap['FG-DT6-003'].id, adminId]);

    if (bom3.rows.length) {
      const bId = bom3.rows[0].id;
      await client.query(`
        INSERT INTO bom_components (bom_id, component_id, quantity) VALUES
          ($1, $2, 6), -- 6 Teak planks
          ($1, $3, 24), -- 24 screws
          ($1, $4, 0.75), -- polish
          ($1, $5, 2), -- Sandpaper
          ($1, $6, 8) -- 8 corner brackets
      `, [bId, prodMap['RM-TWP-001'].id, prodMap['RM-WSC-007'].id, prodMap['RM-WPM-009'].id, prodMap['RM-SND-010'].id, prodMap['RM-CBM-011'].id]);

      await client.query(`
        INSERT INTO bom_operations (bom_id, operation_name, duration_minutes, work_center_id, sequence_order) VALUES
          ($1, 'Log Slicing & Planning', 90, $2, 1),
          ($1, 'Leg Assembly & Bracketing', 100, $3, 2),
          ($1, 'Sanding & Finish Prep', 60, $4, 3),
          ($1, 'Surface Gloss Polishing', 120, $5, 4),
          ($1, 'Load Check & Packing', 25, $6, 5)
      `, [bId, wcMap['CNC Machine Bay'], wcMap['Assembly Line A'], wcMap['Paint Floor'], wcMap['Paint Floor'], wcMap['Packaging Unit']]);

      await client.query(`UPDATE product_procurement SET bom_id = $1, procurement_type = 'manufacturing' WHERE product_id = $2`, [bId, prodMap['FG-DT6-003'].id]);
    }
    console.log('✓ BOMs seeded successfully.');

    // ── 8. SEED SALES ORDERS (25 records) ────────────────────────────────────
    console.log('📊 Seeding 25 Sales Orders across various lifecycles...');
    const salesUser = (await client.query(`SELECT id FROM users WHERE login_id = 'SAL001'`)).rows[0]?.id;
    const soList = [];

    const soStatusList = [
      // 5 Fully Delivered
      ['fully_delivered', 'paid'], ['fully_delivered', 'paid'], ['fully_delivered', 'paid'], ['fully_delivered', 'paid'], ['fully_delivered', 'paid'],
      // 5 Payment Done
      ['payment_done', 'paid'], ['payment_done', 'paid'], ['payment_done', 'paid'], ['payment_done', 'paid'], ['payment_done', 'paid'],
      // 5 Partially Delivered
      ['partially_delivered', 'paid'], ['partially_delivered', 'paid'], ['partially_delivered', 'paid'], ['partially_delivered', 'pending'], ['partially_delivered', 'pending'],
      // 3 Payment Pending
      ['payment_pending', 'pending'], ['payment_pending', 'pending'], ['payment_pending', 'pending'],
      // 3 Confirmed
      ['confirmed', 'unpaid'], ['confirmed', 'unpaid'], ['confirmed', 'unpaid'],
      // 2 Cancelled
      ['cancelled', 'unpaid'], ['cancelled', 'unpaid'],
      // 2 Draft
      ['draft', 'unpaid'], ['draft', 'unpaid']
    ];

    const fgs = ['FG-EWT-001', 'FG-OCE-002', 'FG-DT6-003', 'FG-WW3-004', 'FG-BS5-005', 'FG-CFT-006', 'FG-SFA-007', 'FG-TVC-008', 'FG-SDS-009', 'FG-BFQ-010'];

    for (let i = 0; i < 25; i++) {
      const [status, paymentStatus] = soStatusList[i];
      const customer = customerIds[i % customerIds.length];
      const expectedDays = 10 + (i % 15);
      const orderOffset = 30 - i; // stagger dates over the last month

      const soRes = await client.query(`
        INSERT INTO sales_orders (customer_party_id, status, payment_status, order_date, expected_delivery, shipping_address, notes, created_by)
        VALUES ($1, $2, $3, CURRENT_DATE - $4::int, CURRENT_DATE + $5::int, $6, $7, $8)
        RETURNING id, order_number, total_amount
      `, [
        customer.id, 
        status, 
        paymentStatus, 
        orderOffset, 
        expectedDays, 
        `Shipping Address Office ${i + 1}, Commercial Zone`, 
        `Bulk delivery request batch #${i + 100}`, 
        salesUser
      ]);

      if (soRes.rows.length) {
        const so = soRes.rows[0];
        soList.push(so);
        
        // Add 1 to 3 items
        const numItems = (i % 3) + 1;
        for (let j = 0; j < numItems; j++) {
          const sku = fgs[(i + j) % fgs.length];
          const product = prodMap[sku];
          const qty = (i % 3) + 2;
          
          await client.query(`
            INSERT INTO sales_order_lines (sales_order_id, product_id, sequence_order, quantity, delivered_qty, unit_price)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            so.id, 
            product.id, 
            j + 1, 
            qty, 
            (status === 'fully_delivered' ? qty : (status === 'partially_delivered' ? Math.floor(qty/2) : 0)), 
            product.sales_price
          ]);

          // Reserve stock if active
          if (['confirmed', 'payment_pending', 'payment_done', 'partially_delivered'].includes(status)) {
            const reserved = qty - (status === 'fully_delivered' ? qty : (status === 'partially_delivered' ? Math.floor(qty/2) : 0));
            await client.query(`UPDATE products SET reserved_qty = reserved_qty + $1 WHERE id = $2`, [reserved, product.id]);
          }
        }
      }
    }
    console.log(`✓ 25 Sales Orders created and products reserved.`);

    // ── 9. SEED PURCHASE ORDERS (20 records) ─────────────────────────────────
    console.log('🛒 Seeding 20 Purchase Orders...');
    const purUser = (await client.query(`SELECT id FROM users WHERE login_id = 'PUR001'`)).rows[0]?.id;
    const poList = [];

    const poStatuses = [
      'fully_received', 'fully_received', 'fully_received', 'fully_received', 'fully_received', 'fully_received',
      'partially_received', 'partially_received', 'partially_received', 'partially_received',
      'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed',
      'draft', 'draft', 'draft',
      'cancelled', 'cancelled'
    ];

    const rms = ['RM-TWP-001', 'RM-PWS-002', 'RM-MDF-003', 'RM-MSR-004', 'RM-UPF-005', 'RM-FBV-006', 'RM-WSC-007', 'RM-DWP-008', 'RM-WPM-009', 'RM-SND-010'];

    for (let i = 0; i < 20; i++) {
      const status = poStatuses[i];
      const vendor = vendorIds[i % vendorIds.length];
      const receiptOffset = 7 + (i % 10);
      const orderOffset = 25 - i;

      const poRes = await client.query(`
        INSERT INTO purchase_orders (vendor_party_id, status, order_date, expected_receipt, notes, created_by)
        VALUES ($1, $2, CURRENT_DATE - $3::int, CURRENT_DATE + $4::int, $5, $6)
        RETURNING id, order_number
      `, [
        vendor.id, 
        status, 
        orderOffset, 
        receiptOffset, 
        `Raw stock shipment replenishment log #${i + 200}`, 
        purUser
      ]);

      if (poRes.rows.length) {
        const po = poRes.rows[0];
        poList.push(po);

        const numItems = (i % 2) + 1;
        for (let j = 0; j < numItems; j++) {
          const sku = rms[(i + j) % rms.length];
          const product = prodMap[sku];
          const qty = (i % 4 + 1) * 50;

          await client.query(`
            INSERT INTO purchase_order_lines (purchase_order_id, product_id, sequence_order, quantity, received_qty, unit_price)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            po.id, 
            product.id, 
            j + 1, 
            qty, 
            (status === 'fully_received' ? qty : (status === 'partially_received' ? Math.floor(qty/2) : 0)), 
            product.cost_price
          ]);
        }
      }
    }
    console.log(`✓ 20 Purchase Orders created.`);

    // ── 10. SEED MANUFACTURING ORDERS (15 records) ───────────────────────────
    console.log('🏭 Seeding 15 Manufacturing Orders and routing work orders...');
    const mfgUser = (await client.query(`SELECT id FROM users WHERE login_id = 'MFG001'`)).rows[0]?.id;
    const bomEwtId = (await client.query(`SELECT id FROM bom WHERE name LIKE '%Executive%'`)).rows[0]?.id;
    const bomOceId = (await client.query(`SELECT id FROM bom WHERE name LIKE '%Office%'`)).rows[0]?.id;
    const bomDt6Id = (await client.query(`SELECT id FROM bom WHERE name LIKE '%Dining%'`)).rows[0]?.id;

    const boms = [
      { prodId: prodMap['FG-EWT-001'].id, bomId: bomEwtId },
      { prodId: prodMap['FG-OCE-002'].id, bomId: bomOceId },
      { prodId: prodMap['FG-DT6-003'].id, bomId: bomDt6Id }
    ];

    const moStatuses = [
      'completed', 'completed', 'completed', 'completed', 'completed', 'completed',
      'in_progress', 'in_progress', 'in_progress', 'in_progress',
      'confirmed', 'confirmed', 'confirmed',
      'draft',
      'cancelled'
    ];

    for (let i = 0; i < 15; i++) {
      const status = moStatuses[i];
      const activeBom = boms[i % boms.length];
      const qty = (i % 3 + 1) * 5;
      const orderOffset = 20 - i;

      const moRes = await client.query(`
        INSERT INTO manufacturing_orders (product_id, bom_id, quantity, produced_qty, status, planned_start, planned_end, assignee_id, notes, priority, created_by)
        VALUES ($1, $2, $3, $4, $5, now() - $6::interval, now() + $7::interval, $8, $9, $10, $11)
        RETURNING id, order_number
      `, [
        activeBom.prodId, 
        activeBom.bomId, 
        qty, 
        (status === 'completed' ? qty : 0), 
        status, 
        `${orderOffset} days`, 
        `${5} days`, 
        mfgUser, 
        `Furniture manufacturing log scheduling run #${i + 50}`, 
        pickRandom(['low', 'normal', 'high', 'urgent']), 
        adminId
      ]);

      if (moRes.rows.length) {
        const mo = moRes.rows[0];
        
        // Auto-generate routing work orders from BOM operations
        const ops = await client.query(`SELECT * FROM bom_operations WHERE bom_id = $1 ORDER BY sequence_order`, [activeBom.bomId]);
        let seq = 1;
        for (const op of ops.rows) {
          let woStatus = 'pending';
          let doneAt = null;
          let startedAt = null;

          if (status === 'completed') {
            woStatus = 'completed';
            startedAt = new Date();
            doneAt = new Date();
          } else if (status === 'in_progress') {
            if (seq === 1) {
              woStatus = 'completed';
              startedAt = new Date();
              doneAt = new Date();
            } else if (seq === 2) {
              woStatus = 'in_progress';
              startedAt = new Date();
            }
          }

          await client.query(`
            INSERT INTO work_orders (manufacturing_order_id, operation_name, work_center_id, sequence_order, planned_duration_min, status, started_at, completed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            mo.id, 
            op.operation_name, 
            op.work_center_id, 
            seq++, 
            op.duration_minutes, 
            woStatus, 
            startedAt, 
            doneAt
          ]);
        }
      }
    }
    console.log(`✓ 15 Manufacturing Orders and associated work orders populated.`);

    // ── 11. STOCK LEDGER MUTATIONS (Opening, Inward Receipts, Outwards) ───────
    console.log('📈 Seeding stock ledger movements log...');
    // Seed Opening Balances for all products
    for (const p of allProducts.rows) {
      const prodRes = await client.query(`SELECT on_hand_qty FROM products WHERE id = $1`, [p.id]);
      const initialQty = parseFloat(prodRes.rows[0].on_hand_qty);
      await client.query(`
        INSERT INTO stock_ledger (product_id, movement_type, reference_type, reference_id, quantity, unit_cost, running_balance, notes, created_by)
        VALUES ($1, 'opening', 'opening', NULL, $2, $3, $2, 'Opening warehouse stock balance import', $4)
      `, [p.id, initialQty, p.cost_price, adminId]);
    }

    // Purchase Order Receipts (Inward movements)
    const poLines = await client.query(`
      SELECT pol.product_id, pol.received_qty, p.cost_price, po.id 
      FROM purchase_order_lines pol
      JOIN products p ON p.id = pol.product_id
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE pol.received_qty > 0
    `);

    for (const line of poLines.rows) {
      const prod = await client.query(`SELECT on_hand_qty FROM products WHERE id = $1`, [line.product_id]);
      const current = parseFloat(prod.rows[0].on_hand_qty);
      const newBal = current + parseFloat(line.received_qty);

      await client.query(`
        INSERT INTO stock_ledger (product_id, movement_type, reference_type, reference_id, quantity, unit_cost, running_balance, notes, created_by)
        VALUES ($1, 'purchase', 'purchase_order', $2, $3, $4, $5, 'Inward shipment cargo receipt', $6)
      `, [line.product_id, line.id, line.received_qty, line.cost_price, newBal, adminId]);

      await client.query(`UPDATE products SET on_hand_qty = $1 WHERE id = $2`, [newBal, line.product_id]);
    }

    // Sales Order Deliveries (Outward movements)
    const soLines = await client.query(`
      SELECT sol.product_id, sol.delivered_qty, p.cost_price, so.id 
      FROM sales_order_lines sol
      JOIN products p ON p.id = sol.product_id
      JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE sol.delivered_qty > 0
    `);

    for (const line of soLines.rows) {
      const prod = await client.query(`SELECT on_hand_qty FROM products WHERE id = $1`, [line.product_id]);
      const current = parseFloat(prod.rows[0].on_hand_qty);
      const newBal = current - parseFloat(line.delivered_qty);

      await client.query(`
        INSERT INTO stock_ledger (product_id, movement_type, reference_type, reference_id, quantity, unit_cost, running_balance, notes, created_by)
        VALUES ($1, 'sale', 'sales_order', $2, -$3::decimal, $4, $5, 'Outward shipment dispatch to client site', $6)
      `, [line.product_id, line.id, line.delivered_qty, line.cost_price, newBal, adminId]);

      await client.query(`UPDATE products SET on_hand_qty = $1 WHERE id = $2`, [newBal, line.product_id]);
    }
    console.log('✓ Stock ledger ledger entries aligned.');

    // ── 12. PAYMENTS LOG (Razorpay checkout matches) ──────────────────────────
    console.log('💳 Seeding paid order transactions...');
    const paidSales = await client.query(`SELECT id, total_amount FROM sales_orders WHERE status IN ('payment_done', 'fully_delivered', 'partially_delivered')`);
    
    for (const so of paidSales.rows) {
      await client.query(`
        INSERT INTO payments (sales_order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, currency, status, payment_method, paid_at)
        VALUES ($1, $2, $3, $4, $5, 'INR', 'paid', 'credit_card', now() - interval '1 day')
      `, [
        so.id, 
        `order_${Math.random().toString(36).substring(2,15)}`, 
        `pay_${Math.random().toString(36).substring(2,15)}`, 
        `signature_${Math.random().toString(36).substring(2,15)}`, 
        so.total_amount
      ]);
    }
    console.log('✓ Payments transactions logged.');

    // ── 13. AUDIT LOGS (50+ rows for security audit trail) ────────────────────
    console.log('🛡️  Seeding 50+ security audit trail logs...');
    
    const auditActions = ['INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACTION'];
    const auditTables = ['products', 'parties', 'sales_orders', 'purchase_orders', 'manufacturing_orders', 'users', 'bom'];
    
    for (let i = 0; i < 52; i++) {
      const act = auditActions[i % auditActions.length];
      const tbl = auditTables[i % auditTables.length];
      const user = pickRandom(usersList.rows);
      
      await client.query(`
        INSERT INTO audit_logs (table_name, record_id, action, description, user_id, ip_address, user_agent)
        VALUES ($1, NULL, $2, $3, $4, $5, $6)
      `, [
        tbl, 
        act, 
        `Automatic security audit tracking log event #${i + 1000} on ${tbl} with action ${act}`, 
        user.id, 
        `192.168.1.${10 + i}`, 
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36`
      ]);
    }
    console.log('✓ 52 audit trail events generated.');

    console.log('\n🌟 Database seeded successfully with a robust enterprise dataset!');
    console.log('🔑 Operational Login Credentials:');
    console.log('   Admin Lead:     admin@shivfurniture.com / admin123');
    console.log('   Sales Head:     sales@shivfurniture.com / user123');
    console.log('   Purchasing Rep: purchase@shivfurniture.com / user123');
    console.log('   Shopfloor Mgr:  manufacturing@shivfurniture.com / user123');
    console.log('   Inventory Lead: inventory@shivfurniture.com / user123');
    console.log('   Executive Owner: owner@shivfurniture.com / admin123\n');

  } catch (err) {
    console.error('❌ Database seeding error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

seed();
