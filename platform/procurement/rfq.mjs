import crypto from 'node:crypto';

function makeId(prefix = 'rfq') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createRfq(db, {
  company_id = '*',
  name,
  requisition_id = null,
  deadline = null,
  supplier_ids = [],
  lines = [],
  comments = '',
  attachments = [],
}) {
  if (!name) throw new Error('RFQ name is required');
  let requisition = null;
  if (requisition_id) {
    requisition = db.prepare('SELECT * FROM purchase_requisitions WHERE id = ? AND company_id = ?').get(requisition_id, company_id);
    if (!requisition) throw new Error(`Purchase requisition not found: ${requisition_id}`);
    if (requisition.state !== 'approved') throw new Error('RFQ requires an approved requisition');
  }
  const id = makeId('rfq');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO purchase_rfqs (
      id, company_id, name, requisition_id, state, deadline, created_at,
      comments, attachments, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    company_id,
    name,
    requisition_id,
    supplier_ids.length ? 'issued' : 'draft',
    deadline,
    now,
    comments,
    JSON.stringify(attachments || []),
    supplier_ids.length ? now : null,
  );

  const sourceLines = lines.length ? lines : requisition_id
    ? db.prepare('SELECT * FROM purchase_requisition_lines WHERE requisition_id = ?').all(requisition_id)
    : [];
  const insertLine = db.prepare(`
    INSERT INTO purchase_rfq_lines (
      id, rfq_id, requisition_line_id, product_id, quantity, uom_id,
      target_date, quality_required, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of sourceLines) {
    insertLine.run(
      makeId('rfql'),
      id,
      line.requisition_line_id || line.id || null,
      line.product_id,
      Number(line.quantity || line.qty || 1),
      line.uom_id,
      line.target_date || deadline,
      line.quality_required ? 1 : 0,
      now,
    );
  }
  const insertSupplier = db.prepare(`
    INSERT INTO purchase_rfq_suppliers (id, rfq_id, supplier_id, status, invited_at)
    VALUES (?, ?, ?, 'invited', ?)
  `);
  for (const supplierId of [...new Set(supplier_ids)]) {
    const supplier = db.prepare(`
      SELECT p.id FROM parties p JOIN party_roles r ON r.party_id = p.id
      WHERE p.id = ? AND p.company_id = ? AND r.company_id = ? AND r.role = 'supplier'
    `).get(supplierId, company_id, company_id);
    if (!supplier) throw new Error(`RFQ supplier is outside the active company: ${supplierId}`);
    insertSupplier.run(makeId('rfqs'), id, supplierId, now);
  }
  return getRfq(db, id);
}

export function getRfq(db, id) {
  const rfq = db.prepare('SELECT * FROM purchase_rfqs WHERE id = ?').get(id);
  if (!rfq) return null;
  let attachments = [];
  try { attachments = JSON.parse(rfq.attachments || '[]'); } catch (_) {}
  return {
    ...rfq,
    attachments,
    lines: db.prepare('SELECT * FROM purchase_rfq_lines WHERE rfq_id = ? ORDER BY created_at, id').all(id),
    suppliers: db.prepare('SELECT * FROM purchase_rfq_suppliers WHERE rfq_id = ? ORDER BY invited_at, id').all(id),
    quotations: db.prepare('SELECT * FROM supplier_quotations WHERE rfq_id = ? ORDER BY total_amount, created_at').all(id),
  };
}

export function submitSupplierQuotation(db, {
  rfq_id,
  supplier_id,
  currency_id = 'IQD',
  total_amount,
  valid_until = null,
  lead_time_days = 0,
  tax_amount = 0,
  delivery_date = null,
  attachments = [],
  comments = '',
  lines = [],
  company_id,
}) {
  if (!rfq_id || !supplier_id || !Array.isArray(lines) || !lines.length) {
    throw new Error('RFQ ID, supplier ID, and line-level quotation facts are required');
  }
  const rfq = db.prepare('SELECT * FROM purchase_rfqs WHERE id = ? AND company_id = ?').get(rfq_id, company_id);
  if (!rfq || !['issued', 'awarded'].includes(rfq.state)) throw new Error('Supplier quotation requires an issued RFQ');
  const invite = db.prepare('SELECT * FROM purchase_rfq_suppliers WHERE rfq_id = ? AND supplier_id = ?').get(rfq_id, supplier_id);
  if (!invite) throw new Error('Supplier was not invited to this RFQ');
  const id = makeId('sq');
  const now = new Date().toISOString();
  const rfqLines = db.prepare('SELECT * FROM purchase_rfq_lines WHERE rfq_id = ?').all(rfq_id);
  const normalized = lines.map((line) => {
    const source = rfqLines.find((candidate) => candidate.id === line.rfq_line_id);
    if (!source) throw new Error(`Supplier quotation line is outside the RFQ: ${line.rfq_line_id}`);
    const quantity = Number(line.quantity ?? source.quantity);
    const unitPrice = Number(line.unit_price);
    const lineTax = Number(line.tax_amount || 0);
    const lineLeadTime = Number(line.lead_time_days ?? lead_time_days);
    if (!(quantity > 0) || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(lineTax) || lineTax < 0) {
      throw new Error('Supplier quotation quantity, price, and tax are invalid');
    }
    if (!Number.isInteger(lineLeadTime) || lineLeadTime < 0) throw new Error('Supplier quotation lead time is invalid');
    return {
      source,
      quantity,
      unitPrice,
      taxAmount: lineTax,
      leadTimeDays: lineLeadTime,
      deliveryDate: line.delivery_date || delivery_date,
      lineTotal: quantity * unitPrice + lineTax,
    };
  });
  const computedTax = normalized.reduce((sum, line) => sum + line.taxAmount, 0);
  const computedTotal = normalized.reduce((sum, line) => sum + line.lineTotal, 0);

  db.prepare(`
    INSERT INTO supplier_quotations (
      id, rfq_id, supplier_id, currency_id, total_amount, valid_until,
      is_awarded, created_at, lead_time_days, tax_amount, delivery_date,
      attachments, comments, state
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'received')
  `).run(
    id,
    rfq_id,
    supplier_id,
    currency_id,
    computedTotal,
    valid_until,
    now,
    Number(lead_time_days),
    computedTax,
    delivery_date,
    JSON.stringify(attachments || []),
    comments,
  );
  const insertLine = db.prepare(`
    INSERT INTO supplier_quotation_lines (
      id, quotation_id, rfq_line_id, product_id, quantity, unit_price,
      tax_amount, lead_time_days, delivery_date, line_total, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of normalized) {
    insertLine.run(
      makeId('sql'),
      id,
      line.source.id,
      line.source.product_id,
      line.quantity,
      line.unitPrice,
      line.taxAmount,
      line.leadTimeDays,
      line.deliveryDate,
      line.lineTotal,
      now,
    );
  }
  db.prepare("UPDATE purchase_rfq_suppliers SET status = 'responded' WHERE id = ?").run(invite.id);

  return getSupplierQuotation(db, id);
}

export function getSupplierQuotation(db, id) {
  const quotation = db.prepare('SELECT * FROM supplier_quotations WHERE id = ?').get(id);
  if (!quotation) return null;
  let attachments = [];
  try { attachments = JSON.parse(quotation.attachments || '[]'); } catch (_) {}
  return {
    ...quotation,
    attachments,
    lines: db.prepare('SELECT * FROM supplier_quotation_lines WHERE quotation_id = ? ORDER BY created_at, id').all(id),
  };
}

export function compareSupplierQuotations(db, rfqId) {
  return db.prepare(`
    SELECT q.*, p.name AS supplier_name,
      RANK() OVER (ORDER BY q.total_amount ASC, q.lead_time_days ASC, q.supplier_id ASC) AS comparison_rank
    FROM supplier_quotations q
    JOIN parties p ON p.id = q.supplier_id
    WHERE q.rfq_id = ?
    ORDER BY comparison_rank, q.id
  `).all(rfqId);
}

export function awardSupplierQuotation(db, { quotation_id, company_id }) {
  const quotation = getSupplierQuotation(db, quotation_id);
  if (!quotation) throw new Error(`Supplier quotation not found: ${quotation_id}`);
  const rfq = db.prepare('SELECT * FROM purchase_rfqs WHERE id = ? AND company_id = ?').get(quotation.rfq_id, company_id);
  if (!rfq) throw new Error('Supplier quotation is outside the active company');
  db.prepare('UPDATE supplier_quotations SET is_awarded = 0, state = ? WHERE rfq_id = ?').run('received', rfq.id);
  db.prepare("UPDATE supplier_quotations SET is_awarded = 1, state = 'awarded' WHERE id = ?").run(quotation_id);
  db.prepare("UPDATE purchase_rfq_suppliers SET status = CASE WHEN supplier_id = ? THEN 'awarded' ELSE status END WHERE rfq_id = ?").run(quotation.supplier_id, rfq.id);
  db.prepare("UPDATE purchase_rfqs SET state = 'awarded' WHERE id = ?").run(rfq.id);
  return getSupplierQuotation(db, quotation_id);
}
