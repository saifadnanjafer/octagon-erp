// BUILD-09 wave, batch, cluster, and zone picking orchestration.
'use strict';

import crypto from 'node:crypto';

export class WaveError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message); this.name = 'WaveError'; this.code = code; this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };

function scope(input) {
  if (!input.company_id) throw new WaveError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new WaveError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function assertWarehouse(db, current) {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND company_id=? AND is_active=1').get(current.warehouseId, current.companyId)) throw new WaveError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
}

function rowInScope(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_pick_waves WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new WaveError('Pick wave is outside warehouse scope', 'WAVE_SCOPE_DENIED', 403);
  return row;
}

function taskSummary(db, waveId) {
  return db.prepare(`SELECT p.status,COUNT(*) count FROM wms_pick_wave_tasks wt JOIN wms_pick_tasks_v2 p ON p.id=wt.pick_task_id
    WHERE wt.wave_id=? GROUP BY p.status ORDER BY p.status`).all(waveId).reduce((out, row) => ({ ...out, [row.status]: row.count }), {});
}

function mapWave(db, row) {
  const tasks = db.prepare(`SELECT wt.pick_task_id,wt.zone_id,wt.sequence,wt.consolidated_group,p.status,p.product_id,p.assigned_to
    FROM wms_pick_wave_tasks wt JOIN wms_pick_tasks_v2 p ON p.id=wt.pick_task_id
    WHERE wt.wave_id=? ORDER BY wt.sequence`).all(row.id).map((item) => ({
    pickTaskId: item.pick_task_id, zoneId: item.zone_id, sequence: item.sequence,
    consolidatedGroup: item.consolidated_group, status: item.status,
    productId: item.product_id, assignedTo: item.assigned_to,
  }));
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    name: row.name, waveType: row.wave_type, groupingStrategy: row.grouping_strategy,
    criteria: parse(row.criteria_json, {}), priority: row.priority, cutoffAt: row.cutoff_at,
    stagingLocationId: row.staging_location_id, status: row.status, operatorId: row.operator_id,
    taskCount: row.task_count, completedTaskCount: row.completed_task_count,
    exceptionCount: row.exception_count, createdBy: row.created_by,
    reviewedBy: row.reviewed_by, releasedBy: row.released_by,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    progress: row.task_count ? Number((row.completed_task_count / row.task_count * 100).toFixed(2)) : 0,
    statusSummary: taskSummary(db, row.id), tasks,
  };
}

function ensureState(row, allowed, code) {
  if (!allowed.includes(row.status)) throw new WaveError(`Wave is ${row.status}`, code, 409);
}

export function createWave(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  const types = ['wave', 'batch', 'cluster', 'zone'];
  const groupings = ['carrier', 'route', 'customer', 'zone', 'product', 'manual'];
  if (!input.name || !types.includes(input.wave_type || 'wave') || !groupings.includes(input.grouping_strategy || 'manual')) throw new WaveError('Valid wave name, type and grouping are required', 'INVALID_WAVE');
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM wms_pick_waves WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapWave(db, rowInScope(db, replay.id, input));
  }
  if (input.staging_location_id && !db.prepare(`SELECT 1 FROM wms_location_profiles WHERE location_id=? AND company_id=? AND warehouse_id=? AND retired_at IS NULL`).get(input.staging_location_id, current.companyId, current.warehouseId)) throw new WaveError('Staging location is outside warehouse scope', 'STAGING_SCOPE_DENIED', 403);
  const id = uid('wave'); const stamp = now();
  db.prepare(`INSERT INTO wms_pick_waves(id,company_id,branch_id,warehouse_id,name,wave_type,grouping_strategy,criteria_json,priority,cutoff_at,staging_location_id,status,operator_id,created_by,created_at,updated_at,idempotency_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?)`).run(
    id, current.companyId, input.branch_id || null, current.warehouseId, input.name,
    input.wave_type || 'wave', input.grouping_strategy || 'manual', JSON.stringify(input.criteria || {}),
    Number(input.priority || 100), input.cutoff_at || null, input.staging_location_id || null,
    input.operator_id || null, input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapWave(db, rowInScope(db, id, input));
}

