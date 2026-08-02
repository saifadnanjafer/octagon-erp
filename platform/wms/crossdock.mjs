// BUILD-09 governed inbound-to-outbound matching and canonical cross-dock movement requests.
'use strict';
import crypto from 'node:crypto';

export class CrossDockError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'CrossDockError'; this.code = code; this.statusCode = statusCode; }
}
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
function scope(input) {
  if (!input.company_id) throw new CrossDockError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new CrossDockError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}
function assertWarehouse(db, current) {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND company_id=?').get(current.warehouseId, current.companyId)) throw new CrossDockError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
}
function matchRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_crossdock_matches WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new CrossDockError('Cross-dock match is outside warehouse scope', 'CROSSDOCK_SCOPE_DENIED', 403);
  return row;
}
function mapMatch(row) {
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    inboundAppointmentId: row.inbound_appointment_id, outboundAppointmentId: row.outbound_appointment_id,
    inboundSourceType: row.inbound_source_type, inboundSourceId: row.inbound_source_id,
    outboundSourceType: row.outbound_source_type, outboundSourceId: row.outbound_source_id,
    productId: row.product_id, lotId: row.lot_id, serialId: row.serial_id,
    availableQuantity: Number(row.available_quantity), demandQuantity: Number(row.demand_quantity),
    matchedQuantity: Number(row.matched_quantity), stagingLocationId: row.staging_location_id,
    outboundLocationId: row.outbound_location_id, eligibilityScore: Number(row.eligibility_score),
    status: row.status, exceptionReason: row.exception_reason, canonicalAction: row.canonical_action,
    canonicalRequest: parse(row.canonical_request_json), canonicalResultId: row.canonical_result_id,
    proposedBy: row.proposed_by, approvedBy: row.approved_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function appointment(db, id, type, current) {
  if (!id) return null;
  const row = db.prepare(`SELECT * FROM wms_dock_appointments_v2 WHERE id=? AND company_id=? AND warehouse_id=? AND appointment_type=?`).get(id, current.companyId, current.warehouseId, type);
  if (!row || ['cancelled', 'departed'].includes(row.status)) throw new CrossDockError(`${type} appointment is unavailable`, 'CROSSDOCK_APPOINTMENT_INVALID', 409);
  return row;
}
function location(db, id, current) {
  const row = db.prepare(`SELECT p.*,l.is_active FROM wms_location_profiles p JOIN stock_locations l ON l.id=p.location_id WHERE p.location_id=? AND p.company_id=? AND p.warehouse_id=? AND l.is_active=1`).get(id, current.companyId, current.warehouseId);
  if (!row) throw new CrossDockError('Cross-dock location is outside warehouse scope', 'CROSSDOCK_LOCATION_SCOPE_DENIED', 403);
  return row;
}
function ensureState(row, allowed, code) { if (!allowed.includes(row.status)) throw new CrossDockError(`Cross-dock match is ${row.status}`, code, 409); }

export function evaluateCrossDock(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM wms_crossdock_matches WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapMatch(matchRow(db, replay.id, input));
  }
  const inbound = appointment(db, input.inbound_appointment_id, 'inbound', current);
  const outbound = appointment(db, input.outbound_appointment_id, 'outbound', current);
  const staging = location(db, input.staging_location_id || inbound?.staging_location_id, current);
  const outboundLocation = location(db, input.outbound_location_id, current);
  if (!input.product_id || !db.prepare('SELECT 1 FROM product_variants WHERE id=? AND company_id=?').get(input.product_id, current.companyId)) throw new CrossDockError('Product is outside company scope', 'PRODUCT_SCOPE_DENIED', 403);
  const available = Number(input.available_quantity); const demand = Number(input.demand_quantity);
  if (available < 0 || !(demand > 0)) throw new CrossDockError('Available and demand quantities are invalid', 'INVALID_CROSSDOCK_QUANTITY');
  const matched = Math.min(available, demand, Number(input.maximum_quantity || Number.POSITIVE_INFINITY));
  if (!(matched > 0)) throw new CrossDockError('No quantity is eligible for cross-docking', 'CROSSDOCK_NOT_ELIGIBLE', 409);
  if (input.quality_status && input.quality_status !== 'released') throw new CrossDockError('Quality-controlled stock cannot cross-dock', 'CROSSDOCK_QUALITY_HOLD', 409);
  const timingScore = inbound && outbound ? (inbound.expected_arrival <= outbound.expected_departure ? 40 : 0) : 20;
  const quantityScore = Math.min(50, matched / demand * 50); const score = Number((timingScore + quantityScore + 10).toFixed(2));
  const status = matched < demand || matched < available ? 'partial' : 'candidate';
  const id = uid('xdock'); const stamp = now();
  db.prepare(`INSERT INTO wms_crossdock_matches(
    id,company_id,branch_id,warehouse_id,inbound_appointment_id,outbound_appointment_id,inbound_source_type,inbound_source_id,
    outbound_source_type,outbound_source_id,product_id,lot_id,serial_id,available_quantity,demand_quantity,matched_quantity,
    staging_location_id,outbound_location_id,eligibility_score,status,proposed_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, current.companyId, input.branch_id || null, current.warehouseId, inbound?.id || null, outbound?.id || null,
    input.inbound_source_type, input.inbound_source_id, input.outbound_source_type, input.outbound_source_id,
    input.product_id, input.lot_id || null, input.serial_id || null, available, demand, matched,
    staging.location_id, outboundLocation.location_id, score, status, input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapMatch(matchRow(db, id, input));
}

export function approveCrossDock(db, input) {
  const row = matchRow(db, input.match_id, input); ensureState(row, ['candidate', 'partial'], 'CROSSDOCK_APPROVE_INVALID_STATE');
  if (row.proposed_by === input.actor) throw new CrossDockError('Cross-dock approval requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  const stamp = now();
  const request = { company_id: row.company_id, branch_id: row.branch_id, reference: `CROSSDOCK/${row.id}`, product_id: row.product_id, product_qty: Number(row.matched_quantity), location_id: row.staging_location_id, location_dest_id: row.outbound_location_id, lot_id: row.lot_id, serial_id: row.serial_id, source_document_type: 'wms_crossdock', source_document_id: row.id, idempotency_key: `${row.id}:canonical` };
  db.prepare(`UPDATE wms_crossdock_matches SET status='approved',approved_by=?,canonical_request_json=?,updated_at=? WHERE id=?`).run(input.actor, JSON.stringify(request), stamp, row.id);
  db.prepare(`INSERT INTO wms_warehouse_tasks(
    id,company_id,branch_id,warehouse_id,task_type,source_record_type,source_record_id,product_id,lot_id,serial_id,source_location_id,destination_location_id,quantity,status,priority,assigned_to,canonical_action,canonical_request_json,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,'cross_dock','crossdock_match',?,?,?,?,?,?,?,'ready',?,?,'stock:move:post',?,?,?,?)`).run(
    uid('wtask'), row.company_id, row.branch_id, row.warehouse_id, row.id, row.product_id, row.lot_id, row.serial_id,
    row.staging_location_id, row.outbound_location_id, row.matched_quantity, Number(input.priority || 50), input.assigned_to || null,
    JSON.stringify(request), input.actor, stamp, stamp,
  );
  db.prepare(`UPDATE wms_crossdock_matches SET status='task_created',updated_at=? WHERE id=?`).run(stamp, row.id);
  return { ...mapMatch(matchRow(db, row.id, input)), taskGenerated: true, inventoryWritten: false };
}

export function requestCrossDockPost(db, input) {
  const row = matchRow(db, input.match_id, input); ensureState(row, ['task_created'], 'CROSSDOCK_POST_INVALID_STATE');
  const task = db.prepare(`SELECT * FROM wms_warehouse_tasks WHERE source_record_type='crossdock_match' AND source_record_id=?`).get(row.id);
  if (!task) throw new CrossDockError('Cross-dock warehouse task is missing', 'CROSSDOCK_TASK_MISSING', 409);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='awaiting_canonical',updated_at=? WHERE id=?`).run(now(), task.id);
  db.prepare(`UPDATE wms_crossdock_matches SET status='awaiting_canonical',updated_at=? WHERE id=?`).run(now(), row.id);
  return { ...mapMatch(matchRow(db, row.id, input)), executionBoundary: 'REQUEST_ONLY', inventoryWritten: false };
}

