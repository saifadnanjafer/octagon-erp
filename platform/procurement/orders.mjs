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
    selected_quotation_id = null,
    expected_date = null,
    quality_required = false,
    attachments = [],
    comments = '',
    lines = [],
  } = poData;

  if (!supplier_id) throw new Error('Supplier ID is required for purchase order');
  const supplier = db.prepare(`
    SELECT p.id FROM parties p
    JOIN party_roles role ON role.party_id = p.id
    WHERE p.id = ? AND p.company_id = ? AND role.company_id = ? AND role.role = 'supplier'
  `).get(supplier_id, company_id, company_id);
  if (!supplier) throw new Error('Purchase partner must be a supplier in the active company');

  let effectiveQualityRequired = Boolean(quality_required);
  if (rfq_id) {
    const rfq = db.prepare(`
      SELECT rfq.id, COALESCE(MAX(line.quality_required), 0) AS quality_required
      FROM purchase_rfqs rfq
      LEFT JOIN purchase_rfq_lines line ON line.rfq_id = rfq.id
      WHERE rfq.id = ? AND rfq.company_id = ?
      GROUP BY rfq.id
    `).get(rfq_id, company_id);
    if (!rfq) throw new Error('Purchase-order RFQ was not found in the active company');
    effectiveQualityRequired = effectiveQualityRequired || Boolean(rfq.quality_required);
  }

  if (selected_quotation_id) {
    const selectedQuotation = db.prepare(`
      SELECT q.id, q.rfq_id, q.supplier_id, q.state, q.is_awarded
      FROM supplier_quotations q
      JOIN purchase_rfqs rfq ON rfq.id = q.rfq_id
      WHERE q.id = ? AND rfq.company_id = ?
    `).get(selected_quotation_id, company_id);
    if (!selectedQuotation) throw new Error('Selected supplier quotation was not found in the active company');
    if (selectedQuotation.supplier_id !== supplier_id) throw new Error('Selected supplier quotation does not belong to the purchase-order supplier');
    if (!selectedQuotation.is_awarded || selectedQuotation.state !== 'awarded') throw new Error('Selected supplier quotation must be awarded before purchase-order creation');
    if (rfq_id && selectedQuotation.rfq_id !== rfq_id) throw new Error('Selected supplier quotation does not belong to the purchase-order RFQ');
  }

  const orderId = makeId('po');
  const name = inputName || `PO-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO purchase_orders (
      id, company_id, name, supplier_id, rfq_id, currency_id, state,
      amount_untaxed, amount_tax, amount_total, order_date, created_at,
      selected_quotation_id, expected_date, quality_required, attachments, comments
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 0.0, 0.0, 0.0, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, company_id, name, supplier_id, rfq_id, currency_id, order_date, now, selected_quotation_id, expected_date, effectiveQualityRequired ? 1 : 0, JSON.stringify(attachments || []), comments);

  const insertLine = db.prepare(`
    INSERT INTO purchase_order_lines (
      id, order_id, product_id, name, product_qty, qty_received, qty_billed,
      product_uom, price_unit, price_subtotal, created_at, tax_amount, price_total
    ) VALUES (?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?, ?, ?, ?)
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
    const taxAmount = Number(l.tax_amount || 0);
    if (!(qty > 0) || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(taxAmount) || taxAmount < 0) {
      throw new Error('Purchase-order quantity, price, and tax are invalid');
    }
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
      now,
      taxAmount,
      subtotal + taxAmount,
    );
  }

  const totalTax = lines.reduce((sum, line) => sum + Number(line.tax_amount || 0), 0);
  db.prepare(`
    UPDATE purchase_orders SET amount_untaxed = ?, amount_tax = ?, amount_total = ? WHERE id = ?
  `).run(totalUntaxed, totalTax, totalUntaxed + totalTax, orderId);

  return getPurchaseOrder(db, orderId);
}

export function getPurchaseOrder(db, id) {
  const order = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id);
  if (!order) return null;
  const lines = db.prepare(`
    SELECT pol.*,
      COALESCE(f.received_quantity, pol.qty_received, 0) AS received_quantity,
      COALESCE(f.billed_quantity, pol.qty_billed, 0) AS billed_quantity
    FROM purchase_order_lines pol
    LEFT JOIN purchase_order_line_fulfilment f ON f.purchase_order_line_id = pol.id
    WHERE pol.order_id = ? ORDER BY pol.created_at, pol.id
  `).all(id);
  let attachments = [];
  try { attachments = JSON.parse(order.attachments || '[]'); } catch (_) {}
  let timeline = [];
  try {
    timeline = db.prepare(`
      SELECT action, result, failure_code, actor_id, occurred_at
      FROM platform_audit_log
      WHERE resource_id = ? OR after_value LIKE ?
      ORDER BY occurred_at, id LIMIT 100
    `).all(id, `%${id}%`);
  } catch (_) {}
  return {
    ...order,
    attachments,
    lines,
    timeline,
    payment_link: { page: 'finance', partner_id: order.supplier_id },
  };
}

export function approvePurchaseOrder(db, { order_id, company_id, actor }) {
  const order = getPurchaseOrder(db, order_id);
  if (!order || order.company_id !== company_id) throw new Error(`Purchase order not found: ${order_id}`);
  if (order.state !== 'draft') throw new Error('Only draft purchase orders can be approved');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE purchase_orders
    SET state = 'approved', approved_by = ?, approved_at = ?,
        commitment_amount = amount_total
    WHERE id = ?
  `).run(actor, now, order_id);
  db.prepare(`
    INSERT INTO purchase_commitments (
      id, company_id, purchase_order_id, amount, currency_id, state, created_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?)
  `).run(makeId('pcom'), company_id, order_id, Number(order.amount_total), order.currency_id, now);
  return getPurchaseOrder(db, order_id);
}

export function confirmPurchaseOrder(db, { order_id, warehouse_id, company_id, branch_id = null }) {
  const order = getPurchaseOrder(db, order_id);
  if (!order || order.company_id !== company_id) throw new Error(`Purchase order not found: ${order_id}`);
  if (order.state === 'purchase') throw new Error('Purchase order is already confirmed');
  if (!['draft', 'approved'].includes(order.state)) throw new Error('Purchase order state does not allow confirmation');

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
