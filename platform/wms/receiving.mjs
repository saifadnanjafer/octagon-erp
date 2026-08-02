// BUILD-09 mobile receiving orchestration. Canonical inventory posting is delegated.
'use strict';

import crypto from 'node:crypto';

export class ReceivingError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message); this.name = 'ReceivingError'; this.code = code; this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };

function required(input) {
  if (!input.company_id) throw new ReceivingError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new ReceivingError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function assertWarehouse(db, scope) {
  const row = db.prepare('SELECT * FROM warehouses WHERE id=? AND company_id=? AND is_active=1').get(scope.warehouseId, scope.companyId);
  if (!row) throw new ReceivingError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
  return row;
}

function sessionRow(db, id, input) {
  const scope = required(input);
  const row = db.prepare('SELECT * FROM wms_receiving_sessions WHERE id=? AND company_id=? AND warehouse_id=?').get(id, scope.companyId, scope.warehouseId);
  if (!row) throw new ReceivingError('Receiving session is outside warehouse scope', 'RECEIVING_SCOPE_DENIED', 403);
  return row;
}

function mappedLine(row) {
  return {
    id: row.id, sessionId: row.session_id, sourceLineId: row.source_line_id,
    productId: row.product_id, supplierBarcode: row.supplier_barcode, scannedBarcode: row.scanned_barcode,
    uomId: row.uom_id, expectedQuantity: Number(row.expected_quantity), receivedQuantity: Number(row.received_quantity),
    lotId: row.lot_id, lotCode: row.lot_code, serialId: row.serial_id, serialCode: row.serial_code,
    manufactureDate: row.manufacture_date, expiryDate: row.expiry_date, damaged: !!row.damaged,
    qualityRequired: !!row.quality_required, quarantineRequired: !!row.quarantine_required,
    destinationLocationId: row.destination_location_id, evidence: parse(row.evidence_json, []), status: row.status,
  };
}

function mapSession(db, row) {
  const lines = db.prepare('SELECT * FROM wms_receiving_lines WHERE session_id=? ORDER BY created_at,id').all(row.id).map(mappedLine);
  const discrepancies = db.prepare('SELECT * FROM wms_receiving_discrepancies WHERE session_id=? ORDER BY requested_at,id').all(row.id).map((item) => ({
    id: item.id, lineId: item.line_id, type: item.discrepancy_type, expectedValue: item.expected_value,
    actualValue: item.actual_value, reason: item.reason, status: item.status,
    requestedBy: item.requested_by, approvedBy: item.approved_by,
  }));
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    receiptType: row.receipt_type, reference: row.reference, sourceDocumentId: row.source_document_id,
    supplierId: row.supplier_id, status: row.status, expectedLineCount: row.expected_line_count,
    scannedLineCount: row.scanned_line_count, overReceiptTolerance: Number(row.over_receipt_tolerance),
    quarantineLocationId: row.quarantine_location_id, canonicalAction: row.canonical_action,
    canonicalRequest: parse(row.canonical_request_json, {}), canonicalPickingId: row.canonical_picking_id,
    labelRequests: parse(row.label_requests_json, []), startedBy: row.started_by,
    reviewedBy: row.reviewed_by, postedBy: row.posted_by, startedAt: row.started_at,
    updatedAt: row.updated_at, completedAt: row.completed_at, lines, discrepancies,
  };
}

function ensureState(row, allowed, code) {
  if (!allowed.includes(row.status)) throw new ReceivingError(`Receiving session is ${row.status}`, code, 409);
}

export function startReceiving(db, input) {
  const scope = required(input);
  const warehouse = assertWarehouse(db, scope);
  const allowedTypes = ['purchase_order', 'return', 'intercompany', 'production_return', 'controlled_non_po'];
  if (!allowedTypes.includes(input.receipt_type)) throw new ReceivingError('Unsupported receipt type', 'INVALID_RECEIPT_TYPE');
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM wms_receiving_sessions WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapSession(db, sessionRow(db, replay.id, input));
  }
  if (input.quarantine_location_id) {
    const location = db.prepare('SELECT id FROM stock_locations WHERE id=? AND company_id=? AND warehouse_id=? AND is_active=1').get(input.quarantine_location_id, scope.companyId, scope.warehouseId);
    if (!location) throw new ReceivingError('Quarantine location is outside warehouse scope', 'QUARANTINE_SCOPE_DENIED', 403);
  }
  const id = uid('recv');
  const stamp = now();
  db.prepare(`INSERT INTO wms_receiving_sessions(
    id,company_id,branch_id,warehouse_id,receipt_type,reference,source_document_id,supplier_id,status,
    expected_line_count,over_receipt_tolerance,quarantine_location_id,started_by,started_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?, 'started',?,?,?,?,?,?,?)`).run(
    id, scope.companyId, input.branch_id || null, warehouse.id, input.receipt_type,
    input.reference || null, input.source_document_id || null, input.supplier_id || null,
    Number(input.expected_line_count || 0), Number(input.over_receipt_tolerance || 0),
    input.quarantine_location_id || null, input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapSession(db, sessionRow(db, id, input));
}

