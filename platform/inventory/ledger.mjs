import crypto from 'node:crypto';
import { recordValuationLayer } from './valuation.mjs';

function makeId(prefix = 'smove') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function postStockMove(db, moveData) {
  const {
    id: inputId,
    company_id = '*',
    reference,
    product_id,
    uom_id,
    product_qty,
    location_id,
    location_dest_id,
    unit_cost = 0.0,
    move_date = new Date().toISOString(),
  } = moveData;

  if (!reference || !product_id || !uom_id || !product_qty || !location_id || !location_dest_id) {
    throw new Error('Reference, product_id, uom_id, product_qty, location_id, and location_dest_id are required');
  }

  const qty = Number(product_qty);
  if (qty <= 0) throw new Error('Product quantity must be greater than zero');

  const moveId = inputId || makeId('smove');
  const now = new Date().toISOString();
  const totalValue = qty * Number(unit_cost);

  // Insert immutable stock move in 'done' state
  db.prepare(`
    INSERT INTO stock_moves (
      id, company_id, reference, product_id, uom_id, product_qty,
      location_id, location_dest_id, state, unit_cost, total_value, move_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?)
  `).run(moveId, company_id, reference, product_id, uom_id, qty, location_id, location_dest_id, Number(unit_cost), totalValue, move_date, now);

  // Update source location quant (decrease quantity)
  updateQuant(db, { company_id, product_id, location_id, deltaQty: -qty });

  // Update destination location quant (increase quantity)
  updateQuant(db, { company_id, product_id, location_id: location_dest_id, deltaQty: qty });

  // Record valuation layer (AVCO / FIFO)
  recordValuationLayer(db, {
    moveId,
    company_id,
    product_id,
    quantity: qty,
    unitCost: Number(unit_cost),
    location_id,
    location_dest_id,
  });

  return db.prepare(`SELECT * FROM stock_moves WHERE id = ?`).get(moveId);
}

function updateQuant(db, { company_id, product_id, location_id, deltaQty }) {
  const now = new Date().toISOString();
  const existing = db.prepare(`
    SELECT * FROM stock_quants WHERE company_id = ? AND product_id = ? AND location_id = ?
  `).get(company_id, product_id, location_id);

  if (existing) {
    db.prepare(`
      UPDATE stock_quants SET quantity = quantity + ?, updated_at = ? WHERE id = ?
    `).run(deltaQty, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO stock_quants (id, company_id, product_id, location_id, quantity, reserved_quantity, updated_at)
      VALUES (?, ?, ?, ?, ?, 0.0, ?)
    `).run(`sq_${crypto.randomBytes(8).toString('hex')}`, company_id, product_id, location_id, deltaQty, now);
  }
}

export function getQuantBalance(db, { company_id = '*', product_id, location_id = null }) {
  let sql = `SELECT SUM(quantity) as on_hand, SUM(reserved_quantity) as reserved FROM stock_quants WHERE (company_id = ? OR company_id = '*' OR ? = '*') AND product_id = ?`;
  const params = [company_id, company_id, product_id];

  if (location_id) {
    sql += ` AND location_id = ?`;
    params.push(location_id);
  }

  const res = db.prepare(sql).get(...params);
  return {
    onHand: res && res.on_hand ? res.on_hand : 0.0,
    reserved: res && res.reserved ? res.reserved : 0.0,
    available: (res && res.on_hand ? res.on_hand : 0.0) - (res && res.reserved ? res.reserved : 0.0),
  };
}

export function rebuildStockQuants(db, { company_id = '*' } = {}) {
  // Clear quants and re-calculate strictly from stock_moves history
  db.prepare(`DELETE FROM stock_quants WHERE company_id = ? OR ? = '*'`).run(company_id, company_id);

  const moves = db.prepare(`
    SELECT company_id, product_id, location_id, location_dest_id, product_qty
    FROM stock_moves WHERE state = 'done' AND (company_id = ? OR ? = '*')
  `).all(company_id, company_id);

  for (const move of moves) {
    updateQuant(db, { company_id: move.company_id, product_id: move.product_id, location_id: move.location_id, deltaQty: -move.product_qty });
    updateQuant(db, { company_id: move.company_id, product_id: move.product_id, location_id: move.location_dest_id, deltaQty: move.product_qty });
  }
}
