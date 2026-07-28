import crypto from 'node:crypto';
import { postSourceFact } from '../finance/engine.mjs';
import { getPurchaseOrder } from './orders.mjs';

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function matchPolicy(db, companyId) {
  return db.prepare(`
    SELECT * FROM procurement_match_policies
    WHERE company_id IN (?, 'default')
    ORDER BY CASE WHEN company_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(companyId, companyId) || {
    quantity_tolerance: 0,
    price_tolerance: 0,
    freight_tolerance: 0,
    currency: 'IQD',
  };
}

function addException(db, matchId, lineId, code, expected, actual, now) {
  db.prepare(`
    INSERT INTO three_way_match_exceptions (
      id, match_id, purchase_order_line_id, exception_code,
      expected_value, actual_value, approval_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(makeId('twme'), matchId, lineId, code, String(expected), String(actual), now);
}

export function performThreeWayMatch(db, {
  purchase_order_id,
  receipt_picking_id = null,
  supplier_invoice_number,
  bill_lines = [],
  freight = 0,
  service_acceptance = {},
  company_id,
}) {
  const po = getPurchaseOrder(db, purchase_order_id);
  if (!po || po.company_id !== company_id) throw new Error(`Purchase order not found: ${purchase_order_id}`);
  if (po.state !== 'purchase') throw new Error('Three-way match requires a confirmed purchase order');
  if (!supplier_invoice_number) throw new Error('supplier_invoice_number is required');
  if (!Array.isArray(bill_lines) || !bill_lines.length) throw new Error('Line-level supplier invoice facts are required');

  const policy = matchPolicy(db, company_id);
  const id = makeId('twm');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO three_way_matches (
      id, company_id, purchase_order_id, receipt_picking_id,
      supplier_bill_id, match_status, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 'Line comparison in progress', ?)
  `).run(id, company_id, po.id, receipt_picking_id, supplier_invoice_number, now);
  db.prepare(`
    INSERT INTO supplier_invoice_registry (
      id, company_id, supplier_id, supplier_invoice_number, match_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(makeId('sinv'), company_id, po.supplier_id, supplier_invoice_number, id, now);

  const insertLine = db.prepare(`
    INSERT INTO three_way_match_lines (
      id, match_id, purchase_order_line_id, ordered_quantity,
      received_quantity, billed_quantity, ordered_unit_price,
      billed_unit_price, currency, freight, tolerance,
      service_accepted, line_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let exceptionCount = 0;
  for (const poLine of po.lines) {
    const received = db.prepare(`
      SELECT received_quantity FROM purchase_order_line_fulfilment
      WHERE purchase_order_line_id = ?
    `).get(poLine.id)?.received_quantity || 0;
    const billLine = bill_lines.find((line) => String(line.purchase_order_line_id) === String(poLine.id));
    if (!billLine) {
      addException(db, id, poLine.id, 'MISSING_BILL_LINE', poLine.product_qty, 0, now);
      exceptionCount += 1;
    }
    const billedQuantity = Number(billLine?.quantity || 0);
    const billedPrice = Number(billLine?.unit_price || 0);
    const currency = billLine?.currency || po.currency_id;
    const productType = db.prepare(`
      SELECT template.type FROM product_variants variant
      JOIN product_templates template ON template.id = variant.template_id
      WHERE variant.id = ?
    `).get(poLine.product_id)?.type || 'storable';
    const serviceAccepted = productType !== 'service' || service_acceptance[poLine.id] === true;
    const lineExceptionsBefore = exceptionCount;
    if (Math.abs(Number(poLine.product_qty) - Number(received)) > Number(policy.quantity_tolerance)) {
      addException(db, id, poLine.id, 'RECEIPT_QUANTITY_MISMATCH', poLine.product_qty, received, now);
      exceptionCount += 1;
    }
    if (Math.abs(Number(received) - billedQuantity) > Number(policy.quantity_tolerance)) {
      addException(db, id, poLine.id, 'BILLED_QUANTITY_MISMATCH', received, billedQuantity, now);
      exceptionCount += 1;
    }
    if (Math.abs(Number(poLine.price_unit) - billedPrice) > Number(policy.price_tolerance)) {
      addException(db, id, poLine.id, 'UNIT_PRICE_MISMATCH', poLine.price_unit, billedPrice, now);
      exceptionCount += 1;
    }
    if (currency !== po.currency_id || currency !== policy.currency) {
      addException(db, id, poLine.id, 'CURRENCY_MISMATCH', po.currency_id, currency, now);
      exceptionCount += 1;
    }
    if (!serviceAccepted) {
      addException(db, id, poLine.id, 'SERVICE_ACCEPTANCE_MISSING', true, false, now);
      exceptionCount += 1;
    }
    insertLine.run(
      makeId('twml'),
      id,
      poLine.id,
      poLine.product_qty,
      Number(received),
      billedQuantity,
      poLine.price_unit,
      billedPrice,
      currency,
      Number(billLine?.freight || 0),
      Number(policy.quantity_tolerance),
      serviceAccepted ? 1 : 0,
      exceptionCount === lineExceptionsBefore ? 'matched' : 'exception',
      now,
    );
  }
  const billedFreight = bill_lines.reduce((sum, line) => sum + Number(line.freight || 0), 0);
  if (Math.abs(Number(freight) - billedFreight) > Number(policy.freight_tolerance)) {
    addException(db, id, null, 'FREIGHT_MISMATCH', freight, billedFreight, now);
    exceptionCount += 1;
  }
  const status = exceptionCount ? 'exception' : 'matched';
  db.prepare(`
    UPDATE three_way_matches SET match_status = ?, notes = ? WHERE id = ?
  `).run(
    status,
    exceptionCount ? `${exceptionCount} line-level exception(s) require approval` : 'PO, executed receipt, and supplier invoice matched line by line',
    id,
  );
  return {
    ...db.prepare('SELECT * FROM three_way_matches WHERE id = ?').get(id),
    lines: db.prepare('SELECT * FROM three_way_match_lines WHERE match_id = ? ORDER BY id').all(id),
    exceptions: db.prepare('SELECT * FROM three_way_match_exceptions WHERE match_id = ? ORDER BY id').all(id),
  };
}

export function createSupplierBillRequest(db, {
  purchase_order_id,
  company_id,
  branch_id = null,
  actor,
  idempotency_key,
}) {
  const po = getPurchaseOrder(db, purchase_order_id);
  if (!po || po.company_id !== company_id) throw new Error(`Purchase order not found: ${purchase_order_id}`);
  if (po.state !== 'purchase') throw new Error('Only confirmed purchase orders can generate supplier bill requests');
  const matched = db.prepare(`
    SELECT * FROM three_way_matches
    WHERE company_id = ? AND purchase_order_id = ? AND match_status = 'matched'
    ORDER BY created_at DESC LIMIT 1
  `).get(company_id, po.id);
  if (!matched) throw new Error('Supplier bill requires a clean line-level three-way match');

  const existing = db.prepare(`
    SELECT * FROM commercial_fiscal_requests
    WHERE company_id = ? AND request_type = 'supplier_bill' AND source_document_id = ?
  `).get(company_id, po.id);
  if (existing) {
    return {
      bill_request_id: existing.id,
      finance_document_id: existing.finance_document_id,
      status: existing.status,
      replay: true,
    };
  }

  const matchLines = db.prepare(`
    SELECT match_line.*, po_line.product_id, po_line.name
    FROM three_way_match_lines match_line
    JOIN purchase_order_lines po_line ON po_line.id = match_line.purchase_order_line_id
    WHERE match_line.match_id = ? AND match_line.line_status = 'matched'
    ORDER BY match_line.id
  `).all(matched.id);
  const debitLines = matchLines.map((line) => {
    const mapping = db.prepare(`
      SELECT template.type, category.stock_input_account_id, category.expense_account_id
      FROM product_variants variant
      JOIN product_templates template ON template.id = variant.template_id
      JOIN product_categories category ON category.id = template.category_id
      WHERE variant.id = ? AND variant.company_id = ?
    `).get(line.product_id, company_id);
    const accountId = mapping?.type === 'service' ? mapping.expense_account_id : mapping?.stock_input_account_id;
    if (!accountId) throw new Error(`Procurement account mapping is required for product ${line.product_id}`);
    const debit = Number(line.billed_quantity) * Number(line.billed_unit_price) + Number(line.freight || 0);
    return {
      account_id: accountId,
      debit,
      credit: 0,
      source_line_id: line.purchase_order_line_id,
      product_id: line.product_id,
      quantity: line.billed_quantity,
      description: `${po.name}:${line.name}`,
    };
  });
  const total = debitLines.reduce((sum, line) => sum + line.debit, 0);
  const payable = db.prepare(`
    SELECT id FROM finance_accounts
    WHERE company_id = ? AND code = '201000' AND is_active = 1
  `).get(company_id);
  if (!payable) throw new Error('Canonical payable account is missing');
  const financeLines = [
    ...debitLines,
    { account_id: payable.id, debit: 0, credit: total, partner_id: po.supplier_id, description: po.name },
  ];
  const billRequestId = makeId('bill_req');
  const now = new Date().toISOString();
  const requestPayload = {
    bill_request_id: billRequestId,
    company_id,
    supplier_id: po.supplier_id,
    purchase_order_id: po.id,
    document_type: 'supplier_bill',
    amount_untaxed: total,
    amount_tax: 0,
    amount_total: total,
    currency_id: po.currency_id,
    status: 'pending',
    lines: debitLines,
  };
  db.prepare(`
    INSERT INTO commercial_fiscal_requests (
      id, company_id, request_type, source_document_type, source_document_id,
      idempotency_key, finance_document_id, status, request_payload,
      created_at, updated_at
    ) VALUES (?, ?, 'supplier_bill', 'purchase_order', ?, ?, NULL, 'pending', ?, ?, ?)
  `).run(billRequestId, company_id, po.id, idempotency_key, JSON.stringify(requestPayload), now, now);
  const posted = postSourceFact(db, {
    companyId: company_id,
    branchId: branch_id,
    userId: actor,
    now,
  }, {
    fact_type: 'purchase_bill_posting',
    move_type: 'supplier_bill',
    source_document_type: 'purchase_order',
    source_id: po.id,
    doc_date: now.slice(0, 10),
    partner_id: po.supplier_id,
    currency: po.currency_id,
    lines: financeLines,
  });
  db.prepare(`
    UPDATE commercial_fiscal_requests
    SET finance_document_id = ?, status = 'posted', updated_at = ?
    WHERE id = ?
  `).run(posted.document_id, new Date().toISOString(), billRequestId);
  db.prepare(`
    UPDATE purchase_commitments SET state = 'closed'
    WHERE company_id = ? AND purchase_order_id = ?
  `).run(company_id, po.id);
  db.prepare('UPDATE purchase_orders SET closed_at = ? WHERE id = ?').run(new Date().toISOString(), po.id);
  return { ...requestPayload, finance_document_id: posted.document_id, status: 'posted' };
}
