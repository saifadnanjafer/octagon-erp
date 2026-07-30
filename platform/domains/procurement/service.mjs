// platform/domains/procurement/service.mjs — Advanced Procurement and Supplier Portal Domain Services.

export function generatePRNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `PR-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM purchase_requisitions WHERE company_id = ? AND requisition_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateRFQNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `RFQ-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM rfq_headers WHERE company_id = ? AND rfq_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateBidNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `BID-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM supplier_bids WHERE company_id = ? AND bid_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createRequisition(db, { company_id, requester_id, department_id = null, title, justification = null }) {
  const id = `pr-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const prNum = generatePRNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO purchase_requisitions (id, company_id, name, requisition_number, requester_id, department_id, title, justification, total_estimated_cost, state, status, requisition_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.0, 'draft', 'draft', ?, ?, ?)
  `).run(id, company_id, prNum, prNum, requester_id, department_id, title, justification, now, now, now);

  return db.prepare('SELECT * FROM purchase_requisitions WHERE id = ?').get(id);
}

export function addRequisitionLine(db, { company_id, requisition_id, product_id, quantity, uom_id = 'uom-unit', estimated_unit_cost, required_date, notes = null }) {
  const req = db.prepare('SELECT * FROM purchase_requisitions WHERE id = ? AND company_id = ?').get(requisition_id, company_id);
  if (!req) throw new Error(`Requisition ${requisition_id} not found`);
  if (req.status !== 'draft') throw new Error(`Cannot modify lines for requisition in status: ${req.status}`);

  const id = `prline-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO purchase_requisition_lines (id, company_id, requisition_id, product_id, qty, quantity, uom_id, estimated_unit_cost, required_date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, requisition_id, product_id, quantity, quantity, uom_id, estimated_unit_cost, required_date, notes, now);

  // Recalculate total estimated cost
  const totalRow = db.prepare(`
    SELECT SUM(quantity * estimated_unit_cost) as total FROM purchase_requisition_lines WHERE requisition_id = ?
  `).get(requisition_id);

  db.prepare(`
    UPDATE purchase_requisitions SET total_estimated_cost = ?, updated_at = ? WHERE id = ?
  `).run(totalRow ? totalRow.total : 0.0, now, requisition_id);

  return db.prepare('SELECT * FROM purchase_requisition_lines WHERE id = ?').get(id);
}

