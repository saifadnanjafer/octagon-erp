import crypto from 'node:crypto';
import { getPurchaseOrder } from './orders.mjs';

function makeId(prefix = 'twm') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function performThreeWayMatch(db, { purchase_order_id, receipt_picking_id = null, supplier_bill_id = null, bill_amount = null }) {
  const po = getPurchaseOrder(db, purchase_order_id);
  if (!po) throw new Error(`Purchase order not found: ${purchase_order_id}`);

  let matchStatus = 'matched';
  let notes = 'PO, Receipt, and Supplier Bill matched cleanly.';

  if (bill_amount !== null && Number(bill_amount) !== po.amount_total) {
    matchStatus = 'discrepancy_price';
    notes = `Price mismatch: PO total is ${po.amount_total}, but supplier bill is ${bill_amount}.`;
  }

  const id = makeId('twm');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO three_way_matches (id, company_id, purchase_order_id, receipt_picking_id, supplier_bill_id, match_status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, po.company_id, purchase_order_id, receipt_picking_id, supplier_bill_id, matchStatus, notes, now);

  return db.prepare(`SELECT * FROM three_way_matches WHERE id = ?`).get(id);
}

export function createSupplierBillRequest(db, { purchase_order_id }) {
  const po = getPurchaseOrder(db, purchase_order_id);
  if (!po) throw new Error(`Purchase order not found: ${purchase_order_id}`);
  if (po.state !== 'purchase') throw new Error('Only confirmed purchase orders can generate supplier bill requests');

  const billRequestId = `bill_req_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();

  return {
    bill_request_id: billRequestId,
    company_id: po.company_id,
    supplier_id: po.supplier_id,
    purchase_order_id: po.id,
    document_type: 'vendor_bill',
    amount_untaxed: po.amount_untaxed,
    amount_tax: po.amount_tax,
    amount_total: po.amount_total,
    currency_id: po.currency_id,
    status: 'pending_canonical_finance_ap_posting',
    created_at: now,
    lines: po.lines.map(l => ({
      product_id: l.product_id,
      name: l.name,
      quantity: l.product_qty,
      unit_price: l.price_unit,
      subtotal: l.price_subtotal,
    })),
  };
}
