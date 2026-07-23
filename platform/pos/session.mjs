import crypto from 'node:crypto';
import { postStockMove } from '../inventory/ledger.mjs';

function makeId(prefix = 'pos') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function openPosSession(db, { company_id = '*', name = 'Main POS Terminal', user_id }) {
  if (!user_id) throw new Error('User ID is required to open a POS session');
  const id = makeId('sess');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO pos_sessions (id, company_id, name, user_id, state, start_at, created_at)
    VALUES (?, ?, ?, ?, 'opened', ?, ?)
  `).run(id, company_id, name, user_id, now, now);

  return db.prepare(`SELECT * FROM pos_sessions WHERE id = ?`).get(id);
}

export function processPosOrder(db, { session_id, partner_id = null, warehouse_id, lines = [], payments = [] }) {
  const session = db.prepare(`SELECT * FROM pos_sessions WHERE id = ?`).get(session_id);
  if (!session) throw new Error(`POS session not found: ${session_id}`);
  if (session.state !== 'opened') throw new Error('POS session is closed');

  const orderId = makeId('poso');
  const orderName = `POS/${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();

  let amountTotal = 0;

  // Insert draft POS order
  db.prepare(`
    INSERT INTO pos_orders (id, company_id, session_id, name, partner_id, amount_total, state, created_at)
    VALUES (?, ?, ?, ?, ?, 0.0, 'draft', ?)
  `).run(orderId, session.company_id, session_id, orderName, partner_id, now);

  const insertLine = db.prepare(`
    INSERT INTO pos_order_lines (id, pos_order_id, product_id, qty, price_unit, discount, price_subtotal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Resolve warehouse stock location
  const wh = db.prepare(`SELECT lot_stock_id, output_location_id FROM warehouses WHERE id = ?`).get(warehouse_id);
  const srcLocId = wh ? wh.lot_stock_id : 'loc_stock_default';

  // Resolve customer location
  let custLoc = db.prepare(`SELECT id FROM stock_locations WHERE usage = 'customer' AND (company_id = ? OR company_id = '*')`).get(session.company_id);
  if (!custLoc) {
    const newLocId = `loc_cust_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO stock_locations (id, company_id, name, complete_name, usage, created_at)
      VALUES (?, ?, 'Customers', 'Customers', 'customer', ?)
    `).run(newLocId, session.company_id, now);
    custLoc = { id: newLocId };
  }

  for (const l of lines) {
    const variant = db.prepare(`
      SELECT v.*, t.uom_id FROM product_variants v
      JOIN product_templates t ON v.template_id = t.id WHERE v.id = ?
    `).get(l.product_id);

    if (!variant) throw new Error(`Product variant not found: ${l.product_id}`);

    const qty = Number(l.qty || 1.0);
    const unitPrice = Number(l.price_unit || variant.list_price || 0.0);
    const discount = Number(l.discount || 0.0);
    const subtotal = qty * unitPrice * (1 - discount / 100);
    amountTotal += subtotal;

    insertLine.run(makeId('posol'), orderId, l.product_id, qty, unitPrice, discount, subtotal, now);

    // Deduct inventory via atomic stock move (Stock -> Customer)
    postStockMove(db, {
      company_id: session.company_id,
      reference: orderName,
      product_id: l.product_id,
      uom_id: variant.uom_id,
      product_qty: qty,
      location_id: srcLocId,
      location_dest_id: custLoc.id,
      unit_cost: variant.standard_price || 0.0,
    });
  }

  const insertPayment = db.prepare(`
    INSERT INTO pos_payments (id, pos_order_id, payment_method_id, amount, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const p of payments) {
    insertPayment.run(makeId('posp'), orderId, p.payment_method_id || 'cash', Number(p.amount || 0), now);
  }

  db.prepare(`UPDATE pos_orders SET amount_total = ?, state = 'paid' WHERE id = ?`).run(amountTotal, orderId);

  return getPosOrder(db, orderId);
}

export function getPosOrder(db, id) {
  const order = db.prepare(`SELECT * FROM pos_orders WHERE id = ?`).get(id);
  if (!order) return null;
  const lines = db.prepare(`SELECT * FROM pos_order_lines WHERE pos_order_id = ?`).all(id);
  const payments = db.prepare(`SELECT * FROM pos_payments WHERE pos_order_id = ?`).all(id);
  return { ...order, lines, payments };
}
