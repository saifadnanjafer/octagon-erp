import crypto from 'node:crypto';

function makeId(prefix = 'rfq') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createRfq(db, { company_id = '*', name, requisition_id = null, deadline = null }) {
  if (!name) throw new Error('RFQ name is required');
  const id = makeId('rfq');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO purchase_rfqs (id, company_id, name, requisition_id, state, deadline, created_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?)
  `).run(id, company_id, name, requisition_id, deadline, now);

  return db.prepare(`SELECT * FROM purchase_rfqs WHERE id = ?`).get(id);
}

export function submitSupplierQuotation(db, { rfq_id, supplier_id, currency_id = 'IQD', total_amount, valid_until = null }) {
  if (!rfq_id || !supplier_id || total_amount === undefined) {
    throw new Error('RFQ ID, supplier ID, and total_amount are required');
  }
  const id = makeId('sq');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO supplier_quotations (id, rfq_id, supplier_id, currency_id, total_amount, valid_until, is_awarded, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, rfq_id, supplier_id, currency_id, Number(total_amount), valid_until, now);

  return db.prepare(`SELECT * FROM supplier_quotations WHERE id = ?`).get(id);
}

export function awardSupplierQuotation(db, { rfq_id, quotation_id }) {
  db.prepare(`UPDATE supplier_quotations SET is_awarded = 0 WHERE rfq_id = ?`).run(rfq_id);
  db.prepare(`UPDATE supplier_quotations SET is_awarded = 1 WHERE id = ?`).run(quotation_id);
  db.prepare(`UPDATE purchase_rfqs SET state = 'awarded' WHERE id = ?`).run(rfq_id);

  return db.prepare(`SELECT * FROM supplier_quotations WHERE id = ?`).get(quotation_id);
}