function candidateTasks(db, wave, input) {
  const criteria = { ...parse(wave.criteria_json, {}), ...(input.criteria || {}) };
  let sql = `SELECT p.*,z.id zone_id FROM wms_pick_tasks_v2 p
    LEFT JOIN wms_location_profiles lp ON lp.location_id=p.source_location_id
    LEFT JOIN wms_zones z ON z.id=lp.zone_id
    WHERE p.company_id=? AND p.warehouse_id=? AND p.wave_id IS NULL AND p.status IN ('ready','assigned')`;
  const params = [wave.company_id, wave.warehouse_id];
  if (criteria.picking_type) { sql += ' AND p.picking_type=?'; params.push(criteria.picking_type); }
  if (criteria.product_id) { sql += ' AND p.product_id=?'; params.push(criteria.product_id); }
  if (criteria.zone_id) { sql += ' AND z.id=?'; params.push(criteria.zone_id); }
  if (criteria.assigned_to) { sql += ' AND p.assigned_to=?'; params.push(criteria.assigned_to); }
  if (Array.isArray(criteria.task_ids) && criteria.task_ids.length) {
    const ids = criteria.task_ids.slice(0, 500);
    sql += ` AND p.id IN (${ids.map(() => '?').join(',')})`; params.push(...ids);
  }
  sql += ' ORDER BY p.route_sequence,p.created_at,p.id';
  const limit = Math.min(1000, Math.max(1, Number(criteria.limit || 250)));
  return db.prepare(`${sql} LIMIT ?`).all(...params, limit);
}

export function calculateWave(db, input) {
  const wave = rowInScope(db, input.wave_id, input);
  ensureState(wave, ['draft', 'calculated'], 'WAVE_CALCULATE_INVALID_STATE');
  const candidates = candidateTasks(db, wave, input);
  if (!candidates.length) throw new WaveError('No eligible pick tasks match wave criteria', 'WAVE_NO_ELIGIBLE_TASKS', 409);
  db.prepare('DELETE FROM wms_pick_wave_tasks WHERE wave_id=?').run(wave.id);
  const insert = db.prepare(`INSERT INTO wms_pick_wave_tasks(wave_id,pick_task_id,zone_id,sequence,consolidated_group) VALUES(?,?,?,?,?)`);
  candidates.forEach((task, index) => {
    const group = wave.grouping_strategy === 'zone' ? task.zone_id : wave.grouping_strategy === 'product' ? task.product_id : wave.grouping_strategy === 'route' ? String(task.route_sequence) : 'default';
    insert.run(wave.id, task.id, task.zone_id || null, index + 1, group || 'ungrouped');
  });
  db.prepare(`UPDATE wms_pick_waves SET criteria_json=?,task_count=?,status='calculated',updated_at=? WHERE id=?`).run(
    JSON.stringify({ ...parse(wave.criteria_json, {}), ...(input.criteria || {}) }), candidates.length, now(), wave.id,
  );
  return mapWave(db, rowInScope(db, wave.id, input));
}

