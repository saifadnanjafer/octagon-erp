import crypto from 'node:crypto';
import { calculateUnitPrice } from '../commercial/pricing.mjs';
import { createPicking } from '../wms/operations.mjs';
import { reserveStock } from '../inventory/reservations.mjs';
import { postSourceFact } from '../finance/engine.mjs';

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
  const customer = db.prepare(`
    SELECT p.id FROM parties p
    JOIN party_roles role ON role.party_id = p.id
    WHERE p.id = ? AND p.company_id = ? AND role.company_id = ? AND role.role = 'customer'
  `).get(partner_id, company_id, company_id);
  if (!customer) throw new Error('Sales partner must be a customer in the active company');

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

export function confirmSalesOrder(db, {
  order_id,
  warehouse_id,
  company_id,
  branch_id = null,
  actor,
  idempotency_key,
}) {
  const order = getSaleOrder(db, order_id);
  if (!order || order.company_id !== company_id) throw new Error(`Sale order not found: ${order_id}`);
  if (order.state === 'sale') throw new Error('Sale order is already confirmed');

  // Resolve warehouse default output location
  const wh = db.prepare('SELECT * FROM warehouses WHERE id = ? AND company_id = ?').get(warehouse_id, company_id);
  if (!wh) throw new Error(`Warehouse not found: ${warehouse_id}`);
  if (branch_id && !db.prepare(`
    SELECT 1 FROM warehouse_branch_scopes
    WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
  `).get(warehouse_id, company_id, branch_id)) {
    throw new Error('Sales warehouse is outside the active branch scope');
  }

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

  const now = new Date().toISOString();
  for (const line of order.lines) {
    const reservation = reserveStock(db, {
      company_id,
      branch_id,
      warehouse_id,
      location_id: wh.lot_stock_id,
      product_id: line.product_id,
      source_document_type: 'sale_order',
      source_document_id: order.id,
      source_line_id: line.id,
      quantity: line.product_uom_qty,
      priority: 10,
      idempotency_key: `${idempotency_key}:reservation:${line.id}`,
      actor,
    });
    db.prepare(`
      INSERT INTO sale_fulfilment_demands (
        id, company_id, sale_order_id, sale_order_line_id, warehouse_id,
        product_id, demanded_quantity, reservation_id, picking_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
    `).run(
      `sfd_${crypto.randomUUID()}`,
      company_id,
      order.id,
      line.id,
      warehouse_id,
      line.product_id,
      line.product_uom_qty,
      reservation.id,
      picking.id,
      now,
    );
  }
  db.prepare(`UPDATE sale_orders SET state = 'sale' WHERE id = ?`).run(order_id);
  return { order: getSaleOrder(db, order_id), delivery_picking_id: picking.id };
}

export function createFiscalInvoiceRequest(db, {
  order_id,
  company_id,
  branch_id = null,
  actor,
  idempotency_key,
}) {
  const order = getSaleOrder(db, order_id);
  if (!order || order.company_id !== company_id) throw new Error(`Sale order not found: ${order_id}`);
  if (order.state !== 'sale') throw new Error('Only confirmed sales orders can generate fiscal invoice requests');

  const existing = db.prepare(`
    SELECT * FROM commercial_fiscal_requests
    WHERE company_id = ? AND request_type = 'customer_invoice' AND source_document_id = ?
  `).get(company_id, order.id);
  if (existing) {
    return {
      invoice_request_id: existing.id,
      finance_document_id: existing.finance_document_id,
      status: existing.status,
      replay: true,
    };
  }

  const fulfilment = db.prepare(`
    SELECT sol.*, f.delivered_quantity, f.invoiced_quantity
    FROM sale_order_lines sol
    JOIN sale_order_line_fulfilment f ON f.sale_order_line_id = sol.id
    WHERE sol.order_id = ?
    ORDER BY sol.id
  `).all(order.id);
  if (!fulfilment.length || fulfilment.some((line) => Number(line.delivered_quantity) <= Number(line.invoiced_quantity))) {
    throw new Error('Invoice request requires delivered, uninvoiced quantities');
  }
  const invoiceLines = fulfilment.map((line) => {
    const income = db.prepare(`
      SELECT category.income_account_id
      FROM product_variants variant
      JOIN product_templates template ON template.id = variant.template_id
      JOIN product_categories category ON category.id = template.category_id
      WHERE variant.id = ? AND variant.company_id = ?
    `).get(line.product_id, company_id);
    if (!income?.income_account_id) throw new Error(`Income account mapping is required for product ${line.product_id}`);
    const quantity = Number(line.delivered_quantity) - Number(line.invoiced_quantity);
    const credit = quantity * Number(line.price_unit) * (1 - Number(line.discount || 0) / 100);
    return {
      account_id: income.income_account_id,
      debit: 0,
      credit,
      source_line_id: line.id,
      product_id: line.product_id,
      quantity,
      description: `${order.name}:${line.name}`,
    };
  });
  const amount = invoiceLines.reduce((sum, line) => sum + line.credit, 0);
  const receivable = db.prepare(`
    SELECT id FROM finance_accounts
    WHERE company_id = ? AND code = '103000' AND is_active = 1
  `).get(company_id);
  if (!receivable) throw new Error('Canonical receivable account is missing');
  const financeLines = [
    { account_id: receivable.id, debit: amount, credit: 0, partner_id: order.partner_id, description: order.name },
    ...invoiceLines,
  ];

  const invoiceRequestId = `inv_req_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const requestPayload = {
    invoice_request_id: invoiceRequestId,
    company_id,
    partner_id: order.partner_id,
    sale_order_id: order.id,
    document_type: 'customer_invoice',
    amount_untaxed: amount,
    amount_tax: 0,
    amount_total: amount,
    currency_id: order.currency_id,
    status: 'pending',
    created_at: now,
    lines: invoiceLines,
  };
  db.prepare(`
    INSERT INTO commercial_fiscal_requests (
      id, company_id, request_type, source_document_type, source_document_id,
      idempotency_key, finance_document_id, status, request_payload,
      created_at, updated_at
    ) VALUES (?, ?, 'customer_invoice', 'sale_order', ?, ?, NULL, 'pending', ?, ?, ?)
  `).run(invoiceRequestId, company_id, order.id, idempotency_key, JSON.stringify(requestPayload), now, now);

  const posted = postSourceFact(db, {
    companyId: company_id,
    branchId: branch_id,
    userId: actor,
    now,
  }, {
    fact_type: 'sales_invoice_posting',
    move_type: 'customer_invoice',
    source_document_type: 'sale_order',
    source_id: order.id,
    doc_date: now.slice(0, 10),
    partner_id: order.partner_id,
    currency: order.currency_id,
    lines: financeLines,
  });
  db.prepare(`
    UPDATE commercial_fiscal_requests
    SET finance_document_id = ?, status = 'posted', updated_at = ?
    WHERE id = ?
  `).run(posted.document_id, new Date().toISOString(), invoiceRequestId);
  return {
    ...requestPayload,
    finance_document_id: posted.document_id,
    status: 'posted',
  };
}