export function scanReceivingReference(db, input) {
  const row = sessionRow(db, input.session_id, input);
  ensureState(row, ['started', 'scanning'], 'RECEIVING_REFERENCE_INVALID_STATE');
  if (!input.reference) throw new ReceivingError('Receipt reference scan is required', 'REFERENCE_REQUIRED');
  if (row.reference && row.reference !== input.reference) throw new ReceivingError('Reference does not match the planned receipt', 'REFERENCE_MISMATCH', 409);
  db.prepare(`UPDATE wms_receiving_sessions SET reference=?,source_document_id=COALESCE(source_document_id,?),status='scanning',updated_at=? WHERE id=?`).run(
    input.reference, input.source_document_id || null, now(), row.id,
  );
  return mapSession(db, sessionRow(db, row.id, input));
}

function productDetails(db, productId, companyId) {
  const row = db.prepare(`SELECT v.id,v.sku,v.barcode,t.uom_id,t.purchase_uom_id,t.category_id
    FROM product_variants v JOIN product_templates t ON t.id=v.template_id
    WHERE v.id=? AND v.company_id=? AND v.is_active=1`).get(productId, companyId);
  if (!row) throw new ReceivingError('Product is outside company scope', 'PRODUCT_SCOPE_DENIED', 403);
  return row;
}

function addDiscrepancy(db, { session, lineId, type, expected, actual, reason, actor }) {
  const existing = db.prepare(`SELECT id FROM wms_receiving_discrepancies WHERE line_id=? AND discrepancy_type=? AND status='open'`).get(lineId, type);
  if (existing) return existing.id;
  const id = uid('recvdisc');
  db.prepare(`INSERT INTO wms_receiving_discrepancies(id,session_id,line_id,discrepancy_type,expected_value,actual_value,reason,status,requested_by,requested_at)
    VALUES(?,?,?,?,?,?,?,'open',?,?)`).run(id, session.id, lineId, type, String(expected ?? ''), String(actual ?? ''), reason || null, actor, now());
  return id;
}

