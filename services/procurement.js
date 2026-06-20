// services/procurement.js
// Auto-procurement engine: MTS/MTO logic

const { pool } = require('../db');
const stockService = require('./stockService');
const queue = require('./queue');

/**
 * Trigger procurement for a sales order after confirmation.
 * For each line item that has a shortage, check the product's procurement strategy.
 */
async function triggerProcurement(salesOrderId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get SO lines with product procurement info
    const lines = await client.query(`
      SELECT
        sol.product_id, sol.quantity, sol.delivered_qty, sol.id as line_id,
        p.name as product_name, p.free_to_use_qty, p.on_hand_qty,
        pp.procure_on_demand, pp.procurement_type, pp.strategy,
        pp.vendor_party_id, pp.bom_id, pp.min_order_qty, pp.lead_time_days
      FROM sales_order_lines sol
      JOIN products p ON p.id = sol.product_id
      LEFT JOIN product_procurement pp ON pp.product_id = sol.product_id
      WHERE sol.sales_order_id = $1
    `, [salesOrderId]);

    const procurementActions = [];

    for (const line of lines.rows) {
      const shortage = parseFloat(line.quantity) - parseFloat(line.free_to_use_qty || 0);
      if (shortage <= 0) continue; // stock is sufficient

      // Only auto-procure if configured
      if (!line.procure_on_demand) continue;

      const qtyNeeded = Math.max(shortage, parseFloat(line.min_order_qty || 1));

      if (line.procurement_type === 'purchase') {
        if (!line.vendor_party_id) {
          procurementActions.push({ type: 'warning', product: line.product_name, msg: 'No vendor configured' });
          continue;
        }

        // Create Purchase Order
        const po = await client.query(`
          INSERT INTO purchase_orders (vendor_party_id, notes, auto_generated, source_so_id, created_by)
          VALUES ($1, $2, true, $3, $4) RETURNING id, order_number
        `, [line.vendor_party_id, `Auto-created for SO shortage: ${line.product_name}`, salesOrderId, userId]);

        await client.query(`
          INSERT INTO purchase_order_lines (purchase_order_id, product_id, quantity, unit_price)
          VALUES ($1, $2, $3, (SELECT cost_price FROM products WHERE id = $2))
        `, [po.rows[0].id, line.product_id, qtyNeeded]);

        // Audit log
        await client.query(`
          INSERT INTO audit_logs (table_name, record_id, action, description, user_id)
          VALUES ('purchase_orders', $1, 'INSERT', $2, $3)
        `, [po.rows[0].id, `Auto-generated PO ${po.rows[0].order_number} for ${line.product_name} (shortage: ${shortage})`, userId]);

        procurementActions.push({ type: 'purchase_order', order: po.rows[0].order_number, product: line.product_name, qty: qtyNeeded });

      } else if (line.procurement_type === 'manufacturing') {
        if (!line.bom_id) {
          procurementActions.push({ type: 'warning', product: line.product_name, msg: 'No BOM configured' });
          continue;
        }

        // Create Manufacturing Order
        const mo = await client.query(`
          INSERT INTO manufacturing_orders (product_id, bom_id, quantity, auto_generated, source_so_id, created_by, notes)
          VALUES ($1, $2, $3, true, $4, $5, $6) RETURNING id, order_number
        `, [line.product_id, line.bom_id, qtyNeeded, salesOrderId, userId, `Auto-created for SO shortage: ${line.product_name}`]);

        // Auto-generate work orders from BoM operations
        const ops = await client.query(`
          SELECT * FROM bom_operations WHERE bom_id = $1 ORDER BY sequence_order
        `, [line.bom_id]);

        for (const op of ops.rows) {
          await client.query(`
            INSERT INTO work_orders (manufacturing_order_id, operation_name, work_center_id, sequence_order, planned_duration_min)
            VALUES ($1, $2, $3, $4, $5)
          `, [mo.rows[0].id, op.operation_name, op.work_center_id, op.sequence_order, op.duration_minutes]);
        }

        await client.query(`
          INSERT INTO audit_logs (table_name, record_id, action, description, user_id)
          VALUES ('manufacturing_orders', $1, 'INSERT', $2, $3)
        `, [mo.rows[0].id, `Auto-generated MO ${mo.rows[0].order_number} for ${line.product_name} (shortage: ${shortage})`, userId]);

        procurementActions.push({ type: 'manufacturing_order', order: mo.rows[0].order_number, product: line.product_name, qty: qtyNeeded });
      }
    }

    // Mark SO as procurement triggered
    await client.query(`UPDATE sales_orders SET procurement_triggered = true WHERE id = $1`, [salesOrderId]);

    await client.query('COMMIT');
    return procurementActions;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { triggerProcurement };
