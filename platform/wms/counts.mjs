import crypto from 'node:crypto';
import { getQuantBalance, postStockMove } from '../inventory/ledger.mjs';
import { createStockLocation } from '../inventory/warehouses.mjs';

function makeId(prefix = 'cnt') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createCycleCount(db, { company_id = '*', name, location_id }) {
  if (!name || !location_id) throw new Error('Cycle count name and location_id are required');
  const id = makeId('count');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO stock_inventory_counts (id, company_id, name, location_id, state, count_date, created_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?)
  `).run(id, company_id, name, location_id, now, now);

  return db.prepare(`SELECT * FROM stock_inventory_counts WHERE id = ?`).get(id);
}

export function recordCountLine(db, { count_id, product_id, real_qty }) {
  const count = db.prepare(`SELECT * FROM stock_inventory_counts WHERE id = ?`).get(count_id);
  if (!count) throw new Error(`Cycle count not found: ${count_id}`);

  const bal = getQuantBalance(db, { company_id: count.company_id, product_id, location_id: count.location_id });
  const theoreticalQty = bal.onHand;
  const diff = Number(real_qty) - theoreticalQty;
  const lineId = makeId('cline');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO stock_inventory_count_lines (id, count_id, product_id, theoretical_qty, real_qty, difference_qty, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(lineId, count_id, product_id, theoreticalQty, Number(real_qty), diff, now);

  return db.prepare(`SELECT * FROM stock_inventory_count_lines WHERE id = ?`).get(lineId);
}

export function postCycleCount(db, { count_id, uom_id = null }) {
  const count = db.prepare(`SELECT * FROM stock_inventory_counts WHERE id = ?`).get(count_id);
  if (!count) throw new Error(`Cycle count not found: ${count_id}`);
  if (count.state === 'posted') throw new Error('Cycle count is already posted');

  const lines = db.prepare(`SELECT * FROM stock_inventory_count_lines WHERE count_id = ?`).all(count_id);

  // Find or create virtual inventory adjustment location
  let invLoc = db.prepare(`SELECT id FROM stock_locations WHERE usage = 'inventory' AND (company_id = ? OR company_id = '*')`).get(count.company_id);
  if (!invLoc) {
    const newLoc = createStockLocation(db, { company_id: count.company_id, name: 'Inventory Loss / Gain', usage: 'inventory' });
    invLoc = { id: newLoc.id };
  }

  for (const line of lines) {
    if (line.difference_qty === 0) continue;

    // Resolve UOM if not provided
    const prod = db.prepare(`
      SELECT v.*, t.uom_id FROM product_variants v
      JOIN product_templates t ON v.template_id = t.id WHERE v.id = ?
    `).get(line.product_id);

    const effectiveUomId = uom_id || (prod ? prod.uom_id : 'uom_default');

    if (line.difference_qty > 0) {
      // Gain: virtual inventory -> stock location
      postStockMove(db, {
        company_id: count.company_id,
        reference: `INV-ADJ/${count.name}`,
        product_id: line.product_id,
        uom_id: effectiveUomId,
        product_qty: line.difference_qty,
        location_id: invLoc.id,
        location_dest_id: count.location_id,
        unit_cost: prod ? prod.standard_price : 0.0,
      });
    } else if (line.difference_qty < 0) {
      // Loss: stock location -> virtual inventory
      postStockMove(db, {
        company_id: count.company_id,
        reference: `INV-ADJ/${count.name}`,
        product_id: line.product_id,
        uom_id: effectiveUomId,
        product_qty: Math.abs(line.difference_qty),
        location_id: count.location_id,
        location_dest_id: invLoc.id,
        unit_cost: prod ? prod.standard_price : 0.0,
      });
    }
  }

  db.prepare(`UPDATE stock_inventory_counts SET state = 'posted' WHERE id = ?`).run(count_id);
  return db.prepare(`SELECT * FROM stock_inventory_counts WHERE id = ?`).get(count_id);
}