export function scanReceivingProduct(db, input) {
  const session = sessionRow(db, input.session_id, input);
  ensureState(session, ['started', 'scanning', 'discrepancy_review'], 'RECEIVING_SCAN_INVALID_STATE');
  const product = productDetails(db, input.product_id, session.company_id);
  const quantity = Number(input.quantity);
  if (!(quantity > 0)) throw new ReceivingError('Received quantity must be positive', 'INVALID_RECEIVED_QUANTITY');
  const expectedUom = product.purchase_uom_id || product.uom_id || '';
  if (input.uom_id && expectedUom && input.uom_id !== expectedUom) throw new ReceivingError('Scanned UOM does not match product receipt UOM', 'UOM_MISMATCH', 409);
  if (input.serial_code && quantity !== 1) throw new ReceivingError('Each serial scan must have quantity one', 'SERIAL_QUANTITY_INVALID', 409);
  if (input.manufacture_date && input.expiry_date && input.expiry_date <= input.manufacture_date) throw new ReceivingError('Expiry must follow manufacture date', 'INVALID_EXPIRY_DATE');
  const destination = input.quarantine_required || input.quality_required || input.damaged
    ? session.quarantine_location_id : input.destination_location_id;
  if (destination && !db.prepare('SELECT id FROM stock_locations WHERE id=? AND company_id=? AND warehouse_id=? AND is_active=1').get(destination, session.company_id, session.warehouse_id)) {
    throw new ReceivingError('Receipt destination is outside warehouse scope', 'DESTINATION_SCOPE_DENIED', 403);
  }
  if ((input.quarantine_required || input.quality_required || input.damaged) && !destination) throw new ReceivingError('Controlled receipt requires a quarantine location', 'QUARANTINE_LOCATION_REQUIRED', 409);
  const evidence = Array.isArray(input.evidence) ? input.evidence.filter((item) => item && typeof item === 'object').slice(0, 20) : [];
  const id = uid('recvline');
  const stamp = now();
  const expectedQuantity = Number(input.expected_quantity || 0);
  db.prepare(`INSERT INTO wms_receiving_lines(
    id,session_id,source_line_id,product_id,supplier_barcode,scanned_barcode,uom_id,expected_quantity,received_quantity,
    lot_id,lot_code,serial_id,serial_code,manufacture_date,expiry_date,damaged,quality_required,quarantine_required,
    destination_location_id,evidence_json,status,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'scanned',?,?,?)`).run(
    id, session.id, input.source_line_id || null, product.id, input.supplier_barcode || null,
    input.barcode || product.barcode || product.sku, input.uom_id || expectedUom || null,
    expectedQuantity, quantity, input.lot_id || null, input.lot_code || null,
    input.serial_id || null, input.serial_code || null, input.manufacture_date || null,
    input.expiry_date || null, input.damaged ? 1 : 0, input.quality_required ? 1 : 0,
    input.quarantine_required || input.quality_required || input.damaged ? 1 : 0,
    destination || null, JSON.stringify(evidence), input.actor, stamp, stamp,
  );
  let hasDiscrepancy = false;
  const tolerance = expectedQuantity * Number(session.over_receipt_tolerance || 0) / 100;
  if (expectedQuantity && quantity > expectedQuantity + tolerance) {
    addDiscrepancy(db, { session, lineId: id, type: 'over', expected: expectedQuantity, actual: quantity, reason: input.discrepancy_reason, actor: input.actor }); hasDiscrepancy = true;
  }
  if (expectedQuantity && quantity < expectedQuantity) {
    addDiscrepancy(db, { session, lineId: id, type: 'under', expected: expectedQuantity, actual: quantity, reason: input.discrepancy_reason, actor: input.actor }); hasDiscrepancy = true;
  }
  if (input.damaged) {
    addDiscrepancy(db, { session, lineId: id, type: 'damage', expected: 'undamaged', actual: 'damaged', reason: input.discrepancy_reason, actor: input.actor }); hasDiscrepancy = true;
  }
  db.prepare(`UPDATE wms_receiving_lines SET status=? WHERE id=?`).run(hasDiscrepancy ? 'discrepancy' : 'accepted', id);
  db.prepare(`UPDATE wms_receiving_sessions SET scanned_line_count=(SELECT COUNT(*) FROM wms_receiving_lines WHERE session_id=?),status=?,updated_at=? WHERE id=?`).run(
    session.id, hasDiscrepancy ? 'discrepancy_review' : 'scanning', stamp, session.id,
  );
  return { session: mapSession(db, sessionRow(db, session.id, input)), line: mappedLine(db.prepare('SELECT * FROM wms_receiving_lines WHERE id=?').get(id)) };
}

