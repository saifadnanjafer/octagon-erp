// BUILD-09 operational quality orchestration over canonical Quality, MRP, and Inventory authorities.
'use strict';
import crypto from 'node:crypto';

export class QualityOperationsError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'QualityOperationsError'; this.code = code; this.statusCode = statusCode; }
}
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } };

function scope(input) {
  if (!input.company_id) throw new QualityOperationsError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new QualityOperationsError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function checkpointRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM quality_operational_checkpoints WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new QualityOperationsError('Quality checkpoint is outside warehouse scope', 'QUALITY_CHECKPOINT_SCOPE_DENIED', 403);
  return row;
}

function dispositionRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM quality_disposition_requests WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new QualityOperationsError('Quality disposition is outside warehouse scope', 'QUALITY_DISPOSITION_SCOPE_DENIED', 403);
  return row;
}

function mapCheckpoint(row) {
  return { id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id, checkpointType: row.checkpoint_type,
    sourceType: row.source_type, sourceId: row.source_id, inspectionId: row.inspection_id, planId: row.plan_id,
    productId: row.product_id, lotId: row.lot_id, serialId: row.serial_id,
    samplingPlanReference: row.sampling_plan_reference, sampleSize: Number(row.sample_size),
    acceptedQuantity: Number(row.accepted_quantity), rejectedQuantity: Number(row.rejected_quantity), status: row.status,
    holdLocationId: row.hold_location_id, reasonCode: row.reason_code, evidence: parse(row.evidence_json, []),
    ncrId: row.ncr_id, capaId: row.capa_id, openedBy: row.opened_by, decidedBy: row.decided_by,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapDisposition(row) {
  return { id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id, checkpointId: row.checkpoint_id,
    dispositionType: row.disposition_type, quantity: Number(row.quantity), sourceLocationId: row.source_location_id,
    destinationLocationId: row.destination_location_id, reasonCode: row.reason_code, ncrId: row.ncr_id, capaId: row.capa_id,
    status: row.status, evidence: parse(row.evidence_json, []), decisionNotes: row.decision_notes,
    canonicalAction: row.canonical_action, canonicalRequest: parse(row.canonical_request_json),
    canonicalResultId: row.canonical_result_id, requestedBy: row.requested_by, approvedBy: row.approved_by,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function ensureState(row, allowed, code) { if (!allowed.includes(row.status)) throw new QualityOperationsError(`Record is ${row.status}`, code, 409); }

function validateSource(db, input, current) {
  if (input.source_type === 'shopfloor_session') {
    const source = db.prepare('SELECT s.id,p.product_id FROM mfg_shopfloor_sessions s JOIN mfg_production_orders p ON p.id=s.production_order_id WHERE s.id=? AND s.company_id=? AND s.warehouse_id=?').get(input.source_id, current.companyId, current.warehouseId);
    if (!source) throw new QualityOperationsError('Shop-floor source is outside warehouse scope', 'QUALITY_SOURCE_SCOPE_DENIED', 403);
    return source;
  }
  if (input.source_type === 'receiving_session') {
    const source = db.prepare('SELECT id FROM wms_receiving_sessions WHERE id=? AND company_id=? AND warehouse_id=?').get(input.source_id, current.companyId, current.warehouseId);
    if (!source) throw new QualityOperationsError('Receiving source is outside warehouse scope', 'QUALITY_SOURCE_SCOPE_DENIED', 403);
    return source;
  }
  if (input.source_type === 'production_order') {
    const source = db.prepare('SELECT id,product_id FROM mfg_production_orders WHERE id=? AND company_id=? AND warehouse_id=?').get(input.source_id, current.companyId, current.warehouseId);
    if (!source) throw new QualityOperationsError('Production source is outside warehouse scope', 'QUALITY_SOURCE_SCOPE_DENIED', 403);
    return source;
  }
  if (input.source_type === 'work_order') {
    const source = db.prepare(`SELECT w.id,p.product_id FROM mfg_work_orders w
      JOIN mfg_production_orders p ON p.id=w.production_order_id
      WHERE w.id=? AND w.company_id=? AND p.company_id=? AND p.warehouse_id=?`).get(input.source_id, current.companyId, current.companyId, current.warehouseId);
    if (!source) throw new QualityOperationsError('Work-order source is outside warehouse scope', 'QUALITY_SOURCE_SCOPE_DENIED', 403);
    return source;
  }
  throw new QualityOperationsError('Unsupported quality source type', 'QUALITY_SOURCE_TYPE_INVALID', 422);
}

export function openOperationalCheckpoint(db, input) {
  const current = scope(input);
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM quality_operational_checkpoints WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapCheckpoint(checkpointRow(db, replay.id, input));
  }
  validateSource(db, input, current);
  const inspection = db.prepare('SELECT * FROM quality_inspections WHERE id=? AND company_id=?').get(input.inspection_id, current.companyId);
  if (!inspection) throw new QualityOperationsError('Canonical inspection is outside company scope', 'QUALITY_INSPECTION_SCOPE_DENIED', 403);
  if (input.product_id && input.product_id !== inspection.product_id) throw new QualityOperationsError('Checkpoint product does not match inspection', 'QUALITY_PRODUCT_MISMATCH', 409);
  const allowed = ['incoming', 'in_process', 'final', 'retest'];
  if (!allowed.includes(input.checkpoint_type)) throw new QualityOperationsError('Invalid checkpoint type', 'QUALITY_CHECKPOINT_TYPE_INVALID');
  if (input.hold_location_id) {
    const hold = db.prepare(`SELECT l.id,p.location_type FROM stock_locations l LEFT JOIN wms_location_profiles p ON p.location_id=l.id
      WHERE l.id=? AND l.company_id=? AND l.warehouse_id=?`).get(input.hold_location_id, current.companyId, current.warehouseId);
    if (!hold || !['quarantine', 'staging'].includes(hold.location_type)) throw new QualityOperationsError('Hold location must be a scoped quarantine or staging location', 'QUALITY_HOLD_LOCATION_INVALID', 409);
  }
  const statusMap = { pending: 'pending', in_progress: 'in_progress', pass: 'pass', fail: 'hold', released: 'released', quarantine: 'quarantine', ncr: 'ncr' };
  const id = uid('qcheck'); const stamp = now();
  db.prepare(`INSERT INTO quality_operational_checkpoints(
    id,company_id,warehouse_id,checkpoint_type,source_type,source_id,inspection_id,plan_id,product_id,lot_id,serial_id,
    sampling_plan_reference,sample_size,status,hold_location_id,evidence_json,opened_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, current.companyId, current.warehouseId, input.checkpoint_type, input.source_type, input.source_id,
    inspection.id, inspection.plan_id, inspection.product_id, input.lot_id || null, input.serial_id || null,
    input.sampling_plan_reference || null, Number(input.sample_size || inspection.sample_size),
    statusMap[inspection.state] || 'pending', input.hold_location_id || null, JSON.stringify(input.evidence || []),
    input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapCheckpoint(checkpointRow(db, id, input));
}

export function syncOperationalCheckpoint(db, input) {
  const row = checkpointRow(db, input.checkpoint_id, input);
  const inspection = db.prepare('SELECT * FROM quality_inspections WHERE id=? AND company_id=?').get(row.inspection_id, row.company_id);
  if (!inspection) throw new QualityOperationsError('Canonical inspection is missing', 'CANONICAL_INSPECTION_MISSING', 409);
  const statusMap = { pending: 'pending', in_progress: 'in_progress', pass: 'pass', fail: 'hold', released: 'released', quarantine: 'quarantine', ncr: 'ncr' };
  const status = statusMap[inspection.state];
  if (!status) throw new QualityOperationsError(`Unsupported canonical inspection state ${inspection.state}`, 'CANONICAL_QUALITY_STATE_INVALID', 409);
  const ncr = status === 'ncr' ? db.prepare('SELECT id FROM quality_ncrs WHERE inspection_id=? AND company_id=? ORDER BY created_at DESC LIMIT 1').get(inspection.id, row.company_id) : null;
  db.prepare(`UPDATE quality_operational_checkpoints SET status=?,accepted_quantity=?,rejected_quantity=?,decided_by=?,ncr_id=COALESCE(?,ncr_id),evidence_json=?,updated_at=? WHERE id=?`).run(
    status, Number(inspection.passed_quantity || 0), Number(inspection.failed_quantity || 0), inspection.inspector_id,
    ncr?.id || null, JSON.stringify([...(parse(row.evidence_json, [])), ...(input.evidence || [])]), now(), row.id,
  );
  if (status === 'hold' && row.source_type === 'shopfloor_session') db.prepare("UPDATE mfg_shopfloor_sessions SET status='quality_hold',updated_at=? WHERE id=? AND status IN ('running','paused','awaiting_canonical')").run(now(), row.source_id);
  return { ...mapCheckpoint(checkpointRow(db, row.id, input)), canonicalQualityWritten: false };
}

export function conditionallyAcceptCheckpoint(db, input) {
  const row = checkpointRow(db, input.checkpoint_id, input); ensureState(row, ['hold', 'fail', 'quarantine'], 'QUALITY_CONDITIONAL_INVALID_STATE');
  if (row.opened_by === input.actor) throw new QualityOperationsError('Conditional acceptance requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  const quantity = Number(input.accepted_quantity); if (!(quantity > 0) || quantity > Number(row.sample_size)) throw new QualityOperationsError('Conditional quantity is invalid', 'QUALITY_CONDITIONAL_QUANTITY_INVALID');
  db.prepare(`UPDATE quality_operational_checkpoints SET status='conditional',accepted_quantity=?,reason_code=?,decided_by=?,evidence_json=?,updated_at=? WHERE id=?`).run(
    quantity, input.reason_code || 'CONDITIONAL_ACCEPTANCE', input.actor, JSON.stringify([...(parse(row.evidence_json, [])), ...(input.evidence || [])]), now(), row.id);
  return { ...mapCheckpoint(checkpointRow(db, row.id, input)), canonicalAction: 'quality:inspection:release', executionBoundary: 'REQUEST_ONLY' };
}

export function requestDisposition(db, input) {
  const checkpoint = checkpointRow(db, input.checkpoint_id, input); ensureState(checkpoint, ['hold', 'fail', 'quarantine', 'ncr', 'conditional'], 'QUALITY_DISPOSITION_INVALID_STATE');
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM quality_disposition_requests WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapDisposition(dispositionRow(db, replay.id, input));
  }
  const allowed = ['conditional_acceptance', 'quarantine', 'rework', 'retest', 'scrap', 'return_to_vendor'];
  if (!allowed.includes(input.disposition_type)) throw new QualityOperationsError('Invalid disposition type', 'QUALITY_DISPOSITION_TYPE_INVALID');
  const quantity = Number(input.quantity); if (!(quantity > 0) || quantity > Math.max(Number(checkpoint.rejected_quantity), Number(checkpoint.sample_size))) throw new QualityOperationsError('Disposition quantity is invalid', 'QUALITY_DISPOSITION_QUANTITY_INVALID');
  let ncrId = input.ncr_id || checkpoint.ncr_id;
  if (['rework', 'scrap', 'return_to_vendor'].includes(input.disposition_type)) {
    const ncr = ncrId ? db.prepare('SELECT * FROM quality_ncrs WHERE id=? AND company_id=? AND inspection_id=?').get(ncrId, checkpoint.company_id, checkpoint.inspection_id) : null;
    if (!ncr) throw new QualityOperationsError('Canonical NCR linkage is required for this disposition', 'NCR_LINK_REQUIRED', 409);
  }
  const id = uid('qdisp'); const stamp = now();
  db.prepare(`INSERT INTO quality_disposition_requests(
    id,company_id,warehouse_id,checkpoint_id,disposition_type,quantity,source_location_id,destination_location_id,
    reason_code,ncr_id,capa_id,status,evidence_json,requested_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'requested',?,?,?,?,?)`).run(
    id, checkpoint.company_id, checkpoint.warehouse_id, checkpoint.id, input.disposition_type, quantity,
    input.source_location_id || null, input.destination_location_id || checkpoint.hold_location_id || null,
    input.reason_code, ncrId || null, input.capa_id || checkpoint.capa_id || null,
    JSON.stringify(input.evidence || []), input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapDisposition(dispositionRow(db, id, input));
}

export function approveDisposition(db, input) {
  const row = dispositionRow(db, input.disposition_id, input); ensureState(row, ['requested'], 'QUALITY_DISPOSITION_APPROVE_INVALID_STATE');
  if (row.requested_by === input.actor) throw new QualityOperationsError('Disposition approval requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  const checkpoint = checkpointRow(db, row.checkpoint_id, input); const stamp = now();
  if (row.disposition_type === 'rework') {
    const routeId = uid('qrework'); const reference = input.route_reference || `REWORK/${row.id}`;
    const source = checkpoint.source_type === 'shopfloor_session' ? db.prepare('SELECT production_order_id,work_order_id FROM mfg_shopfloor_sessions WHERE id=?').get(checkpoint.source_id) : {};
    const canonicalRequest = { order_id: source?.production_order_id || null, reason: row.reason_code, source_disposition_id: row.id, executionBoundary: 'REQUEST_ONLY' };
    db.prepare(`INSERT INTO quality_rework_routes(id,company_id,disposition_request_id,production_order_id,source_work_order_id,route_reference,operations_json,retest_required,status,canonical_action,canonical_request_json,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?, 'planned','manufacturing:order:hold',?,?,?,?)`).run(routeId, row.company_id, row.id, source?.production_order_id || null, source?.work_order_id || null, reference, JSON.stringify(input.operations || []), input.retest_required === false ? 0 : 1, JSON.stringify(canonicalRequest), input.actor, stamp, stamp);
    db.prepare("UPDATE quality_disposition_requests SET status='route_created',approved_by=?,decision_notes=?,updated_at=? WHERE id=?").run(input.actor, input.decision_notes || null, stamp, row.id);
    db.prepare("UPDATE quality_operational_checkpoints SET status='rework',decided_by=?,updated_at=? WHERE id=?").run(input.actor, stamp, checkpoint.id);
    if (checkpoint.source_type === 'shopfloor_session') db.prepare("UPDATE mfg_shopfloor_sessions SET status='rework',updated_at=? WHERE id=?").run(stamp, checkpoint.source_id);
    return { ...mapDisposition(dispositionRow(db, row.id, input)), reworkRouteId: routeId, canonicalManufacturingWritten: false };
  }
  let canonicalAction = null; let request = {};
  if (row.disposition_type === 'scrap') {
    const destination = db.prepare('SELECT id,is_scrap FROM stock_locations WHERE id=? AND company_id=? AND warehouse_id=?').get(row.destination_location_id, row.company_id, row.warehouse_id);
    if (!destination?.is_scrap) throw new QualityOperationsError('A scoped canonical scrap location is required', 'SCRAP_LOCATION_REQUIRED', 409);
    if (!row.source_location_id) throw new QualityOperationsError('Scrap source location is required', 'SCRAP_SOURCE_REQUIRED');
    canonicalAction = 'stock:move:post';
    request = { company_id: row.company_id, reference: `QUALITY-SCRAP/${row.id}`, product_id: checkpoint.product_id,
      uom_id: 'unit', product_qty: Number(row.quantity), location_id: row.source_location_id,
      location_dest_id: row.destination_location_id, lot_id: checkpoint.lot_id, serial_id: checkpoint.serial_id,
      source_document_type: 'quality_scrap', source_document_id: row.id, idempotency_key: `${row.id}:stock` };
  } else if (row.disposition_type === 'retest') {
    canonicalAction = 'quality:inspection:create';
    request = { company_id: row.company_id, inspection_type: 'in_process', source_type: 'work_order', source_id: checkpoint.source_id,
      product_id: checkpoint.product_id, plan_id: checkpoint.plan_id, sample_size: row.quantity, source_disposition_id: row.id };
  } else if (row.disposition_type === 'conditional_acceptance') {
    canonicalAction = 'quality:inspection:release'; request = { inspection_id: checkpoint.inspection_id };
  }
  db.prepare(`UPDATE quality_disposition_requests SET status='approved',approved_by=?,decision_notes=?,canonical_action=?,canonical_request_json=?,updated_at=? WHERE id=?`).run(input.actor, input.decision_notes || null, canonicalAction, JSON.stringify(request), stamp, row.id);
  return { ...mapDisposition(dispositionRow(db, row.id, input)), executionBoundary: canonicalAction ? 'REQUEST_ONLY' : null, inventoryWritten: false, qualityWritten: false };
}

export function requestCanonicalScrap(db, input) {
  const row = dispositionRow(db, input.disposition_id, input); ensureState(row, ['approved'], 'SCRAP_REQUEST_INVALID_STATE');
  if (row.disposition_type !== 'scrap' || row.canonical_action !== 'stock:move:post') throw new QualityOperationsError('Disposition is not an approved scrap request', 'SCRAP_REQUEST_INVALID', 409);
  db.prepare("UPDATE quality_disposition_requests SET status='awaiting_canonical',updated_at=? WHERE id=?").run(now(), row.id);
  return { ...mapDisposition(dispositionRow(db, row.id, input)), executionBoundary: 'REQUEST_ONLY', inventoryWritten: false, financeWritten: false };
}

export function acknowledgeCanonicalScrap(db, input) {
  const row = dispositionRow(db, input.disposition_id, input); ensureState(row, ['awaiting_canonical'], 'SCRAP_ACK_INVALID_STATE');
  const checkpoint = checkpointRow(db, row.checkpoint_id, input);
  const move = db.prepare('SELECT * FROM stock_moves WHERE id=? AND company_id=?').get(input.canonical_result_id, row.company_id);
  if (!move || move.state !== 'done' || move.product_id !== checkpoint.product_id || Number(move.product_qty) !== Number(row.quantity) || move.location_dest_id !== row.destination_location_id) throw new QualityOperationsError('Canonical scrap movement does not match approval', 'CANONICAL_SCRAP_MISMATCH', 409);
  const stamp = now();
  db.prepare("UPDATE quality_disposition_requests SET status='completed',canonical_result_id=?,updated_at=? WHERE id=?").run(move.id, stamp, row.id);
  db.prepare("UPDATE quality_operational_checkpoints SET status='scrap',decided_by=?,updated_at=? WHERE id=?").run(input.actor, stamp, checkpoint.id);
  return mapDisposition(dispositionRow(db, row.id, input));
}

function reworkRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT r.* FROM quality_rework_routes r JOIN quality_disposition_requests d ON d.id=r.disposition_request_id WHERE r.id=? AND r.company_id=? AND d.warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new QualityOperationsError('Rework route is outside warehouse scope', 'REWORK_SCOPE_DENIED', 403);
  return row;
}

export function startRework(db, input) {
  const route = reworkRow(db, input.rework_route_id, input); ensureState(route, ['planned', 'released'], 'REWORK_START_INVALID_STATE');
  db.prepare("UPDATE quality_rework_routes SET status='running',started_at=?,updated_at=? WHERE id=?").run(now(), now(), route.id);
  return { ...db.prepare('SELECT * FROM quality_rework_routes WHERE id=?').get(route.id), canonicalAction: route.canonical_action, executionBoundary: 'REQUEST_ONLY' };
}

export function completeRework(db, input) {
  const route = reworkRow(db, input.rework_route_id, input); ensureState(route, ['running'], 'REWORK_COMPLETE_INVALID_STATE');
  const status = route.retest_required ? 'retest' : 'completed'; const stamp = now();
  db.prepare('UPDATE quality_rework_routes SET status=?,completed_at=?,updated_at=? WHERE id=?').run(status, stamp, stamp, route.id);
  const disposition = db.prepare('SELECT * FROM quality_disposition_requests WHERE id=?').get(route.disposition_request_id);
  db.prepare("UPDATE quality_disposition_requests SET status=?,updated_at=? WHERE id=?").run(route.retest_required ? 'approved' : 'completed', stamp, disposition.id);
  return { ...db.prepare('SELECT * FROM quality_rework_routes WHERE id=?').get(route.id), retestProposal: route.retest_required ? { canonicalAction: 'quality:inspection:create', sourceDispositionId: disposition.id, executionBoundary: 'REQUEST_ONLY' } : null };
}

export function closeDisposition(db, input) {
  const row = dispositionRow(db, input.disposition_id, input); ensureState(row, ['completed', 'approved'], 'QUALITY_DISPOSITION_CLOSE_INVALID_STATE');
  if (row.requested_by === input.actor) throw new QualityOperationsError('Disposition closure requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  db.prepare("UPDATE quality_disposition_requests SET status='closed',approved_by=COALESCE(approved_by,?),updated_at=? WHERE id=?").run(input.actor, now(), row.id);
  const checkpoint = checkpointRow(db, row.checkpoint_id, input);
  db.prepare("UPDATE quality_operational_checkpoints SET status='closed',updated_at=? WHERE id=?").run(now(), checkpoint.id);
  return mapDisposition(dispositionRow(db, row.id, input));
}

export function listOperationalCheckpoints(db, input) {
  const current = scope(input); let sql = 'SELECT * FROM quality_operational_checkpoints WHERE company_id=? AND warehouse_id=?'; const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); } if (input.checkpoint_type) { sql += ' AND checkpoint_type=?'; params.push(input.checkpoint_type); }
  sql += ' ORDER BY created_at DESC'; return db.prepare(sql).all(...params).map(mapCheckpoint);
}
export function listDispositions(db, input) {
  const current = scope(input); let sql = 'SELECT * FROM quality_disposition_requests WHERE company_id=? AND warehouse_id=?'; const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); } if (input.disposition_type) { sql += ' AND disposition_type=?'; params.push(input.disposition_type); }
  sql += ' ORDER BY created_at DESC'; return db.prepare(sql).all(...params).map(mapDisposition);
}
export function listReworkRoutes(db, input) {
  const current = scope(input); return db.prepare(`SELECT r.* FROM quality_rework_routes r JOIN quality_disposition_requests d ON d.id=r.disposition_request_id
    WHERE r.company_id=? AND d.warehouse_id=? AND (?='' OR r.status=?) ORDER BY r.created_at DESC`).all(current.companyId, current.warehouseId, input.status || '', input.status || '').map((row) => ({ ...row, operations: parse(row.operations_json, []), canonicalRequest: parse(row.canonical_request_json) }));
}