export function approveRequisition(db, { id, company_id, approved_by }) {
  const req = db.prepare('SELECT * FROM purchase_requisitions WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!req) throw new Error(`Requisition ${id} not found`);
  
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE purchase_requisitions SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
  `).run(approved_by, now, now, id);

  return db.prepare('SELECT * FROM purchase_requisitions WHERE id = ?').get(id);
}

export function createRFQ(db, { company_id, requisition_id = null, title, bid_submission_deadline, delivery_location = null, terms_and_conditions = null }) {
  const id = `rfq-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const rfqNum = generateRFQNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO rfq_headers (id, company_id, rfq_number, requisition_id, title, bid_submission_deadline, delivery_location, terms_and_conditions, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(id, company_id, rfqNum, requisition_id, title, bid_submission_deadline, delivery_location, terms_and_conditions, now, now);

  if (requisition_id) {
    db.prepare(`UPDATE purchase_requisitions SET status = 'converted_to_rfq', updated_at = ? WHERE id = ?`).run(now, requisition_id);
  }

  return db.prepare('SELECT * FROM rfq_headers WHERE id = ?').get(id);
}

export function inviteSupplierToRFQ(db, { company_id, rfq_id, supplier_id }) {
  const rfq = db.prepare('SELECT * FROM rfq_headers WHERE id = ? AND company_id = ?').get(rfq_id, company_id);
  if (!rfq) throw new Error(`RFQ ${rfq_id} not found`);

  const id = `rfqsup-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO rfq_suppliers (id, company_id, rfq_id, supplier_id, invitation_status, invited_at)
    VALUES (?, ?, ?, ?, 'invited', ?)
  `).run(id, company_id, rfq_id, supplier_id, now);

  return db.prepare('SELECT * FROM rfq_suppliers WHERE id = ?').get(id);
}

export function publishRFQ(db, { id, company_id }) {
  const rfq = db.prepare('SELECT * FROM rfq_headers WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!rfq) throw new Error(`RFQ ${id} not found`);

  const now = new Date().toISOString();
  db.prepare(`UPDATE rfq_headers SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);

  return db.prepare('SELECT * FROM rfq_headers WHERE id = ?').get(id);
}

export function submitSupplierBid(db, { company_id, rfq_id, supplier_id, lines, delivery_lead_time_days = 7, validity_end_date, currency = 'USD' }) {
  const rfq = db.prepare('SELECT * FROM rfq_headers WHERE id = ? AND company_id = ?').get(rfq_id, company_id);
  if (!rfq) throw new Error(`RFQ ${rfq_id} not found`);
  if (rfq.status !== 'published') throw new Error(`Cannot submit bid for RFQ in status: ${rfq.status}`);

  const bidId = `bid-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const bidNum = generateBidNumber(db, company_id);
  const now = new Date().toISOString();

  let totalAmount = 0.0;
  for (const line of lines) {
    totalAmount += line.quantity * line.unit_price;
  }

  db.prepare(`
    INSERT INTO supplier_bids (id, company_id, bid_number, rfq_id, supplier_id, total_bid_amount, currency, delivery_lead_time_days, validity_end_date, status, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)
  `).run(bidId, company_id, bidNum, rfq_id, supplier_id, totalAmount, currency, delivery_lead_time_days, validity_end_date, now, now, now);

  for (const line of lines) {
    const lineId = `bidline-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const lineTotal = line.quantity * line.unit_price;
    db.prepare(`
      INSERT INTO supplier_bid_lines (id, company_id, bid_id, product_id, quantity, unit_price, total_line_amount, delivery_date, specifications_match, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lineId, company_id, bidId, line.product_id, line.quantity, line.unit_price, lineTotal, line.delivery_date || null, line.specifications_match ?? 1, line.notes || null);
  }

  return db.prepare('SELECT * FROM supplier_bids WHERE id = ?').get(bidId);
}

export function awardRFQ(db, { company_id, rfq_id, winning_bid_id, awarded_by }) {
  const rfq = db.prepare('SELECT * FROM rfq_headers WHERE id = ? AND company_id = ?').get(rfq_id, company_id);
  if (!rfq) throw new Error(`RFQ ${rfq_id} not found`);

  const bid = db.prepare('SELECT * FROM supplier_bids WHERE id = ? AND rfq_id = ?').get(winning_bid_id, rfq_id);
  if (!bid) throw new Error(`Bid ${winning_bid_id} not found for RFQ ${rfq_id}`);

  const now = new Date().toISOString();

  // Mark winning bid accepted, other bids rejected
  db.prepare(`UPDATE supplier_bids SET status = 'accepted', updated_at = ? WHERE id = ?`).run(now, winning_bid_id);
  db.prepare(`UPDATE supplier_bids SET status = 'rejected', updated_at = ? WHERE rfq_id = ? AND id != ?`).run(now, rfq_id, winning_bid_id);

  // Close RFQ & stamp awarded_bid_id
  db.prepare(`UPDATE rfq_headers SET status = 'awarded', awarded_bid_id = ?, updated_at = ? WHERE id = ?`).run(winning_bid_id, now, rfq_id);

  return db.prepare('SELECT * FROM rfq_headers WHERE id = ?').get(rfq_id);
}

export function evaluateSupplierPerformance(db, { company_id, supplier_id, evaluation_period, quality_score, delivery_score, price_competitiveness_score, evaluator_id, comments = null }) {
  const overall = (quality_score * 0.4) + (delivery_score * 0.4) + (price_competitiveness_score * 0.2);
  const id = `supeval-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO supplier_evaluations (id, company_id, supplier_id, evaluation_period, quality_score, delivery_score, price_competitiveness_score, overall_rating, evaluator_id, comments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, supplier_id, evaluation_period, quality_score, delivery_score, price_competitiveness_score, overall, evaluator_id, comments, now);

  return db.prepare('SELECT * FROM supplier_evaluations WHERE id = ?').get(id);
}
