import crypto from 'node:crypto';
import { calculateUnitPrice } from '../commercial/pricing.mjs';
import { createPicking } from '../wms/operations.mjs';

function makeId(prefix = 'so') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createQuotation(db, quotationData) {
  const {
    company_id = '*',
    name: inputName,
    partner_id,
    pricelist_id = null,
    currency_id = 'IQD',
    order_date = new Date().toISOString().split('T')[0],
    lines = [],
  } = quotationData;

  if (!partner_id) throw new Error('Partner ID is required for quotation');

  const orderId = makeId('so');
  const name = inputName || `SO-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sale_orders (
      id, company_id, name, partner_id, pricelist_id, currency_id, state, amount_untaxed, amount_tax, amount_total, order_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 0.0, 0.0, 0.0, ?, ?)
  `).run(orderId, company_id, name, partner_id, pricelist_id, currency_id, order_date, now);

  const insertLine = db.prepare(`
    INSERT INTO sale_order_lines (
      id, order_id, product_id, name, product_uom_qty, qty_delivered, qty_invoiced,
      product_uom, price_unit, discount, price_subtotal, price_total, tax_id, created_at
    ) VALUES (?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const line of lines) {
    const variant = db.prepare(`
      SELECT v.*, t.uom_id FROM product_variants v
      JOIN product_templates t ON v.template_id = t.id WHERE v.id = ?
    `).get(line.product_id);

    if (!variant) throw new Error(`Product variant not found: ${line.product_id}`);

    const pricingQuote = calculateUnitPrice(db, { price_list_id: pricelist_id, variant_id: line.product_id, qty: line.product_uom_qty || 1.0 });
    const priceUnit = line.price_unit !== undefined ? Number(line.price_unit) : pricingQuote.unitPrice;
    const discount = line.discount !== undefined ? Number(line.discount) : pricingQuote.discount;
    const qty = Number(line.product_uom_qty || 1.0);
    const subtotal = qty * priceUnit * (1 - discount / 100);
    const total = subtotal; // Tax can be applied via line tax_id if provided

    insertLine.run(
      makeId('sol'),
      orderId,
      line.product_id,
      line.name || variant.name,
      qty,
      line.product_uom || variant.uom_id,
      priceUnit,
      discount,
      subtotal,
      total,
      line.tax_id || '',
      now
    );
  }

  recalculateOrderTotals(db, orderId);
  return getSaleOrder(db, orderId);
}

export function getSaleOrder(db, id) {
  const order = db.prepare(`SELECT * FROM sale_orders WHERE id = ?`).get(id);
  if (!order) return null;
  const lines = db.prepare(`SELECT * FROM sale_order_lines WHERE order_id = ?`).all(id);
  return { ...order, lines };
}

function recalculateOrderTotals(db, orderId) {
  const res = db.prepare(`
    SELECT SUM(price_subtotal) as untaxed, SUM(price_total) as total FROM sale_order_lines WHERE order_id = ?
  `).get(orderId);

  const untaxed = res && res.untaxed ? res.untaxed : 0.0;
  const total = res && res.total ? res.total : 0.0;
  const tax = total - untaxed;

  db.prepare(`
    UPDATE sale_orders SET amount_untaxed = ?, amount_tax = ?, amount_total = ? WHERE id = ?
  `).run(untaxed, tax, total, orderId);
}

export function confirmSalesOrder(db, { order_id, warehouse_id }) {
  const order = getSaleOrder(db, order_id);
  if (!order) throw new Error(`Sale order not found: ${order_id}`);
  if (order.state === 'sale') throw new Error('Sale order is already confirmed');

  // Resolve warehouse default output location
  const wh = db.prepare(`SELECT * FROM warehouses WHERE id = ?`).get(warehouse_id);
  if (!wh) throw new Error(`Warehouse not found: ${warehouse_id}`);

  // Create delivery picking
  const pickingTypeId = `pt_out_${wh.id}`;
  let pickingType = db.prepare(`SELECT id FROM stock_picking_types WHERE warehouse_id = ? AND code = 'outgoing'`).get(wh.id);
  if (!pickingType) {
    db.prepare(`
      INSERT INTO stock_picking_types (id, company_id, warehouse_id, name, code, created_at)
      VALUES (?, ?, ?, 'Delivery Orders', 'outgoing', ?)
    `).run(pickingTypeId, order.company_id, wh.id, new Date().toISOString());
    pickingType = { id: pickingTypeId };
  }

  // Resolve customer location
  let custLoc = db.prepare(`SELECT id FROM stock_locations WHERE usage = 'customer' AND (company_id = ? OR company_id = '*')`).get(order.company_id);
  if (!custLoc) {
    const newLocId = `loc_cust_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO stock_locations (id, company_id, name, complete_name, usage, created_at)
      VALUES (?, ?, 'Customers', 'Customers', 'customer', ?)
    `).run(newLocId, order.company_id, new Date().toISOString());
    custLoc = { id: newLocId };
  }

  const picking = createPicking(db, {
    company_id: order.company_id,
    picking_type_id: pickingType.id,
    reference: `OUT/${order.name}`,
    origin: order.name,
    location_id: wh.lot_stock_id,
    location_dest_id: custLoc.id,
    partner_id: order.partner_id,
  });

  db.prepare(`UPDATE sale_orders SET state = 'sale' WHERE id = ?`).run(order_id);
  return { order: getSaleOrder(db, order_id), delivery_picking_id: picking.id };
}

export function createFiscalInvoiceRequest(db, { order_id }) {
  const order = getSaleOrder(db, order_id);
  if (!order) throw new Error(`Sale order not found: ${order_id}`);
  if (order.state !== 'sale') throw new Error('Only confirmed sales orders can generate fiscal invoice requests');

  const invoiceRequestId = `inv_req_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();

  // Create Phase 03 Fiscal Document payload ready for canonical finance engine posting
  return {
    invoice_request_id: invoiceRequestId,
    company_id: order.company_id,
    partner_id: order.partner_id,
    sale_order_id: order.id,
    document_type: 'customer_invoice',
    amount_untaxed: order.amount_untaxed,
    amount_tax: order.amount_tax,
    amount_total: order.amount_total,
    currency_id: order.currency_id,
    status: 'pending_canonical_finance_posting',
    created_at: now,
    lines: order.lines.map(l => ({
      product_id: l.product_id,
      name: l.name,
      quantity: l.product_uom_qty,
      unit_price: l.price_unit,
      discount: l.discount,
      subtotal: l.price_subtotal,
    })),
  };
}
