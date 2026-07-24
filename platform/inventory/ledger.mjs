import crypto from 'node:crypto';
import { recordValuationLayer } from './valuation.mjs';

function makeId(prefix = 'smove') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function postStockMove(db, moveData) {
  const ownsTransaction = !db.isTransaction;
  if (ownsTransaction) db.exec('BEGIN IMMEDIATE;');
  try {
    const result = postStockMoveInsideTransaction(db, moveData);
    if (ownsTransaction) db.exec('COMMIT;');
    return result;
  } catch (error) {
    if (ownsTransaction) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
    }
    throw error;
  }
}

function postStockMoveInsideTransaction(db, moveData) {
  const {
    id: inputId,
    company_id = '*',
    branch_id = null,
    reference,
    product_id,
    uom_id,
    product_qty,
    location_id,
    location_dest_id,
    unit_cost = 0.0,
    move_date = new Date().toISOString(),
    currency = 'IQD',
    lot_id = null,
    serial_id = null,
    package_id = null,
    source_document_type = null,
    source_document_id = null,
    source_line_id = null,
    reversal_of_line_id = null,
    idempotency_key = null,
  } = moveData;

  if (!reference || !product_id || !uom_id || !product_qty || !location_id || !location_dest_id) {
    throw new Error('Reference, product_id, uom_id, product_qty, location_id, and location_dest_id are required');
  }

  const qty = Number(product_qty);
  if (qty <= 0) throw new Error('Product quantity must be greater than zero');
  if (location_id === location_dest_id) throw new Error('Source and destination locations must differ');

  const moveId = inputId || makeId('smove');
  const now = new Date().toISOString();
  const lineIdempotencyKey = idempotency_key || `${moveId}:line`;

  const duplicate = db.prepare(`
    SELECT sm.* FROM stock_move_lines sml
    JOIN stock_moves sm ON sm.id = sml.move_id
    WHERE sml.company_id = ? AND sml.idempotency_key = ?
  `).get(company_id, lineIdempotencyKey);
  if (duplicate) return duplicate;

  const product = db.prepare(`
    SELECT id FROM product_variants WHERE id = ? AND company_id = ?
  `).get(product_id, company_id);
  if (!product) throw new Error(`Product variant is outside the active company: ${product_id}`);
  const source = db.prepare(`
    SELECT id, usage, warehouse_id FROM stock_locations WHERE id = ? AND company_id = ?
  `).get(location_id, company_id);
  const destination = db.prepare(`
    SELECT id, usage, warehouse_id FROM stock_locations WHERE id = ? AND company_id = ?
  `).get(location_dest_id, company_id);
  if (!source || !destination) throw new Error('Source and destination must belong to the active company');
  if (branch_id) {
    for (const location of [source, destination]) {
      if (!location.warehouse_id) continue;
      const scoped = db.prepare(`
        SELECT 1 FROM warehouse_branch_scopes
        WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
      `).get(location.warehouse_id, company_id, branch_id);
      if (!scoped) throw new Error('Stock location is outside the active branch scope');
    }
  }
  if (serial_id && qty !== 1) throw new Error('A serialized move line must have quantity 1');
  if (lot_id) {
    const lot = db.prepare('SELECT id FROM stock_lots WHERE id = ? AND company_id = ? AND product_id = ?').get(lot_id, company_id, product_id);
    if (!lot) throw new Error('Lot is invalid for the active company and product');
  }
  if (serial_id) {
    const serial = db.prepare('SELECT id FROM stock_serials WHERE id = ? AND company_id = ? AND product_id = ?').get(serial_id, company_id, product_id);
    if (!serial) throw new Error('Serial is invalid for the active company and product');
  }

  if (source.usage === 'internal' || source.usage === 'transit') {
    const sourceQuant = db.prepare(`
      SELECT quantity, reserved_quantity FROM stock_quants
      WHERE company_id = ? AND product_id = ? AND location_id = ?
    `).get(company_id, product_id, location_id);
    const available = Number(sourceQuant?.quantity || 0) - Number(sourceQuant?.reserved_quantity || 0);
    if (available + 0.0000001 < qty) {
      throw new Error(`Available stock insufficient by ${qty - available}`);
    }
  }

  // Insert immutable stock move in 'done' state
  db.prepare(`
    INSERT INTO stock_moves (
      id, company_id, reference, product_id, uom_id, product_qty,
      location_id, location_dest_id, state, unit_cost, total_value, move_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?)
  `).run(moveId, company_id, reference, product_id, uom_id, qty, location_id, location_dest_id, Number(unit_cost), 0, move_date, now);

  db.prepare(`
    INSERT INTO stock_move_lines (
      id, company_id, move_id, product_id, lot_id, serial_id, package_id,
      source_document_type, source_document_id, source_line_id, quantity,
      uom_id, idempotency_key, reversal_of_line_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('smline'),
    company_id,
    moveId,
    product_id,
    lot_id,
    serial_id,
    package_id,
    source_document_type,
    source_document_id,
    source_line_id,
    qty,
    uom_id,
    lineIdempotencyKey,
    reversal_of_line_id,
    now,
  );

  // Balance rows are rebuildable projections over immutable move lines.
  updateQuant(db, { company_id, product_id, location_id, deltaQty: -qty });
  updateQuant(db, { company_id, product_id, location_id: location_dest_id, deltaQty: qty });

  const valuationFact = recordValuationLayer(db, {
    moveId,
    company_id,
    product_id,
    quantity: qty,
    unitCost: Number(unit_cost),
    location_id,
    location_dest_id,
    currency,
    move_date,
  });

  const totalValue = Math.abs(Number(valuationFact?.value || 0));
  db.prepare('UPDATE stock_moves SET unit_cost = ?, total_value = ? WHERE id = ?').run(
    valuationFact ? Number(valuationFact.unit_cost) : Number(unit_cost),
    totalValue,
    moveId,
  );
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
  let sql = 'SELECT SUM(quantity) as on_hand, SUM(reserved_quantity) as reserved FROM stock_quants WHERE company_id = ? AND product_id = ?';
  const params = [company_id, product_id];

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
  // Clear quants and re-calculate strictly from immutable executed move lines.
  db.prepare('DELETE FROM stock_quants WHERE company_id = ?').run(company_id);

  const moves = db.prepare(`
    SELECT sml.company_id, sml.product_id, sm.location_id, sm.location_dest_id,
           sml.quantity AS product_qty
    FROM stock_move_lines sml
    JOIN stock_moves sm ON sm.id = sml.move_id
    WHERE sm.state = 'done' AND sml.company_id = ?
  `).all(company_id);

  for (const move of moves) {
    updateQuant(db, { company_id: move.company_id, product_id: move.product_id, location_id: move.location_id, deltaQty: -move.product_qty });
    updateQuant(db, { company_id: move.company_id, product_id: move.product_id, location_id: move.location_dest_id, deltaQty: move.product_qty });
  }

  const reservations = db.prepare(`
    SELECT
      r.product_id,
      r.location_id,
      r.quantity
        - COALESCE(SUM(CASE WHEN e.event_type IN ('consumed','released','expired') THEN e.quantity ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN e.event_type = 'reversed' THEN e.quantity ELSE 0 END), 0)
        AS remaining_quantity
    FROM stock_reservations r
    LEFT JOIN stock_reservation_events e ON e.reservation_id = r.id
    WHERE r.company_id = ?
    GROUP BY r.id
    HAVING remaining_quantity > 0
  `).all(company_id);
  for (const reservation of reservations) {
    const quant = db.prepare(`
      SELECT id, quantity, reserved_quantity FROM stock_quants
      WHERE company_id = ? AND product_id = ? AND location_id = ?
    `).get(company_id, reservation.product_id, reservation.location_id);
    if (!quant) throw new Error('Reservation references a missing stock balance during rebuild');
    const nextReserved = Number(quant.reserved_quantity || 0) + Number(reservation.remaining_quantity);
    if (nextReserved > Number(quant.quantity || 0) + 0.0000001) {
      throw new Error('Reservation reconciliation exceeds rebuilt on-hand stock');
    }
    db.prepare('UPDATE stock_quants SET reserved_quantity = ?, updated_at = ? WHERE id = ?').run(
      nextReserved,
      new Date().toISOString(),
      quant.id,
    );
  }
}
