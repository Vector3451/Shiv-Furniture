// services/stockService.js
// Centralized stock mutation service — ALL stock changes go through here

const { pool } = require('../db');

/**
 * Apply a stock movement:
 *  - Inserts into stock_ledger
 *  - Updates products.on_hand_qty (via direct update for reliability)
 *  - Returns the new running_balance
 */
async function applyMovement({ client: extClient, productId, movementType, referenceType, referenceId, quantity, unitCost, notes, userId }) {
  const db = extClient || pool;

  // Get current on_hand_qty for running balance calculation
  const prod = await db.query(`SELECT on_hand_qty FROM products WHERE id = $1 FOR UPDATE`, [productId]);
  if (!prod.rows.length) throw new Error(`Product ${productId} not found`);

  const currentQty = parseFloat(prod.rows[0].on_hand_qty);
  const newBalance = currentQty + parseFloat(quantity);

  if (newBalance < 0) throw new Error(`Insufficient stock. Available: ${currentQty}, Requested: ${Math.abs(quantity)}`);

  // Insert ledger entry
  const ledger = await db.query(`
    INSERT INTO stock_ledger (product_id, movement_type, reference_type, reference_id, quantity, unit_cost, running_balance, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
  `, [productId, movementType, referenceType, referenceId, quantity, unitCost || null, newBalance, notes || null, userId || null]);

  // Update product stock
  await db.query(`UPDATE products SET on_hand_qty = $1 WHERE id = $2`, [newBalance, productId]);

  return { ledger_id: ledger.rows[0].id, running_balance: newBalance };
}

/**
 * Reserve stock for a sales or manufacturing order
 */
async function reserveStock({ client: extClient, productId, quantity }) {
  const db = extClient || pool;

  const prod = await db.query(`SELECT on_hand_qty, reserved_qty, free_to_use_qty FROM products WHERE id = $1 FOR UPDATE`, [productId]);
  if (!prod.rows.length) throw new Error(`Product ${productId} not found`);

  const free = parseFloat(prod.rows[0].free_to_use_qty);
  const toReserve = parseFloat(quantity);

  if (free < toReserve) return { reserved: Math.min(free, toReserve), shortage: toReserve - free };

  await db.query(`UPDATE products SET reserved_qty = reserved_qty + $1 WHERE id = $2`, [toReserve, productId]);
  return { reserved: toReserve, shortage: 0 };
}

/**
 * Release reserved stock (on cancellation)
 */
async function releaseReservation({ client: extClient, productId, quantity }) {
  const db = extClient || pool;
  await db.query(`
    UPDATE products SET reserved_qty = GREATEST(0, reserved_qty - $1) WHERE id = $2
  `, [quantity, productId]);
}

/**
 * Consume reserved stock on delivery/manufacturing
 * Decreases both on_hand_qty and reserved_qty
 */
async function consumeStock({ client: extClient, productId, quantity, movementType, referenceType, referenceId, notes, userId }) {
  const db = extClient || pool;

  // Release the reservation first
  await db.query(`UPDATE products SET reserved_qty = GREATEST(0, reserved_qty - $1) WHERE id = $2`, [quantity, productId]);

  // Then apply the actual movement (negative quantity)
  return applyMovement({ client: db, productId, movementType, referenceType, referenceId, quantity: -quantity, notes, userId });
}

module.exports = { applyMovement, reserveStock, releaseReservation, consumeStock };