export function reviewWave(db, input) {
  const wave = rowInScope(db, input.wave_id, input);
  ensureState(wave, ['calculated'], 'WAVE_REVIEW_INVALID_STATE');
  if (wave.created_by === input.actor) throw new WaveError('Wave review requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  const count = db.prepare('SELECT COUNT(*) count FROM wms_pick_wave_tasks WHERE wave_id=?').get(wave.id).count;
  if (!count) throw new WaveError('Wave has no calculated tasks', 'WAVE_TASKS_REQUIRED', 409);
  db.prepare(`UPDATE wms_pick_waves SET status='reviewed',reviewed_by=?,updated_at=? WHERE id=?`).run(input.actor, now(), wave.id);
  return mapWave(db, rowInScope(db, wave.id, input));
}

export function releaseWave(db, input) {
  const wave = rowInScope(db, input.wave_id, input);
  ensureState(wave, ['reviewed'], 'WAVE_RELEASE_INVALID_STATE');
  if (wave.reviewed_by === input.actor) throw new WaveError('Wave release requires a separate approver', 'MAKER_CHECKER_REQUIRED', 403);
  const picks = db.prepare(`SELECT p.*,wt.sequence FROM wms_pick_wave_tasks wt JOIN wms_pick_tasks_v2 p ON p.id=wt.pick_task_id WHERE wt.wave_id=? ORDER BY wt.sequence`).all(wave.id);
  if (!picks.length) throw new WaveError('Wave has no tasks', 'WAVE_TASKS_REQUIRED', 409);
  const stamp = now();
  const create = db.prepare(`INSERT INTO wms_warehouse_tasks(
    id,company_id,branch_id,warehouse_id,task_type,source_record_type,source_record_id,product_id,lot_id,serial_id,
    source_location_id,destination_location_id,quantity,status,priority,assigned_to,canonical_action,canonical_request_json,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,'pick','pick_task',?,?,?,?,?,?,?,'ready',?,?,'stock:move:post',?,?,?,?) ON CONFLICT(source_record_type,source_record_id,destination_location_id,product_id) DO NOTHING`);
  for (const pick of picks) {
    const request = {
      company_id: pick.company_id, branch_id: pick.branch_id, reference: `WAVE/${wave.id}/PICK/${pick.id}`,
      product_id: pick.product_id, product_qty: pick.requested_quantity,
      location_id: pick.source_location_id, location_dest_id: pick.staging_location_id || wave.staging_location_id || pick.destination_location_id,
      lot_id: pick.lot_id, serial_id: pick.serial_id, source_document_type: pick.picking_type,
      source_document_id: pick.source_document_id, source_line_id: pick.source_line_id,
      idempotency_key: `${pick.id}:canonical-pick`,
    };
    create.run(uid('wtask'), pick.company_id, pick.branch_id, pick.warehouse_id, pick.id,
      pick.product_id, pick.lot_id, pick.serial_id, pick.source_location_id,
      pick.staging_location_id || wave.staging_location_id || pick.destination_location_id,
      pick.requested_quantity, wave.priority + pick.route_sequence,
      wave.operator_id || pick.assigned_to || null, JSON.stringify(request), input.actor, stamp, stamp);
    db.prepare(`UPDATE wms_pick_tasks_v2 SET wave_id=?,staging_location_id=COALESCE(staging_location_id,?),assigned_to=COALESCE(?,assigned_to),status=CASE WHEN status='ready' AND ? IS NOT NULL THEN 'assigned' ELSE status END,updated_at=? WHERE id=?`).run(
      wave.id, wave.staging_location_id, wave.operator_id, wave.operator_id, stamp, pick.id,
    );
  }
  db.prepare(`UPDATE wms_pick_waves SET status='released',released_by=?,updated_at=? WHERE id=?`).run(input.actor, stamp, wave.id);
  return mapWave(db, rowInScope(db, wave.id, input));
}

export function refreshWaveProgress(db, input) {
  const wave = rowInScope(db, input.wave_id, input);
  const counts = db.prepare(`SELECT COUNT(*) task_count,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
    SUM(CASE WHEN status IN ('exception','blocked','short') THEN 1 ELSE 0 END) exceptions
    FROM wms_pick_tasks_v2 WHERE wave_id=?`).get(wave.id);
  const total = Number(counts.task_count || 0); const complete = Number(counts.completed || 0); const exceptions = Number(counts.exceptions || 0);
  let status = wave.status;
  if (['released', 'active', 'partially_completed', 'exception'].includes(status)) {
    if (total && complete === total) status = 'completed';
    else if (complete > 0) status = 'partially_completed';
    else if (exceptions > 0) status = 'exception';
    else status = 'active';
  }
  db.prepare(`UPDATE wms_pick_waves SET task_count=?,completed_task_count=?,exception_count=?,status=?,completed_at=?,updated_at=? WHERE id=?`).run(
    total, complete, exceptions, status, status === 'completed' ? now() : null, now(), wave.id,
  );
  return mapWave(db, rowInScope(db, wave.id, input));
}

export function cancelWave(db, input) {
  const wave = rowInScope(db, input.wave_id, input);
  ensureState(wave, ['draft', 'calculated', 'reviewed', 'released', 'blocked', 'exception'], 'WAVE_CANCEL_INVALID_STATE');
  const canonical = db.prepare(`SELECT COUNT(*) count FROM wms_pick_tasks_v2 WHERE wave_id=? AND status IN ('awaiting_canonical','completed')`).get(wave.id).count;
  if (canonical) throw new WaveError('Wave contains canonical or completed picks', 'WAVE_CANONICAL_STATE_OWNED', 409);
  const stamp = now();
  db.prepare(`UPDATE wms_pick_tasks_v2 SET wave_id=NULL,status=CASE WHEN status='assigned' THEN 'ready' ELSE status END,updated_at=? WHERE wave_id=?`).run(stamp, wave.id);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='cancelled',updated_at=? WHERE source_record_type='pick_task' AND source_record_id IN (SELECT pick_task_id FROM wms_pick_wave_tasks WHERE wave_id=?) AND status NOT IN ('completed','awaiting_canonical')`).run(stamp, wave.id);
  db.prepare(`UPDATE wms_pick_waves SET status='cancelled',updated_at=? WHERE id=?`).run(stamp, wave.id);
  return mapWave(db, rowInScope(db, wave.id, input));
}

export function completeWave(db, input) {
  const refreshed = refreshWaveProgress(db, input);
  if (refreshed.status !== 'completed') throw new WaveError('Every wave pick must complete before wave completion', 'WAVE_TASKS_INCOMPLETE', 409);
  return refreshed;
}

export function listWaves(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  let sql = 'SELECT * FROM wms_pick_waves WHERE company_id=? AND warehouse_id=?';
  const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY priority,cutoff_at,created_at';
  return db.prepare(sql).all(...params).map((row) => mapWave(db, row));
}
