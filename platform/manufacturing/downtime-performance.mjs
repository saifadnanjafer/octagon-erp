// BUILD-09 downtime timeline and evidence-based operational performance metrics.
'use strict';
import crypto from 'node:crypto';

export class DowntimeError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'DowntimeError'; this.code = code; this.statusCode = statusCode; }
}
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const minutes = (start, end) => Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60000);

function scope(input) {
  if (!input.company_id) throw new DowntimeError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new DowntimeError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function sessionRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare(`SELECT s.*,wo.planned_setup_minutes,wo.planned_run_minutes,wo.actual_setup_minutes,wo.actual_run_minutes,
      wo.quantity_to_produce,wo.quantity_completed canonical_completed,wo.quantity_rejected canonical_rejected,
      wc.name_en work_center_name,wc.capacity_per_hour,wc.efficiency_percent
    FROM mfg_shopfloor_sessions s JOIN mfg_work_orders wo ON wo.id=s.work_order_id JOIN work_centers wc ON wc.id=s.work_center_id
    WHERE s.id=? AND s.company_id=? AND s.warehouse_id=?`).get(id, current.companyId, current.warehouseId);
  if (!row) throw new DowntimeError('Shop-floor session is outside warehouse scope', 'SHOPFLOOR_SCOPE_DENIED', 403);
  return row;
}

function downtimeRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM mfg_downtime_events WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new DowntimeError('Downtime event is outside warehouse scope', 'DOWNTIME_SCOPE_DENIED', 403);
  return row;
}

