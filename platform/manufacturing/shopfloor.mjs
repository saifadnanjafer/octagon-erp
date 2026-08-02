// BUILD-09 governed shop-floor terminal overlay on canonical manufacturing work orders.
'use strict';
import crypto from 'node:crypto';

export class ShopfloorError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'ShopfloorError'; this.code = code; this.statusCode = statusCode; }
}
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } };

function scope(input) {
  if (!input.company_id) throw new ShopfloorError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new ShopfloorError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function canonicalWorkOrder(db, id, current) {
  const row = db.prepare(`SELECT wo.*,po.warehouse_id,po.state production_state,po.order_number,po.product_id
    FROM mfg_work_orders wo JOIN mfg_production_orders po ON po.id=wo.production_order_id
    WHERE wo.id=? AND wo.company_id=? AND po.company_id=? AND po.warehouse_id=?`).get(id, current.companyId, current.companyId, current.warehouseId);
  if (!row) throw new ShopfloorError('Work order is outside company or warehouse scope', 'WORK_ORDER_SCOPE_DENIED', 403);
  return row;
}

function sessionRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM mfg_shopfloor_sessions WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new ShopfloorError('Shop-floor session is outside warehouse scope', 'SHOPFLOOR_SCOPE_DENIED', 403);
  return row;
}

