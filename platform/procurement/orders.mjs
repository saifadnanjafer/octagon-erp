import crypto from 'node:crypto';
import { createPicking } from '../wms/operations.mjs';

function makeId(prefix = 'po') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createPurchaseOrder(db, poData) {
  const {
    company_id = '*',
    name: inputName,
    supplier_id,
    rfq_id = null,
    currency_id = 'IQD',
    order_date = new Date().toISOString().split('T')[0],
    lines = [],
  } = poData;

  if (!supplier_id) throw new Error('Supplier ID is required for purchase order');
  const supplier = db.prepare(`
    SELECT p.id FROM parties p
    JOIN party_roles role ON role.party_id = p.id
    WHERE p.id = ? AND p.company_id = ? AND role.company_id = ? AND role.role = 'supplier'
  `).get(supplier_id, company_id, company_id);
  if (!supplier) throw new Error('Purchase partner must be a supplier in the active company');

  const orderId = makeId('po');
  const name = inputName || `PO-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO purchase_orders (
      id, company_id, name, supplier_id, rfq_id, currency_id, state, amount_untaxed, amount_tax, amount_total, order_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 0.0, 0.0, 0.0, ?, ?)
  `).run(orderId, company_id, name, supplier_id, rfq_id, currency_id, order_date, now);

  const insertLine = db.prepare(`
    INSERT INTO purchase_order_lines (
      id, order_id, product_id, name, product_qty, qty_received, qty_billed, product_uom, price_unit, price_subtotal, created_at
    ) VALUES (?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?, ?)
  `);

  let totalUntaxed = 0;

  for (const l of lines) {
    const variant = db.prepare(`
      SELECT v.*, t.uom_id FROM product_variants v
      JOIN product_templates t ON v.template_id = t.id WHERE v.id = ?
    `).get(l.product_id);

    if (!variant) throw new Error(`Product variant not found: ${l.product_id}`);

    const qty = Number(l.product_qty || 1.0);
    const unitPrice = Number(l.price_unit || variant.standard_price || 0.0);
    const subtotal = qty * unitPrice;
    totalUntaxed += subtotal;

    insertLine.run(
      makeId('pol'),
      orderId,
      l.product_id,
      l.name || variant.name,
      qty,
      l.product_uom || variant.uom_id,
      unitPrice,
      subtotal,
      now
    );
  }

  db.prepare(`
    UPDATE purchase_orders SET amount_untaxed = ?, amount_total = ? WHERE id = ?
  `).run(totalUntaxed, totalUntaxed, orderId);

  return getPurchaseOrder(db, orderId);
}

export function getPurchaseOrder(db, id) {
  const order = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id);
  if (!order) return null;
  const lines = db.prepare(`SELECT * FROM purchase_order_lines WHERE order_id = ?`).all(id);
  return { ...order, lines };
}

export function confirmPurchaseOrder(db, { order_id, warehouse_id, company_id, branch_id = null }) {
  const order = getPurchaseOrder(db, order_id);
  if (!order || order.company_id !== company_id) throw new Error(`Purchase order not found: ${order_id}`);
  if (order.state === 'purchase') throw new Error('Purchase order is already confirmed');

  const wh = db.prepare('SELECT * FROM warehouses WHERE id = ? AND company_id = ?').get(warehouse_id, company_id);
  if (!wh) throw new Error(`Warehouse not found: ${warehouse_id}`);
  if (branch_id && !db.prepare(`
    SELECT 1 FROM warehouse_branch_scopes
    WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
  `).get(warehouse_id, company_id, branch_id)) {
    throw new Error('Procurement warehouse is outside the active branch scope');
  }

  // Resolve picking type
  const pickingTypeId = `pt_in_${wh.id}`;
  let pickingType = db.prepare(`SELECT id FROM stock_picking_types WHERE warehouse_id = ? AND code = 'incoming'`).get(wh.id);
  if (!pickingType) {
    db.prepare(`
      INSERT INTO stock_picking_types (id, company_id, warehouse_id, name, code, created_at)
      VALUES (?, ?, ?, 'Incoming Receipts', 'incoming', ?)
    `).run(pickingTypeId, order.company_id, wh.id, new Date().toISOString());
    pickingType = { id: pickingTypeId };
  }

  // Resolve supplier location
  let suppLoc = db.prepare(`SELECT id FROM stock_locations WHERE usage = 'supplier' AND (company_id = ? OR company_id = '*')`).get(order.company_id);
  if (!suppLoc) {
    const newLocId = `loc_supp_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO stock_locations (id, company_id, name, complete_name, usage, created_at)
      VALUES (?, ?, 'Suppliers', 'Suppliers', 'supplier', ?)
    `).run(newLocId, order.company_id, new Date().toISOString());
    suppLoc = { id: newLocId };
  }

  const picking = createPicking(db, {
    company_id: order.company_id,
    picking_type_id: pickingType.id,
    reference: `IN/${order.name}`,
    origin: order.name,
    location_id: suppLoc.id,
    location_dest_id: wh.lot_stock_id,
    partner_id: order.supplier_id,
  });

  const now = new Date().toISOString();
  for (const line of order.lines) {
    db.prepare(`
      INSERT INTO purchase_fulfilment_demands (
        id, company_id, purchase_order_id, purchase_order_line_id,
        warehouse_id, product_id, demanded_quantity, picking_id,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_receipt', ?)
    `).run(
      `pfd_${crypto.randomUUID()}`,
      company_id,
      order.id,
      line.id,
      warehouse_id,
      line.product_id,
      line.product_qty,
      picking.id,
      now,
    );
  }
  db.prepare(`UPDATE purchase_orders SET state = 'purchase' WHERE id = ?`).run(order_id);
  return { order: getPurchaseOrder(db, order_id), receipt_picking_id: picking.id };
}