function mapDowntime(row) {
  return { id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id, sessionId: row.session_id,
    workOrderId: row.work_order_id, workCenterId: row.work_center_id, resourceId: row.resource_id,
    assetReference: row.asset_reference, reasonCode: row.reason_code, reasonCategory: row.reason_category,
    planned: Boolean(row.planned), startsAt: row.starts_at, endsAt: row.ends_at,
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes), notes: row.notes,
    recurringIssue: Boolean(row.recurring_issue), maintenanceRequest: parse(row.maintenance_request_json),
    maintenanceRequestId: row.maintenance_request_id, status: row.status, openedBy: row.opened_by,
    closedBy: row.closed_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function startDowntime(db, input) {
  const session = sessionRow(db, input.session_id, input);
  if (!['running', 'paused', 'blocked', 'quality_hold'].includes(session.status)) throw new DowntimeError(`Session is ${session.status}`, 'DOWNTIME_START_INVALID_STATE', 409);
  const categories = ['setup', 'breakdown', 'material', 'quality', 'operator', 'planned', 'other'];
  if (!input.reason_code || !categories.includes(input.reason_category)) throw new DowntimeError('Reason code and valid category are required', 'DOWNTIME_REASON_REQUIRED');
  const open = db.prepare("SELECT id FROM mfg_downtime_events WHERE session_id=? AND status='open'").get(session.id);
  if (open) throw new DowntimeError('Session already has open downtime', 'DOWNTIME_ALREADY_OPEN', 409);
  const prior = db.prepare(`SELECT COUNT(*) count FROM mfg_downtime_events WHERE company_id=? AND work_center_id=? AND reason_code=? AND status IN ('ended','closed','maintenance_proposed')`).get(session.company_id, session.work_center_id, input.reason_code).count;
  const recurring = Number(prior) >= Number(input.recurring_threshold || 2);
  const maintenance = input.maintenance_required ? { action: 'maintenance:request:create', assetReference: input.asset_reference || session.asset_reference, reasonCode: input.reason_code, sourceType: 'mfg_downtime_event', createAuthorized: false } : {};
  const id = uid('down'); const stamp = input.starts_at || now();
  db.prepare(`INSERT INTO mfg_downtime_events(
    id,company_id,warehouse_id,session_id,work_order_id,work_center_id,resource_id,asset_reference,reason_code,reason_category,
    planned,starts_at,notes,recurring_issue,maintenance_request_json,status,opened_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, session.company_id, session.warehouse_id, session.id, session.work_order_id, session.work_center_id,
    session.resource_id, input.asset_reference || session.asset_reference, input.reason_code, input.reason_category,
    input.planned ? 1 : 0, stamp, input.notes || null, recurring ? 1 : 0, JSON.stringify(maintenance),
    input.maintenance_required ? 'maintenance_proposed' : 'open', input.actor, now(), now(),
  );
  db.prepare(`INSERT INTO mfg_shopfloor_events(id,session_id,company_id,event_type,from_status,to_status,reason_code,details_json,actor_id,occurred_at)
    VALUES(?,?,?,'downtime_started',?,?,?,?,?,?)`).run(uid('sfevt'), session.id, session.company_id, session.status, session.status, input.reason_code, JSON.stringify({ downtimeId: id, maintenanceProposed: Boolean(input.maintenance_required) }), input.actor, stamp);
  return { ...mapDowntime(downtimeRow(db, id, input)), maintenanceRequestCreated: false };
}

export function endDowntime(db, input) {
  const row = downtimeRow(db, input.downtime_id, input);
  if (!['open', 'maintenance_proposed'].includes(row.status) || row.ends_at) throw new DowntimeError(`Downtime event is ${row.status}`, 'DOWNTIME_END_INVALID_STATE', 409);
  const ended = input.ends_at || now(); const duration = minutes(row.starts_at, ended);
  if (!(duration >= 0)) throw new DowntimeError('Downtime end must follow its start', 'DOWNTIME_TIME_INVALID');
  const status = row.maintenance_request_id ? 'closed' : row.status === 'maintenance_proposed' ? 'maintenance_proposed' : 'ended';
  db.prepare('UPDATE mfg_downtime_events SET ends_at=?,duration_minutes=?,status=?,closed_by=?,updated_at=? WHERE id=?').run(ended, duration, status, input.actor, now(), row.id);
  db.prepare(`INSERT INTO mfg_shopfloor_events(id,session_id,company_id,event_type,from_status,to_status,quantity,reason_code,details_json,actor_id,occurred_at)
    VALUES(?,?,?,'downtime_ended',?,?,?,?,?,?,?)`).run(uid('sfevt'), row.session_id, row.company_id, null, null, duration, row.reason_code, JSON.stringify({ downtimeId: row.id }), input.actor, ended);
  return mapDowntime(downtimeRow(db, row.id, input));
}

export function acknowledgeMaintenanceRequest(db, input) {
  const row = downtimeRow(db, input.downtime_id, input);
  if (row.status !== 'maintenance_proposed') throw new DowntimeError('No maintenance proposal is pending', 'MAINTENANCE_ACK_INVALID_STATE', 409);
  const request = db.prepare('SELECT id,company_id FROM maintenance_requests WHERE id=? AND company_id=?').get(input.maintenance_request_id, row.company_id);
  if (!request) throw new DowntimeError('Canonical maintenance request does not match downtime scope', 'CANONICAL_MAINTENANCE_MISMATCH', 409);
  db.prepare(`UPDATE mfg_downtime_events SET maintenance_request_id=?,status=CASE WHEN ends_at IS NULL THEN 'open' ELSE 'closed' END,updated_at=? WHERE id=?`).run(request.id, now(), row.id);
  return mapDowntime(downtimeRow(db, row.id, input));
}

export function listDowntimeEvents(db, input) {
  const current = scope(input); let sql = 'SELECT * FROM mfg_downtime_events WHERE company_id=? AND warehouse_id=?'; const params = [current.companyId, current.warehouseId];
  if (input.work_center_id) { sql += ' AND work_center_id=?'; params.push(input.work_center_id); }
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  if (input.reason_category) { sql += ' AND reason_category=?'; params.push(input.reason_category); }
  sql += ' ORDER BY starts_at DESC'; return db.prepare(sql).all(...params).map(mapDowntime);
}

function ratio(numerator, denominator) {
  if (numerator == null || denominator == null || !(Number(denominator) > 0)) return null;
  return Number((Number(numerator) / Number(denominator)).toFixed(6));
}

export function sessionPerformance(db, input) {
  const session = sessionRow(db, input.session_id, input);
  const downtime = db.prepare(`SELECT COALESCE(SUM(duration_minutes),0) total FROM mfg_downtime_events WHERE session_id=? AND duration_minutes IS NOT NULL AND status<>'cancelled'`).get(session.id).total;
  const plannedWindow = session.planned_start_at && session.planned_end_at ? minutes(session.planned_start_at, session.planned_end_at) : null;
  const elapsedWindow = session.actual_start_at ? minutes(session.actual_start_at, session.actual_end_at || now()) : null;
  const runtime = Number(session.actual_run_minutes) > 0 ? Number(session.actual_run_minutes) : elapsedWindow == null ? null : Math.max(0, elapsedWindow - Number(downtime));
  const availability = plannedWindow == null ? null : ratio(Math.max(0, plannedWindow - Number(downtime)), plannedWindow);
  const plannedQuantity = session.planned_quantity == null ? Number(session.quantity_to_produce || 0) || null : Number(session.planned_quantity);
  const produced = Number(session.produced_quantity || session.canonical_completed || 0);
  const rejected = Number(session.rejected_quantity || session.canonical_rejected || 0);
  const idealMinutesPerUnit = plannedQuantity && Number(session.planned_run_minutes) > 0 ? Number(session.planned_run_minutes) / plannedQuantity : null;
  const performance = idealMinutesPerUnit == null || runtime == null ? null : ratio(idealMinutesPerUnit * produced, runtime);
  const qualityRate = produced + rejected > 0 ? ratio(produced, produced + rejected) : null;
  const oee = availability == null || performance == null || qualityRate == null ? null : Number((availability * performance * qualityRate).toFixed(6));
  return { sessionId: session.id, workOrderId: session.work_order_id, workCenterId: session.work_center_id,
    plannedWindowMinutes: plannedWindow, elapsedMinutes: elapsedWindow, setupMinutes: Number(session.actual_setup_minutes) || null,
    runtimeMinutes: runtime, downtimeMinutes: Number(downtime), producedQuantity: produced, rejectedQuantity: rejected,
    speedLossMinutes: runtime != null && idealMinutesPerUnit != null ? Math.max(0, runtime - idealMinutesPerUnit * produced) : null,
    qualityLossQuantity: rejected || null, availability, performance, qualityRate, oee,
    metricsReliable: { availability: availability != null, performance: performance != null, qualityRate: qualityRate != null, oee: oee != null } };
}

export function workCenterPerformance(db, input) {
  const current = scope(input);
  const sessions = db.prepare('SELECT id FROM mfg_shopfloor_sessions WHERE company_id=? AND warehouse_id=? AND (? IS NULL OR work_center_id=?) ORDER BY created_at').all(current.companyId, current.warehouseId, input.work_center_id || null, input.work_center_id || null);
  const rows = sessions.map((row) => sessionPerformance(db, { ...input, session_id: row.id }));
  const known = (field) => rows.map((row) => row[field]).filter((value) => value != null);
  const average = (values) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6)) : null;
  return { sessions: rows.length, availability: average(known('availability')), performance: average(known('performance')),
    qualityRate: average(known('qualityRate')), oee: average(known('oee')), metrics: rows };
}
