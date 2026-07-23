import crypto from 'node:crypto';
import { postStockMove } from '../inventory/ledger.mjs';

function makeId(prefix = 'pik') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createPicking(db, pickingData) {
  const {
    company_id = '*',
    picking_type_id,
    reference,
    origin = '',
    location_id,
    location_dest_id,
    partner_id = null,
    scheduled_date = new Date().toISOString(),
  } = pickingData;

  if (!picking_type_id || !reference || !location_id || !location_dest_id) {
    throw new Error('Picking type ID, reference, location_id, and location_dest_id are required');
  }

  const id = makeId('pik');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO stock_pickings (
      id, company_id, picking_type_id, reference, origin, location_id, location_dest_id, partner_id, state, scheduled_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(id, company_id, picking_type_id, reference, origin, location_id, location_dest_id, partner_id, scheduled_date, now);

  return db.prepare(`SELECT * FROM stock_pickings WHERE id = ?`).get(id);
}

export function validatePicking(db, { picking_id, moves = [] }) {
  const picking = db.prepare(`SELECT * FROM stock_pickings WHERE id = ?`).get(picking_id);
  if (!picking) throw new Error(`Picking not found: ${picking_id}`);
  if (picking.state === 'done') throw new Error('Picking is already validated');

  // Post all stock moves associated with this picking
  for (const move of moves) {
    postStockMove(db, {
      company_id: picking.company_id,
      reference: picking.reference,
      product_id: move.product_id,
      uom_id: move.uom_id,
      product_qty: move.product_qty,
      location_id: picking.location_id,
      location_dest_id: picking.location_dest_id,
      unit_cost: move.unit_cost || 0.0,
    });
  }

  db.prepare(`UPDATE stock_pickings SET state = 'done' WHERE id = ?`).run(picking_id);
  return db.prepare(`SELECT * FROM stock_pickings WHERE id = ?`).get(picking_id);
}
