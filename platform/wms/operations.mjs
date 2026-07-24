import crypto from 'node:crypto';
import { postStockMove } from '../inventory/ledger.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';

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

export function validatePickingGoverned(db, payload) {
  const {
    picking_id,
    moves = [],
    company_id,
    branch_id = null,
    actor,
    idempotency_key,
  } = payload;
  const picking = db.prepare(`
    SELECT * FROM stock_pickings WHERE id = ? AND company_id = ?
  `).get(picking_id, company_id);
  if (!picking) throw new Error(`Picking not found: ${picking_id}`);
  if (picking.state === 'done') throw new Error('Picking is already validated');
  if (!moves.length) throw new Error('Picking validation requires executed move lines');

  const postedMoves = [];
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    const saleDemand = db.prepare(`
      SELECT * FROM sale_fulfilment_demands
      WHERE picking_id = ? AND product_id = ? AND status = 'reserved'
      ORDER BY created_at, id LIMIT 1
    `).get(picking_id, move.product_id);
    const purchaseDemand = saleDemand ? null : db.prepare(`
      SELECT * FROM purchase_fulfilment_demands
      WHERE picking_id = ? AND product_id = ? AND status = 'awaiting_receipt'
      ORDER BY created_at, id LIMIT 1
    `).get(picking_id, move.product_id);
    const sourceType = saleDemand ? 'sale_order' : purchaseDemand ? 'purchase_order' : 'stock_picking';
    const sourceId = saleDemand?.sale_order_id || purchaseDemand?.purchase_order_id || picking.id;
    const sourceLineId = saleDemand?.sale_order_line_id || purchaseDemand?.purchase_order_line_id || null;

    const posted = executeStockOperation(db, {
      ...move,
      company_id,
      branch_id,
      actor,
      reference: picking.reference,
      location_id: picking.location_id,
      location_dest_id: picking.location_dest_id,
      source_document_type: sourceType,
      source_document_id: sourceId,
      source_line_id: sourceLineId,
      reservation_id: saleDemand?.reservation_id || null,
      idempotency_key: `${idempotency_key}:move:${index}`,
    });
    postedMoves.push(posted);
    if (saleDemand) {
      db.prepare("UPDATE sale_fulfilment_demands SET status = 'delivered' WHERE id = ?").run(saleDemand.id);
    }
    if (purchaseDemand) {
      db.prepare("UPDATE purchase_fulfilment_demands SET status = 'received' WHERE id = ?").run(purchaseDemand.id);
    }
  }

  db.prepare("UPDATE stock_pickings SET state = 'done' WHERE id = ?").run(picking_id);
  return {
    ...db.prepare('SELECT * FROM stock_pickings WHERE id = ?').get(picking_id),
    moves: postedMoves,
  };
}
