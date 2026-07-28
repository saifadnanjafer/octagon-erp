import crypto from 'node:crypto';

function makeId(prefix = 'req') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function qualifySupplier(db, { company_id = '*', supplier_id, status = 'approved', rating = 5.0, notes = '' }) {
  if (!supplier_id) throw new Error('Supplier ID is required');
  const id = makeId('qual');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO supplier_qualifications (id, company_id, supplier_id, status, rating, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, supplier_id, status, Number(rating), notes, now);

  return db.prepare(`SELECT * FROM supplier_qualifications WHERE id = ?`).get(id);
}

export function createRequisition(db, reqData) {
  const {
    company_id = '*',
    name,
    requested_by = '',
    requisition_date = new Date().toISOString().split('T')[0],
    source_request_id = null,
    needed_by = null,
    notes = '',
    attachments = [],
    lines = [],
  } = reqData;

  if (!name) throw new Error('Requisition name is required');
  const id = makeId('req');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO purchase_requisitions (
      id, company_id, name, requested_by, state, requisition_date, created_at,
      source_request_id, needed_by, notes, attachments
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, name, requested_by, requisition_date, now, source_request_id, needed_by, notes, JSON.stringify(attachments || []));

  const insertLine = db.prepare(`
    INSERT INTO purchase_requisition_lines (
      id, requisition_id, product_id, qty, uom_id, estimated_unit_cost,
      quality_required, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const l of lines) {
    insertLine.run(
      makeId('reqline'),
      id,
      l.product_id,
      Number(l.qty || 1),
      l.uom_id,
      Number(l.estimated_unit_cost || 0),
      l.quality_required ? 1 : 0,
      now,
    );
  }

  return getRequisition(db, id);
}

export function getRequisition(db, id) {
  const req = db.prepare(`SELECT * FROM purchase_requisitions WHERE id = ?`).get(id);
  if (!req) return null;
  const lines = db.prepare(`SELECT * FROM purchase_requisition_lines WHERE requisition_id = ?`).all(id);
  let attachments = [];
  try { attachments = JSON.parse(req.attachments || '[]'); } catch (_) {}
  return { ...req, attachments, lines };
}

export function approveRequisition(db, { requisition_id, company_id, actor }) {
  const requisition = getRequisition(db, requisition_id);
  if (!requisition || requisition.company_id !== company_id) throw new Error(`Purchase requisition not found: ${requisition_id}`);
  if (requisition.state !== 'draft') throw new Error('Only draft requisitions can be approved');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE purchase_requisitions
    SET state = 'approved', approved_by = ?, approved_at = ?
    WHERE id = ?
  `).run(actor, now, requisition_id);
  return getRequisition(db, requisition_id);
}