export function acknowledgeCrossDockPost(db, input) {
  const row = matchRow(db, input.match_id, input); ensureState(row, ['awaiting_canonical'], 'CROSSDOCK_ACK_INVALID_STATE');
  const move = db.prepare('SELECT id,state,product_id,product_qty FROM stock_moves WHERE id=? AND company_id=?').get(input.canonical_result_id, row.company_id);
  if (!move || move.state !== 'done' || move.product_id !== row.product_id || Number(move.product_qty) !== Number(row.matched_quantity)) throw new CrossDockError('Canonical movement does not match cross-dock allocation', 'CANONICAL_CROSSDOCK_MISMATCH', 409);
  const stamp = now();
  db.prepare(`UPDATE wms_crossdock_matches SET status='completed',canonical_result_id=?,updated_at=? WHERE id=?`).run(move.id, stamp, row.id);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='completed',canonical_result_id=?,updated_at=? WHERE source_record_type='crossdock_match' AND source_record_id=?`).run(move.id, stamp, row.id);
  return mapMatch(matchRow(db, row.id, input));
}

export function cancelCrossDock(db, input) {
  const row = matchRow(db, input.match_id, input); ensureState(row, ['candidate', 'partial', 'approved', 'task_created', 'exception'], 'CROSSDOCK_CANCEL_INVALID_STATE');
  db.prepare(`UPDATE wms_crossdock_matches SET status='cancelled',exception_reason=?,updated_at=? WHERE id=?`).run(input.reason || 'Cancelled', now(), row.id);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='cancelled',updated_at=? WHERE source_record_type='crossdock_match' AND source_record_id=? AND status NOT IN ('completed','awaiting_canonical')`).run(now(), row.id);
  return mapMatch(matchRow(db, row.id, input));
}

export function listCrossDockMatches(db, input) {
  const current = scope(input); assertWarehouse(db, current); let sql = 'SELECT * FROM wms_crossdock_matches WHERE company_id=? AND warehouse_id=?'; const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); } sql += ' ORDER BY eligibility_score DESC,created_at'; return db.prepare(sql).all(...params).map(mapMatch);
}