function mapSession(row) {
  return { id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    productionOrderId: row.production_order_id, workOrderId: row.work_order_id, workCenterId: row.work_center_id,
    resourceId: row.resource_id, operatorId: row.operator_id, assignedBy: row.assigned_by,
    assetReference: row.asset_reference, toolReference: row.tool_reference, shiftCode: row.shift_code,
    handoffFrom: row.handoff_from, handoffTo: row.handoff_to, instructions: row.instructions,
    files: parse(row.files_json, []), notes: row.notes, collaboration: parse(row.collaboration_json),
    plannedQuantity: row.planned_quantity == null ? null : Number(row.planned_quantity),
    producedQuantity: Number(row.produced_quantity), rejectedQuantity: Number(row.rejected_quantity),
    scrapQuantity: Number(row.scrap_quantity), status: row.status,
    qualityCheckpointRequired: Boolean(row.quality_checkpoint_required), canonicalAction: row.canonical_action,
    canonicalRequest: parse(row.canonical_request_json), canonicalResultId: row.canonical_result_id,
    plannedStartAt: row.planned_start_at, plannedEndAt: row.planned_end_at,
    actualStartAt: row.actual_start_at, actualEndAt: row.actual_end_at,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function event(db, session, type, actor, fromStatus, toStatus, details = {}, quantity = null, reasonCode = null) {
  db.prepare(`INSERT INTO mfg_shopfloor_events(id,session_id,company_id,event_type,from_status,to_status,quantity,reason_code,details_json,actor_id,occurred_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(uid('sfevt'), session.id, session.company_id, type, fromStatus, toStatus, quantity, reasonCode, JSON.stringify(details), actor, now());
}

function ensureState(row, allowed, code) {
  if (!allowed.includes(row.status)) throw new ShopfloorError(`Shop-floor session is ${row.status}`, code, 409);
}

export function openShopfloorSession(db, input) {
  const current = scope(input);
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM mfg_shopfloor_sessions WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapSession(sessionRow(db, replay.id, input));
  }
  const workOrder = canonicalWorkOrder(db, input.work_order_id, current);
  if (!['ready', 'paused', 'in_progress', 'on_hold'].includes(workOrder.state)) throw new ShopfloorError(`Canonical work order is ${workOrder.state}`, 'WORK_ORDER_NOT_TERMINAL_READY', 409);
  const id = uid('sfs'); const stamp = now();
  const status = workOrder.state === 'in_progress' ? 'running' : workOrder.state === 'paused' ? 'paused' : workOrder.state === 'on_hold' ? 'quality_hold' : 'ready';
  db.prepare(`INSERT INTO mfg_shopfloor_sessions(
    id,company_id,branch_id,warehouse_id,production_order_id,work_order_id,work_center_id,resource_id,operator_id,assigned_by,
    asset_reference,tool_reference,shift_code,instructions,files_json,notes,collaboration_json,planned_quantity,status,
    quality_checkpoint_required,planned_start_at,planned_end_at,created_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, current.companyId, input.branch_id || null, current.warehouseId, workOrder.production_order_id, workOrder.id,
    workOrder.work_center_id, workOrder.resource_id, input.operator_id || workOrder.operator_id || null,
    input.operator_id ? input.actor : null, input.asset_reference || null, input.tool_reference || null,
    input.shift_code || null, input.instructions ?? '', JSON.stringify(input.files || []), input.notes || '',
    JSON.stringify(input.collaboration || {}), Number(input.planned_quantity ?? workOrder.quantity_to_produce),
    input.operator_id && status === 'ready' ? 'assigned' : status, input.quality_checkpoint_required ? 1 : 0,
    input.planned_start_at || workOrder.planned_start_date, input.planned_end_at || workOrder.planned_end_date,
    input.actor, stamp, stamp, input.idempotency_key || null,
  );
  const row = sessionRow(db, id, input);
  event(db, row, 'session_opened', input.actor, null, row.status, { canonicalWorkOrderState: workOrder.state });
  return mapSession(row);
}

export function assignOperator(db, input) {
  const row = sessionRow(db, input.session_id, input); ensureState(row, ['ready', 'assigned', 'paused'], 'SHOPFLOOR_ASSIGN_INVALID_STATE');
  if (!input.operator_id) throw new ShopfloorError('operator_id is required', 'OPERATOR_REQUIRED');
  const target = row.status === 'ready' ? 'assigned' : row.status;
  db.prepare('UPDATE mfg_shopfloor_sessions SET operator_id=?,assigned_by=?,status=?,shift_code=COALESCE(?,shift_code),updated_at=? WHERE id=?').run(input.operator_id, input.actor, target, input.shift_code || null, now(), row.id);
  event(db, row, 'operator_assigned', input.actor, row.status, target, { operatorId: input.operator_id, shiftCode: input.shift_code || row.shift_code });
  return mapSession(sessionRow(db, row.id, input));
}

function requestTransition(db, input, { allowed, target, action, canonicalState, type }) {
  const row = sessionRow(db, input.session_id, input); ensureState(row, allowed, `${type.toUpperCase()}_INVALID_STATE`);
  if (row.operator_id && input.operator_id && row.operator_id !== input.operator_id) throw new ShopfloorError('Operator is not assigned to this terminal', 'OPERATOR_ASSIGNMENT_DENIED', 403);
  const request = { work_order_id: row.work_order_id, requested_status: target, expected_canonical_state: canonicalState,
    completed_quantity: input.completed_quantity, rejected_quantity: input.rejected_quantity,
    actor: input.actor, idempotency_key: input.idempotency_key || `${row.id}:${type}:${Date.now()}` };
  db.prepare(`UPDATE mfg_shopfloor_sessions SET status='awaiting_canonical',canonical_action=?,canonical_request_json=?,updated_at=? WHERE id=?`).run(action, JSON.stringify(request), now(), row.id);
  event(db, row, `${type}_requested`, input.actor, row.status, 'awaiting_canonical', { requestedStatus: target, canonicalAction: action });
  return { ...mapSession(sessionRow(db, row.id, input)), requestedStatus: target, executionBoundary: 'REQUEST_ONLY', canonicalManufacturingWritten: false };
}

export function requestOperationStart(db, input) { return requestTransition(db, input, { allowed: ['ready', 'assigned'], target: 'running', action: 'manufacturing:work_order:start', canonicalState: 'in_progress', type: 'start' }); }
export function requestOperationPause(db, input) { return requestTransition(db, input, { allowed: ['running'], target: 'paused', action: 'manufacturing:work_order:pause', canonicalState: 'paused', type: 'pause' }); }
export function requestOperationResume(db, input) { return requestTransition(db, input, { allowed: ['paused'], target: 'running', action: 'manufacturing:work_order:resume', canonicalState: 'in_progress', type: 'resume' }); }
export function requestOperationComplete(db, input) {
  const row = sessionRow(db, input.session_id, input);
  if (row.quality_checkpoint_required && !input.quality_released) throw new ShopfloorError('Quality checkpoint must be released before completion', 'QUALITY_CHECKPOINT_REQUIRED', 409);
  return requestTransition(db, { ...input, completed_quantity: input.completed_quantity ?? row.produced_quantity, rejected_quantity: input.rejected_quantity ?? row.rejected_quantity },
    { allowed: ['running', 'paused', 'rework'], target: 'completed', action: 'manufacturing:work_order:complete', canonicalState: 'completed', type: 'complete' });
}

export function acknowledgeOperationTransition(db, input) {
  const row = sessionRow(db, input.session_id, input); ensureState(row, ['awaiting_canonical'], 'SHOPFLOOR_ACK_INVALID_STATE');
  const request = parse(row.canonical_request_json);
  const canonical = canonicalWorkOrder(db, row.work_order_id, scope(input));
  if (canonical.state !== request.expected_canonical_state) throw new ShopfloorError(`Canonical work order remains ${canonical.state}`, 'CANONICAL_WORK_ORDER_MISMATCH', 409);
  const target = request.requested_status;
  const stamp = now();
  db.prepare(`UPDATE mfg_shopfloor_sessions SET status=?,canonical_result_id=?,actual_start_at=CASE WHEN ?='running' THEN COALESCE(actual_start_at,?) ELSE actual_start_at END,
    actual_end_at=CASE WHEN ?='completed' THEN ? ELSE actual_end_at END,updated_at=? WHERE id=?`).run(target, canonical.id, target, stamp, target, stamp, stamp, row.id);
  event(db, row, 'canonical_transition_acknowledged', input.actor, row.status, target, { canonicalState: canonical.state, canonicalResultId: canonical.id });
  return mapSession(sessionRow(db, row.id, input));
}

export function recordOperationOutput(db, input) {
  const row = sessionRow(db, input.session_id, input); ensureState(row, ['running', 'paused', 'rework'], 'SHOPFLOOR_OUTPUT_INVALID_STATE');
  const produced = Number(input.produced_quantity || 0); const rejected = Number(input.rejected_quantity || 0); const scrap = Number(input.scrap_quantity || 0);
  if (produced < 0 || rejected < 0 || scrap < 0 || produced + rejected + scrap <= 0) throw new ShopfloorError('A positive operation output quantity is required', 'OUTPUT_QUANTITY_INVALID');
  const nextProduced = Number(row.produced_quantity) + produced;
  const planned = row.planned_quantity == null ? null : Number(row.planned_quantity);
  if (planned != null && nextProduced + Number(row.rejected_quantity) + rejected > planned && !input.overproduction_authorized) throw new ShopfloorError('Output exceeds planned quantity', 'OVERPRODUCTION_APPROVAL_REQUIRED', 409);
  db.prepare(`UPDATE mfg_shopfloor_sessions SET produced_quantity=produced_quantity+?,rejected_quantity=rejected_quantity+?,scrap_quantity=scrap_quantity+?,notes=CASE WHEN ?='' THEN notes ELSE ? END,updated_at=? WHERE id=?`).run(produced, rejected, scrap, input.notes || '', input.notes || '', now(), row.id);
  event(db, row, 'output_recorded', input.actor, row.status, row.status, { produced, rejected, scrap, evidence: input.evidence || [] }, produced + rejected + scrap);
  return { ...mapSession(sessionRow(db, row.id, input)), canonicalProductionOrderWritten: false };
}

export function handoffOperation(db, input) {
  const row = sessionRow(db, input.session_id, input); ensureState(row, ['assigned', 'paused', 'quality_hold', 'blocked', 'rework'], 'SHOPFLOOR_HANDOFF_INVALID_STATE');
  if (!input.to_operator_id) throw new ShopfloorError('to_operator_id is required', 'HANDOFF_OPERATOR_REQUIRED');
  db.prepare(`UPDATE mfg_shopfloor_sessions SET handoff_from=?,handoff_to=?,operator_id=?,assigned_by=?,shift_code=COALESCE(?,shift_code),notes=CASE WHEN ?='' THEN notes ELSE ? END,status='assigned',updated_at=? WHERE id=?`).run(
    row.operator_id, input.to_operator_id, input.to_operator_id, input.actor, input.shift_code || null, input.notes || '', input.notes || '', now(), row.id);
  event(db, row, 'operation_handoff', input.actor, row.status, 'assigned', { fromOperatorId: row.operator_id, toOperatorId: input.to_operator_id, shiftCode: input.shift_code || null });
  return mapSession(sessionRow(db, row.id, input));
}

export function listShopfloorSessions(db, input) {
  const current = scope(input); let sql = `SELECT s.* FROM mfg_shopfloor_sessions s WHERE s.company_id=? AND s.warehouse_id=?`; const params = [current.companyId, current.warehouseId];
  if (input.work_center_id) { sql += ' AND s.work_center_id=?'; params.push(input.work_center_id); }
  if (input.status) { sql += ' AND s.status=?'; params.push(input.status); }
  if (input.operator_id) { sql += ' AND s.operator_id=?'; params.push(input.operator_id); }
  sql += ' ORDER BY COALESCE(s.planned_start_at,s.created_at),s.created_at';
  return db.prepare(sql).all(...params).map(mapSession);
}

export function shopfloorStatusBoard(db, input) {
  const sessions = listShopfloorSessions(db, input);
  const byStatus = {}; const byWorkCenter = {};
  for (const session of sessions) { byStatus[session.status] = (byStatus[session.status] || 0) + 1; byWorkCenter[session.workCenterId] = (byWorkCenter[session.workCenterId] || 0) + 1; }
  return { total: sessions.length, byStatus, byWorkCenter, blocked: sessions.filter((row) => ['blocked', 'quality_hold'].includes(row.status)), sessions };
}

export function sessionTimeline(db, input) {
  const row = sessionRow(db, input.session_id, input);
  return db.prepare('SELECT * FROM mfg_shopfloor_events WHERE session_id=? AND company_id=? ORDER BY occurred_at,id').all(row.id, row.company_id).map((eventRow) => ({ ...eventRow, details: parse(eventRow.details_json) }));
}
