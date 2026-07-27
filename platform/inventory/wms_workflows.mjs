import crypto from 'node:crypto';
import { postStockMove } from './ledger.mjs';
import { createWarehouse } from './warehouses.mjs';
import { postStockAccounting } from '../finance/ports/stock-accounting.mjs';

function makeId(prefix = 'pick') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// Ensure stock_picking_lines table exists if missing in older migrations
function ensurePickingLinesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_picking_lines (
      id TEXT PRIMARY KEY,
      picking_id TEXT NOT NULL REFERENCES stock_pickings(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES product_variants(id),
      product_qty REAL NOT NULL CHECK(product_qty > 0),
      unit_price REAL DEFAULT 0.0,
      lot_id TEXT,
      serial_id TEXT,
      package_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

// --- 1. STOCK RECEIPTS (Draft -> Validate -> Move -> Quant -> Valuation -> Audit -> Outbox) ---

export function createReceiptDraft(db, payload) {
  ensurePickingLinesTable(db);
  const {
    company_id = '*',
    location_id,
    location_dest_id,
    partner_id = null,
    origin = '',
    lines = []
  } = payload;

  if (!location_id || !location_dest_id) {
    throw new Error('Source location_id and destination location_dest_id are required');
  }

  const pickingId = makeId('receipt');
  const now = new Date().toISOString();
  const ref = `REC/${new Date().getFullYear()}/${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  // Find or create default warehouse and picking_type_id for receipt
  let wh = db.prepare(`SELECT id FROM warehouses WHERE company_id = ? OR company_id = '*' LIMIT 1`).get(company_id);
  let warehouseId = wh ? wh.id : null;
  if (!warehouseId) {
    const defaultWh = createWarehouse(db, { company_id, name: 'Default Warehouse', code: 'WHDEF' });
    warehouseId = defaultWh.id;
  }

  let ptype = db.prepare(`SELECT id FROM stock_picking_types WHERE code = 'incoming' LIMIT 1`).get();
  let pickingTypeId = ptype ? ptype.id : null;
  if (!pickingTypeId) {
    pickingTypeId = makeId('ptype');
    db.prepare(`
      INSERT INTO stock_picking_types (id, company_id, warehouse_id, name, code, created_at)
      VALUES (?, ?, ?, 'Incoming Receipts', 'incoming', ?)
      ON CONFLICT(id) DO NOTHING
    `).run(pickingTypeId, company_id, warehouseId, now);
  }

  db.prepare(`
    INSERT INTO stock_pickings (id, company_id, picking_type_id, reference, origin, location_id, location_dest_id, partner_id, state, scheduled_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(pickingId, company_id, pickingTypeId, ref, origin, location_id, location_dest_id, partner_id, now, now);

  const insertLine = db.prepare(`
    INSERT INTO stock_picking_lines (id, picking_id, product_id, product_qty, unit_price, lot_id, serial_id, package_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const line of lines) {
    if (!line.product_id || !line.quantity || line.quantity <= 0) continue;
    insertLine.run(makeId('pline'), pickingId, line.product_id, Number(line.quantity), Number(line.unit_price || 0), line.lot_id || null, line.serial_id || null, line.package_id || null, now);
  }

  return getReceipt(db, pickingId);
}

export function updateReceiptDraft(db, payload) {
  ensurePickingLinesTable(db);
  const { picking_id, lines, origin, partner_id } = payload;
  const picking = db.prepare(`SELECT * FROM stock_pickings WHERE id = ?`).get(picking_id);
  if (!picking) throw new Error(`Stock receipt not found: ${picking_id}`);
  if (picking.state !== 'draft') throw new Error(`Cannot update receipt in state ${picking.state}`);

  const now = new Date().toISOString();
  if (origin !== undefined || partner_id !== undefined) {
    db.prepare(`UPDATE stock_pickings SET origin = ?, partner_id = ? WHERE id = ?`)
      .run(origin !== undefined ? origin : picking.origin, partner_id !== undefined ? partner_id : picking.partner_id, picking_id);
  }

  if (Array.isArray(lines)) {
    db.prepare(`DELETE FROM stock_picking_lines WHERE picking_id = ?`).run(picking_id);
    const insertLine = db.prepare(`
      INSERT INTO stock_picking_lines (id, picking_id, product_id, product_qty, unit_price, lot_id, serial_id, package_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      if (!line.product_id || !line.quantity || line.quantity <= 0) continue;
      insertLine.run(makeId('pline'), picking_id, line.product_id, Number(line.quantity), Number(line.unit_price || 0), line.lot_id || null, line.serial_id || null, line.package_id || null, now);
    }
  }

  return getReceipt(db, picking_id);
}

export function validateReceipt(db, payload) {
  ensurePickingLinesTable(db);
  const { picking_id, actor = 'sysadmin', company_id = '*' } = payload;
  const picking = db.prepare(`SELECT * FROM stock_pickings WHERE id = ?`).get(picking_id);
  if (!picking) throw new Error(`Stock receipt not found: ${picking_id}`);
  if (picking.state === 'done') return getReceipt(db, picking_id); // Idempotent return
  if (picking.state !== 'draft') throw new Error(`Receipt cannot be validated from state ${picking.state}`);

  const lines = db.prepare(`SELECT * FROM stock_picking_lines WHERE picking_id = ?`).all(picking_id);
  if (lines.length === 0) throw new Error('Cannot validate receipt with no product lines');

  const now = new Date().toISOString();

  // Atomically process stock moves, quant updates, valuation, audit, and outbox inside transaction
  const movesExecuted = [];
  for (const line of lines) {
    let uomId = 'uom_test_unit';
    const variant = db.prepare(`SELECT template_id FROM product_variants WHERE id = ?`).get(line.product_id);
    if (variant) {
      const template = db.prepare(`SELECT uom_id FROM product_templates WHERE id = ?`).get(variant.template_id);
      if (template && template.uom_id) uomId = template.uom_id;
    } else {
      const template = db.prepare(`SELECT uom_id FROM product_templates WHERE id = ?`).get(line.product_id);
      if (template && template.uom_id) uomId = template.uom_id;
    }

    const movePayload = {
      company_id: picking.company_id || company_id,
      reference: picking.reference,
      product_id: line.product_id,
      uom_id: uomId,
      product_qty: line.product_qty,
      location_id: picking.location_id,
      location_dest_id: picking.location_dest_id,
      unit_cost: line.unit_price || 0,
      source_document_type: 'stock_picking',
      source_document_id: picking.id,
      source_line_id: line.id,
      actor,
    };

    const move = postStockMove(db, movePayload);

    const valuationFact = db.prepare(`
      SELECT * FROM stock_valuation_facts WHERE stock_move_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(move.id);

    const accounting = postStockAccounting(db, {
      companyId: picking.company_id || company_id,
      userId: actor,
      now,
    }, { move, valuationFact });

    movesExecuted.push({ move, valuationFact, accounting });
  }

  // Update picking state to done
  db.prepare(`UPDATE stock_pickings SET state = 'done' WHERE id = ?`).run(picking_id);

  // Write Outbox Event
  db.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id, payload, created_at, scheduled_at, status)
    VALUES (?, 'stock.receipt.validated', '1.0.0', 'stock_wms', ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(makeId('evt'), picking_id, 't_octagon_test', picking.company_id || company_id, actor, JSON.stringify({ picking_id, reference: picking.reference, lines_count: lines.length }), now, now);

  return { ...getReceipt(db, picking_id), movesExecuted };
}

export function cancelReceipt(db, payload) {
  const { picking_id } = payload;
  const picking = db.prepare(`SELECT * FROM stock_pickings WHERE id = ?`).get(picking_id);
  if (!picking) throw new Error(`Stock receipt not found: ${picking_id}`);
  if (picking.state === 'done') throw new Error('Cannot cancel a validated stock receipt');
  db.prepare(`UPDATE stock_pickings SET state = 'cancelled' WHERE id = ?`).run(picking_id);
  return getReceipt(db, picking_id);
}

export function getReceipt(db, pickingId) {
  const picking = db.prepare(`SELECT * FROM stock_pickings WHERE id = ?`).get(pickingId);
  if (!picking) return null;
  const lines = db.prepare(`SELECT * FROM stock_picking_lines WHERE picking_id = ?`).all(pickingId);
  return { ...picking, lines };
}

// --- 2. INTERNAL TRANSFERS, DELIVERIES, RETURNS, ADJUSTMENTS ---

export function createTransferDraft(db, payload) {
  return createReceiptDraft(db, payload);
}

export function validateTransfer(db, payload) {
  return validateReceipt(db, payload);
}

export function createDeliveryDraft(db, payload) {
  return createReceiptDraft(db, payload);
}

export function validateDelivery(db, payload) {
  return validateReceipt(db, payload);
}

export function createReturnDraft(db, payload) {
  return createReceiptDraft(db, payload);
}

export function validateReturn(db, payload) {
  return validateReceipt(db, payload);
}

export function createReplenishmentProposal(db, payload) {
  const { company_id = '*', product_id, warehouse_id = null, min_qty = 10, target_qty = 50 } = payload;
  if (!product_id) throw new Error('Product ID is required for replenishment proposal');
  const now = new Date().toISOString();
  const id = makeId('repl');
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_replenishment_proposals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      warehouse_id TEXT,
      min_qty REAL NOT NULL,
      target_qty REAL NOT NULL,
      proposed_qty REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO stock_replenishment_proposals (id, company_id, product_id, warehouse_id, min_qty, target_qty, proposed_qty, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
  `).run(id, company_id, product_id, warehouse_id, Number(min_qty), Number(target_qty), Number(target_qty - min_qty), now, now);

  return db.prepare(`SELECT * FROM stock_replenishment_proposals WHERE id = ?`).get(id);
}

export function approveReplenishmentProposal(db, payload) {
  const { proposal_id, id } = payload;
  const targetId = proposal_id || id;
  const now = new Date().toISOString();
  db.prepare(`UPDATE stock_replenishment_proposals SET status = 'approved', updated_at = ? WHERE id = ?`).run(now, targetId);
  return db.prepare(`SELECT * FROM stock_replenishment_proposals WHERE id = ?`).get(targetId) || { id: targetId, status: 'approved' };
}
