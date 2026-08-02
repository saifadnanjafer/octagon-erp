// BUILD-09 blind/directed cycle counts with canonical adjustment request boundary.
'use strict';

import crypto from 'node:crypto';

export class CycleCountingError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message); this.name = 'CycleCountingError'; this.code = code; this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
const round = (value) => Number(Number(value || 0).toFixed(4));

function scope(input) {
  if (!input.company_id) throw new CycleCountingError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new CycleCountingError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function assertWarehouse(db, current) {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND company_id=? AND is_active=1').get(current.warehouseId, current.companyId)) throw new CycleCountingError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
}

function planRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_count_plans_v2 WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new CycleCountingError('Count plan is outside warehouse scope', 'COUNT_PLAN_SCOPE_DENIED', 403);
  return row;
}

function sessionRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_count_sessions_v2 WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new CycleCountingError('Count session is outside warehouse scope', 'COUNT_SESSION_SCOPE_DENIED', 403);
  return row;
}

function mapPlan(row) {
  return {
    id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id, name: row.name,
    countScope: row.count_scope, zoneId: row.zone_id, locationId: row.location_id, productId: row.product_id,
    abcClass: row.abc_class, frequencyDays: row.frequency_days, toleranceQuantity: Number(row.tolerance_quantity),
    tolerancePercent: Number(row.tolerance_percent), blindCount: !!row.blind_count,
    directedCount: !!row.directed_count, active: !!row.is_active, nextCountDate: row.next_count_date,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapSession(db, row, includeTheoretical = true) {
  const lines = db.prepare('SELECT * FROM wms_count_lines_v2 WHERE session_id=? ORDER BY location_id,product_id,id').all(row.id).map((line) => ({
    id: line.id, locationId: line.location_id, productId: line.product_id,
    lotId: line.lot_id, serialId: line.serial_id,
    theoreticalQuantity: includeTheoretical ? Number(line.theoretical_quantity) : undefined,
    countedQuantity: line.counted_quantity == null ? null : Number(line.counted_quantity),
    varianceQuantity: line.variance_quantity == null ? null : Number(line.variance_quantity),
    variancePercent: line.variance_percent == null ? null : Number(line.variance_percent),
    toleranceExceeded: !!line.tolerance_exceeded, discrepancyReason: line.discrepancy_reason,
    countedBy: line.counted_by, countedAt: line.counted_at, status: line.status,
  }));
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    planId: row.plan_id, sessionType: row.session_type, status: row.status, assignedTo: row.assigned_to,
    blindCount: !!row.blind_count, snapshotAt: row.snapshot_at, freezeReference: row.freeze_reference,
    recountOfId: row.recount_of_id, varianceCount: row.variance_count,
    adjustmentRequest: parse(row.adjustment_request_json, {}), canonicalResultIds: parse(row.canonical_result_ids_json, []),
    createdBy: row.created_by, approvedBy: row.approved_by,
    createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at, lines,
  };
}

function ensureState(row, allowed, code) {
  if (!allowed.includes(row.status)) throw new CycleCountingError(`Count session is ${row.status}`, code, 409);
}

function assertSelector(db, input, current) {
  if (input.location_id && !db.prepare('SELECT 1 FROM stock_locations WHERE id=? AND company_id=? AND warehouse_id=?').get(input.location_id, current.companyId, current.warehouseId)) throw new CycleCountingError('Count location is outside warehouse scope', 'COUNT_LOCATION_SCOPE_DENIED', 403);
  if (input.zone_id && !db.prepare('SELECT 1 FROM wms_zones WHERE id=? AND company_id=? AND warehouse_id=?').get(input.zone_id, current.companyId, current.warehouseId)) throw new CycleCountingError('Count zone is outside warehouse scope', 'COUNT_ZONE_SCOPE_DENIED', 403);
  if (input.product_id && !db.prepare('SELECT 1 FROM product_variants WHERE id=? AND company_id=?').get(input.product_id, current.companyId)) throw new CycleCountingError('Count product is outside company scope', 'COUNT_PRODUCT_SCOPE_DENIED', 403);
}

export function createCountPlan(db, input) {
  const current = scope(input); assertWarehouse(db, current); assertSelector(db, input, current);
  const scopes = ['location', 'product', 'zone', 'abc', 'ad_hoc'];
  if (!input.name || !scopes.includes(input.count_scope)) throw new CycleCountingError('Valid count plan name and scope are required', 'INVALID_COUNT_PLAN');
  if (input.count_scope === 'location' && !input.location_id) throw new CycleCountingError('Location plan requires a location', 'COUNT_LOCATION_REQUIRED');
  if (input.count_scope === 'product' && !input.product_id) throw new CycleCountingError('Product plan requires a product', 'COUNT_PRODUCT_REQUIRED');
  if (input.count_scope === 'zone' && !input.zone_id) throw new CycleCountingError('Zone plan requires a zone', 'COUNT_ZONE_REQUIRED');
  if (input.count_scope === 'abc' && !['A', 'B', 'C'].includes(input.abc_class)) throw new CycleCountingError('ABC plan requires class A, B, or C', 'COUNT_ABC_REQUIRED');
  const id = uid('cntplan'); const stamp = now();
  db.prepare(`INSERT INTO wms_count_plans_v2(
    id,company_id,warehouse_id,name,count_scope,zone_id,location_id,product_id,abc_class,frequency_days,
    tolerance_quantity,tolerance_percent,blind_count,directed_count,is_active,next_count_date,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(
    id, current.companyId, current.warehouseId, input.name, input.count_scope,
    input.zone_id || null, input.location_id || null, input.product_id || null, input.abc_class || null,
    Number(input.frequency_days || 30), Number(input.tolerance_quantity || 0), Number(input.tolerance_percent || 0),
    input.blind_count === false ? 0 : 1, input.directed_count === false ? 0 : 1,
    input.next_count_date || null, input.actor, stamp, stamp,
  );
  return mapPlan(planRow(db, id, input));
}

function snapshotCandidates(db, plan, input) {
  let sql = `SELECT q.location_id,q.product_id,SUM(q.quantity) theoretical_quantity
    FROM stock_quants q JOIN stock_locations l ON l.id=q.location_id
    LEFT JOIN wms_location_profiles lp ON lp.location_id=q.location_id
    WHERE q.company_id=? AND l.warehouse_id=?`;
  const params = [plan.company_id, plan.warehouse_id];
  if (plan.location_id) { sql += ' AND q.location_id=?'; params.push(plan.location_id); }
  if (plan.product_id) { sql += ' AND q.product_id=?'; params.push(plan.product_id); }
  if (plan.zone_id) { sql += ' AND lp.zone_id=?'; params.push(plan.zone_id); }
  if (input.location_id) { sql += ' AND q.location_id=?'; params.push(input.location_id); }
  if (input.product_id) { sql += ' AND q.product_id=?'; params.push(input.product_id); }
  sql += ' GROUP BY q.location_id,q.product_id ORDER BY q.location_id,q.product_id';
  return db.prepare(sql).all(...params);
}

export function startCountSession(db, input) {
  const current = scope(input); assertWarehouse(db, current); assertSelector(db, input, current);
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM wms_count_sessions_v2 WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapSession(db, sessionRow(db, replay.id, input), !replay.blind_count || replay.status !== 'counting');
  }
  let plan;
  if (input.plan_id) plan = planRow(db, input.plan_id, input);
  else plan = { company_id: current.companyId, warehouse_id: current.warehouseId, location_id: input.location_id || null, product_id: input.product_id || null, zone_id: input.zone_id || null, blind_count: input.blind_count === false ? 0 : 1 };
  const candidates = snapshotCandidates(db, plan, input);
  if (!candidates.length && !Array.isArray(input.empty_targets)) throw new CycleCountingError('No count targets match the plan', 'COUNT_TARGETS_REQUIRED', 409);
  const id = uid('cntsession'); const stamp = now();
  db.prepare(`INSERT INTO wms_count_sessions_v2(
    id,company_id,branch_id,warehouse_id,plan_id,session_type,status,assigned_to,blind_count,snapshot_at,
    freeze_reference,recount_of_id,created_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?, 'assigned',?,?,?,?,?,?,?,?,?)`).run(
    id, current.companyId, input.branch_id || null, current.warehouseId, input.plan_id || null,
    input.session_type || (input.plan_id ? 'planned' : 'ad_hoc'), input.assigned_to || input.actor,
    Number(plan.blind_count ?? 1), stamp, `SNAPSHOT/${id}`, input.recount_of_id || null,
    input.actor, stamp, stamp, input.idempotency_key || null,
  );
  const insert = db.prepare(`INSERT INTO wms_count_lines_v2(id,session_id,location_id,product_id,theoretical_quantity,status) VALUES(?,?,?,?,?,'pending')`);
  candidates.forEach((target) => insert.run(uid('cntline'), id, target.location_id, target.product_id, Number(target.theoretical_quantity || 0)));
  for (const target of input.empty_targets || []) {
    assertSelector(db, target, current);
    insert.run(uid('cntline'), id, target.location_id, target.product_id, 0);
  }
  db.prepare(`UPDATE wms_count_sessions_v2 SET status='counting',updated_at=? WHERE id=?`).run(stamp, id);
  return mapSession(db, sessionRow(db, id, input), !Number(plan.blind_count));
}

export function recordCountLine(db, input) {
  const session = sessionRow(db, input.session_id, input);
  ensureState(session, ['counting', 'recount'], 'COUNT_RECORD_INVALID_STATE');
  if (session.assigned_to && session.assigned_to !== input.actor) throw new CycleCountingError('Count is assigned to another operator', 'COUNT_ASSIGNMENT_DENIED', 403);
  const line = db.prepare('SELECT * FROM wms_count_lines_v2 WHERE id=? AND session_id=?').get(input.line_id, session.id);
  if (!line) throw new CycleCountingError('Count line is outside session scope', 'COUNT_LINE_SCOPE_DENIED', 403);
  const counted = Number(input.counted_quantity);
  if (counted < 0 || !Number.isFinite(counted)) throw new CycleCountingError('Counted quantity cannot be negative', 'INVALID_COUNTED_QUANTITY');
  db.prepare(`UPDATE wms_count_lines_v2 SET counted_quantity=?,discrepancy_reason=?,counted_by=?,counted_at=?,status='counted' WHERE id=?`).run(
    counted, input.discrepancy_reason || null, input.actor, now(), line.id,
  );
  return mapSession(db, sessionRow(db, session.id, input), !session.blind_count);
}

export function submitCount(db, input) {
  const session = sessionRow(db, input.session_id, input);
  ensureState(session, ['counting', 'recount'], 'COUNT_SUBMIT_INVALID_STATE');
  const pending = db.prepare(`SELECT COUNT(*) count FROM wms_count_lines_v2 WHERE session_id=? AND counted_quantity IS NULL`).get(session.id).count;
  if (pending) throw new CycleCountingError('Every count line must be recorded', 'COUNT_LINES_PENDING', 409);
  const plan = session.plan_id ? planRow(db, session.plan_id, input) : { tolerance_quantity: Number(input.tolerance_quantity || 0), tolerance_percent: Number(input.tolerance_percent || 0) };
  const lines = db.prepare('SELECT * FROM wms_count_lines_v2 WHERE session_id=?').all(session.id);
  let varianceCount = 0;
  const update = db.prepare(`UPDATE wms_count_lines_v2 SET variance_quantity=?,variance_percent=?,tolerance_exceeded=?,status=?,discrepancy_reason=COALESCE(discrepancy_reason,?) WHERE id=?`);
  for (const line of lines) {
    const variance = round(Number(line.counted_quantity) - Number(line.theoretical_quantity));
    const percent = line.theoretical_quantity ? round(Math.abs(variance) / Math.abs(Number(line.theoretical_quantity)) * 100) : variance ? 100 : 0;
    const exceeded = Math.abs(variance) > Number(plan.tolerance_quantity || 0) || percent > Number(plan.tolerance_percent || 0);
    if (variance) varianceCount += 1;
    update.run(variance, percent, exceeded ? 1 : 0, variance ? 'variance' : 'approved', variance ? 'COUNT_VARIANCE' : null, line.id);
  }
  const status = varianceCount ? 'variance_review' : 'approved';
  db.prepare(`UPDATE wms_count_sessions_v2 SET status=?,variance_count=?,updated_at=? WHERE id=?`).run(status, varianceCount, now(), session.id);
  return mapSession(db, sessionRow(db, session.id, input), true);
}

export function requestRecount(db, input) {
  const session = sessionRow(db, input.session_id, input);
  ensureState(session, ['variance_review'], 'COUNT_RECOUNT_INVALID_STATE');
  if (session.created_by === input.actor) throw new CycleCountingError('Recount requires supervisor review', 'MAKER_CHECKER_REQUIRED', 403);
  const targets = db.prepare(`SELECT location_id,product_id FROM wms_count_lines_v2 WHERE session_id=? AND variance_quantity<>0`).all(session.id);
  db.prepare(`UPDATE wms_count_sessions_v2 SET status='recount',approved_by=?,updated_at=? WHERE id=?`).run(input.actor, now(), session.id);
  return startCountSession(db, {
    ...input, plan_id: session.plan_id, session_type: 'recount', recount_of_id: session.id,
    idempotency_key: input.idempotency_key || `${session.id}:recount`,
    location_id: targets.length === 1 ? targets[0].location_id : undefined,
    product_id: targets.length === 1 ? targets[0].product_id : undefined,
  });
}

export function approveCountVariance(db, input) {
  const session = sessionRow(db, input.session_id, input);
  ensureState(session, ['variance_review', 'submitted'], 'COUNT_APPROVE_INVALID_STATE');
  if (session.created_by === input.actor || db.prepare(`SELECT 1 FROM wms_count_lines_v2 WHERE session_id=? AND counted_by=? LIMIT 1`).get(session.id, input.actor)) throw new CycleCountingError('Variance approval requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  const unexplained = db.prepare(`SELECT COUNT(*) count FROM wms_count_lines_v2 WHERE session_id=? AND variance_quantity<>0 AND (discrepancy_reason IS NULL OR discrepancy_reason='COUNT_VARIANCE')`).get(session.id).count;
  if (unexplained && !input.reason) throw new CycleCountingError('Variance approval reason is required', 'COUNT_VARIANCE_REASON_REQUIRED');
  if (input.reason) db.prepare(`UPDATE wms_count_lines_v2 SET discrepancy_reason=? WHERE session_id=? AND variance_quantity<>0`).run(input.reason, session.id);
  db.prepare(`UPDATE wms_count_lines_v2 SET status='approved' WHERE session_id=? AND status='variance'`).run(session.id);
  db.prepare(`UPDATE wms_count_sessions_v2 SET status='approved',approved_by=?,updated_at=? WHERE id=?`).run(input.actor, now(), session.id);
  return mapSession(db, sessionRow(db, session.id, input), true);
}

export function requestCountAdjustment(db, input) {
  const session = sessionRow(db, input.session_id, input);
  ensureState(session, ['approved'], 'COUNT_ADJUST_INVALID_STATE');
  if (session.variance_count === 0) {
    const stamp = now();
    db.prepare(`UPDATE wms_count_sessions_v2 SET status='closed',closed_at=?,updated_at=? WHERE id=?`).run(stamp, stamp, session.id);
    return { ...mapSession(db, sessionRow(db, session.id, input), true), inventoryWritten: false, adjustmentRequired: false };
  }
  const lines = db.prepare(`SELECT * FROM wms_count_lines_v2 WHERE session_id=? AND variance_quantity<>0`).all(session.id);
  const requests = lines.map((line) => ({
    action: 'stock:move:post', company_id: session.company_id, branch_id: session.branch_id,
    reference: `COUNT/${session.id}`, product_id: line.product_id,
    product_qty: Math.abs(Number(line.variance_quantity)), count_location_id: line.location_id,
    direction: Number(line.variance_quantity) > 0 ? 'gain' : 'loss',
    source_document_type: 'wms_cycle_count', source_document_id: session.id,
    source_line_id: line.id, idempotency_key: `${session.id}:${line.id}:adjustment`,
  }));
  const payload = { requests, executionBoundary: 'REQUEST_ONLY', inventoryWritten: false };
  db.prepare(`UPDATE wms_count_sessions_v2 SET status='awaiting_canonical',adjustment_request_json=?,updated_at=? WHERE id=?`).run(JSON.stringify(payload), now(), session.id);
  db.prepare(`UPDATE wms_count_lines_v2 SET status='adjustment_requested' WHERE session_id=? AND variance_quantity<>0`).run(session.id);
  return { ...mapSession(db, sessionRow(db, session.id, input), true), ...payload };
}

export function acknowledgeCountAdjustment(db, input) {
  const session = sessionRow(db, input.session_id, input);
  ensureState(session, ['awaiting_canonical'], 'COUNT_ACK_INVALID_STATE');
  const ids = Array.isArray(input.canonical_result_ids) ? [...new Set(input.canonical_result_ids)] : [];
  const expected = db.prepare(`SELECT COUNT(*) count FROM wms_count_lines_v2 WHERE session_id=? AND variance_quantity<>0`).get(session.id).count;
  if (ids.length !== expected) throw new CycleCountingError('Every variance requires a canonical result', 'CANONICAL_ADJUSTMENT_RESULTS_INCOMPLETE', 409);
  for (const id of ids) {
    const move = db.prepare('SELECT id,state FROM stock_moves WHERE id=? AND company_id=?').get(id, session.company_id);
    if (!move || move.state !== 'done') throw new CycleCountingError('Canonical adjustment is not posted', 'CANONICAL_ADJUSTMENT_NOT_POSTED', 409);
  }
  const stamp = now();
  db.prepare(`UPDATE wms_count_sessions_v2 SET status='closed',canonical_result_ids_json=?,closed_at=?,updated_at=? WHERE id=?`).run(JSON.stringify(ids), stamp, stamp, session.id);
  db.prepare(`UPDATE wms_count_lines_v2 SET status='closed' WHERE session_id=?`).run(session.id);
  return mapSession(db, sessionRow(db, session.id, input), true);
}

export function listCountPlans(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  return db.prepare('SELECT * FROM wms_count_plans_v2 WHERE company_id=? AND warehouse_id=? ORDER BY next_count_date,name').all(current.companyId, current.warehouseId).map(mapPlan);
}

export function listCountSessions(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  let sql = 'SELECT * FROM wms_count_sessions_v2 WHERE company_id=? AND warehouse_id=?'; const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params).map((row) => mapSession(db, row, true));
}