export function approveReceivingDiscrepancy(db, input) {
  const session = sessionRow(db, input.session_id, input);
  const discrepancy = db.prepare(`SELECT d.* FROM wms_receiving_discrepancies d WHERE d.id=? AND d.session_id=?`).get(input.discrepancy_id, session.id);
  if (!discrepancy) throw new ReceivingError('Discrepancy is outside session scope', 'DISCREPANCY_SCOPE_DENIED', 403);
  if (discrepancy.status !== 'open') return mapSession(db, session);
  if (discrepancy.requested_by === input.actor) throw new ReceivingError('Discrepancy approval requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  if (!input.decision || !['approved', 'rejected'].includes(input.decision)) throw new ReceivingError('Approval decision is required', 'INVALID_DISCREPANCY_DECISION');
  const stamp = now();
  db.prepare('UPDATE wms_receiving_discrepancies SET status=?,approved_by=?,reason=COALESCE(?,reason),resolved_at=? WHERE id=?').run(input.decision, input.actor, input.reason || null, stamp, discrepancy.id);
  db.prepare('UPDATE wms_receiving_lines SET status=? ,updated_at=? WHERE id=?').run(input.decision === 'approved' ? 'accepted' : 'rejected', stamp, discrepancy.line_id);
  return mapSession(db, sessionRow(db, session.id, input));
}

export function reviewReceiving(db, input) {
  const row = sessionRow(db, input.session_id, input);
  ensureState(row, ['scanning', 'discrepancy_review'], 'RECEIVING_REVIEW_INVALID_STATE');
  const lineCount = db.prepare('SELECT COUNT(*) count FROM wms_receiving_lines WHERE session_id=?').get(row.id).count;
  if (!lineCount) throw new ReceivingError('Receipt has no scanned lines', 'RECEIVING_LINES_REQUIRED', 409);
  const open = db.prepare(`SELECT COUNT(*) count FROM wms_receiving_discrepancies WHERE session_id=? AND status='open'`).get(row.id).count;
  const rejected = db.prepare(`SELECT COUNT(*) count FROM wms_receiving_lines WHERE session_id=? AND status='rejected'`).get(row.id).count;
  if (open || rejected) throw new ReceivingError('Receipt discrepancies require resolution', 'RECEIVING_DISCREPANCIES_OPEN', 409);
  db.prepare(`UPDATE wms_receiving_sessions SET status='ready',reviewed_by=?,updated_at=? WHERE id=?`).run(input.actor, now(), row.id);
  return mapSession(db, sessionRow(db, row.id, input));
}

export function requestReceivingPost(db, input) {
  const row = sessionRow(db, input.session_id, input);
  ensureState(row, ['ready'], 'RECEIVING_POST_INVALID_STATE');
  if (!input.picking_id) throw new ReceivingError('Canonical stock picking is required', 'CANONICAL_PICKING_REQUIRED', 409);
  const picking = db.prepare('SELECT * FROM stock_pickings WHERE id=? AND company_id=?').get(input.picking_id, row.company_id);
  if (!picking || picking.state === 'done') throw new ReceivingError('Canonical picking is missing or already posted', 'CANONICAL_PICKING_INVALID', 409);
  const lines = db.prepare(`SELECT * FROM wms_receiving_lines WHERE session_id=? AND status='accepted'`).all(row.id);
  const request = {
    picking_id: picking.id,
    moves: lines.map((line) => ({ product_id: line.product_id, uom_id: line.uom_id, product_qty: Number(line.received_quantity), lot_id: line.lot_id, serial_id: line.serial_id })),
    idempotency_key: `${row.id}:canonical-receipt`,
  };
  db.prepare(`UPDATE wms_receiving_sessions SET status='awaiting_canonical',canonical_picking_id=?,canonical_request_json=?,updated_at=? WHERE id=?`).run(picking.id, JSON.stringify(request), now(), row.id);
  db.prepare(`UPDATE wms_receiving_lines SET status='awaiting_canonical',updated_at=? WHERE session_id=? AND status='accepted'`).run(now(), row.id);
  return { ...mapSession(db, sessionRow(db, row.id, input)), executionBoundary: 'REQUEST_ONLY', inventoryWritten: false };
}

export function acknowledgeReceivingPost(db, input) {
  const row = sessionRow(db, input.session_id, input);
  ensureState(row, ['awaiting_canonical'], 'RECEIVING_ACK_INVALID_STATE');
  const picking = db.prepare('SELECT id,state FROM stock_pickings WHERE id=? AND company_id=?').get(row.canonical_picking_id, row.company_id);
  if (!picking || picking.state !== 'done') throw new ReceivingError('Canonical receipt is not posted', 'CANONICAL_RECEIPT_NOT_POSTED', 409);
  const stamp = now();
  db.prepare(`UPDATE wms_receiving_sessions SET status='putaway_pending',posted_by=?,updated_at=? WHERE id=?`).run(input.actor, stamp, row.id);
  db.prepare(`UPDATE wms_receiving_lines SET status='putaway_pending',updated_at=? WHERE session_id=? AND status='awaiting_canonical'`).run(stamp, row.id);
  return mapSession(db, sessionRow(db, row.id, input));
}

export function completeReceiving(db, input) {
  const row = sessionRow(db, input.session_id, input);
  ensureState(row, ['putaway_pending', 'posted'], 'RECEIVING_COMPLETE_INVALID_STATE');
  const openTasks = db.prepare(`SELECT COUNT(*) count FROM wms_warehouse_tasks WHERE source_record_type='receiving_session' AND source_record_id=? AND status NOT IN ('completed','cancelled')`).get(row.id).count;
  if (openTasks) throw new ReceivingError('Putaway tasks remain open', 'PUTAWAY_TASKS_OPEN', 409);
  const stamp = now();
  db.prepare(`UPDATE wms_receiving_sessions SET status='completed',completed_at=?,updated_at=? WHERE id=?`).run(stamp, stamp, row.id);
  db.prepare(`UPDATE wms_receiving_lines SET status='completed',updated_at=? WHERE session_id=? AND status IN ('posted','putaway_pending')`).run(stamp, row.id);
  return mapSession(db, sessionRow(db, row.id, input));
}

export function listReceivingSessions(db, input) {
  const scope = required(input); assertWarehouse(db, scope);
  let sql = 'SELECT * FROM wms_receiving_sessions WHERE company_id=? AND warehouse_id=?';
  const params = [scope.companyId, scope.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY started_at DESC';
  return db.prepare(sql).all(...params).map((row) => mapSession(db, row));
}
