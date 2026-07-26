// Canonical Quality domain.
//
// Quality is a gate, not a report. A failed mandatory inspection blocks the
// downstream lifecycle transition (stock release, production completion,
// delivery, return-to-service) until either the inspection passes or an
// authorised deviation is recorded against it.
//
// Rework and corrective actions create canonical Work Items. Quality owns no
// task table.

import crypto from 'node:crypto';
import { createWorkItem } from '../work_items/work_items.mjs';

export class QualityError extends Error {
  constructor(message, code = 'QUALITY_ERROR', statusCode = 400) {
    super(message);
    this.name = 'QualityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function requireCompany(payload) {
  const companyId = payload?.company_id;
  if (!companyId || companyId === '*') {
    throw new QualityError('an active company scope is required', 'COMPANY_SCOPE_REQUIRED', 403);
  }
  return companyId;
}

function requireActor(payload) {
  const actor = payload?.actor || payload?.actor_id;
  if (!actor) throw new QualityError('an authenticated actor is required', 'ACTOR_REQUIRED', 403);
  return actor;
}

function scoped(db, table, id, companyId, label) {
  if (!id) throw new QualityError(`${label} is required`, 'INPUT_MISSING_FIELD');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new QualityError(`${label} not found: ${id}`, 'RECORD_NOT_FOUND', 404);
  if (row.company_id !== companyId) {
    throw new QualityError(`${label} is outside the active company`, 'COMPANY_SCOPE_VIOLATION', 403);
  }
  return row;
}

function nextReference(db, table, companyId, prefix) {
  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ? AND reference LIKE ?`,
  ).get(companyId, `${prefix}-%`).n;
  return `${prefix}-${String(Number(n) + 1).padStart(6, '0')}`;
}

const TRIGGER_EVENTS = [
  'receipt', 'operation', 'production_completion', 'delivery', 'maintenance',
  'asset_inspection', 'supplier_evaluation', 'customer_complaint',
];

const SUBJECT_TYPES = [
  'production_order', 'work_order', 'stock_move', 'purchase_receipt', 'delivery',
  'asset', 'maintenance_order', 'supplier', 'customer_complaint',
];

export function createQualityPlan(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const name = String(payload.name || '').trim();
  if (!name) throw new QualityError('quality plan name is required', 'INPUT_MISSING_FIELD');
  if (!TRIGGER_EVENTS.includes(payload.trigger_event)) {
    throw new QualityError(`unsupported trigger_event: ${payload.trigger_event}`, 'INPUT_INVALID');
  }
  const code = String(payload.code || '').trim()
    || `QP-${String(db.prepare('SELECT COUNT(*) AS n FROM quality_plans WHERE company_id = ?').get(companyId).n + 1).padStart(4, '0')}`;
  const duplicate = db.prepare('SELECT id FROM quality_plans WHERE company_id = ? AND code = ?').get(companyId, code);
  if (duplicate) throw new QualityError(`quality plan code already exists: ${code}`, 'QUALITY_PLAN_DUPLICATE', 409);

  const id = payload.id || makeId('qp');
  const now = nowIso();
  db.prepare(`
    INSERT INTO quality_plans (
      id, company_id, code, name, trigger_event, product_id, work_center_id,
      is_mandatory, sample_size, is_active, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, code, name, payload.trigger_event, payload.product_id || null,
    payload.work_center_id || null, payload.is_mandatory === false ? 0 : 1,
    Number(payload.sample_size || 1), now, actor,
  );

  const insertPoint = db.prepare(`
    INSERT INTO quality_plan_points (
      id, plan_id, company_id, sequence, characteristic, measurement_type, uom_id,
      target_value, min_value, max_value, expected_text, is_critical, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let sequence = 10;
  for (const point of payload.points || []) {
    const measurementType = point.measurement_type || 'numeric';
    if (!['numeric', 'boolean', 'text', 'visual'].includes(measurementType)) {
      throw new QualityError(`unsupported measurement_type: ${measurementType}`, 'INPUT_INVALID');
    }
    if (measurementType === 'numeric'
      && point.min_value !== undefined && point.max_value !== undefined
      && Number(point.min_value) > Number(point.max_value)) {
      throw new QualityError('min_value cannot exceed max_value', 'INPUT_INVALID');
    }
    insertPoint.run(
      makeId('qpp'), id, companyId, Number(point.sequence || sequence),
      String(point.characteristic || `Characteristic ${sequence / 10}`), measurementType,
      point.uom_id || null,
      point.target_value ?? null, point.min_value ?? null, point.max_value ?? null,
      point.expected_text ?? null, point.is_critical ? 1 : 0, now,
    );
    sequence += 10;
  }
  return getQualityPlan(db, id, companyId);
}

export function getQualityPlan(db, id, companyId) {
  const plan = scoped(db, 'quality_plans', id, companyId, 'quality plan');
  const points = db.prepare('SELECT * FROM quality_plan_points WHERE plan_id = ? ORDER BY sequence, id').all(id);
  return { ...plan, points };
}

export function createInspection(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const plan = scoped(db, 'quality_plans', payload.plan_id, companyId, 'quality plan');
  if (!plan.is_active) throw new QualityError('quality plan is not active', 'QUALITY_PLAN_INACTIVE');
  const subjectType = payload.subject_type || defaultSubjectFor(plan.trigger_event);
  if (!SUBJECT_TYPES.includes(subjectType)) {
    throw new QualityError(`unsupported subject_type: ${subjectType}`, 'INPUT_INVALID');
  }
  if (!payload.subject_id) throw new QualityError('subject_id is required', 'INPUT_MISSING_FIELD');

  const id = payload.id || makeId('qi');
  const reference = payload.reference || nextReference(db, 'quality_inspections', companyId, 'QI');
  const now = nowIso();
  db.prepare(`
    INSERT INTO quality_inspections (
      id, company_id, plan_id, reference, subject_type, subject_id, product_id,
      sample_quantity, state, decided_by, decided_at, deviation_approved_by,
      deviation_reason, blocks_downstream, created_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?, ?, ?)
  `).run(
    id, companyId, plan.id, reference, subjectType, String(payload.subject_id),
    payload.product_id || plan.product_id || null,
    Number(payload.sample_quantity || plan.sample_size || 1),
    payload.blocks_downstream === false ? 0 : (plan.is_mandatory ? 1 : 0),
    now, actor, now,
  );
  return getInspection(db, id, companyId);
}

function defaultSubjectFor(triggerEvent) {
  switch (triggerEvent) {
    case 'operation': return 'work_order';
    case 'production_completion': return 'production_order';
    case 'receipt': return 'purchase_receipt';
    case 'delivery': return 'delivery';
    case 'maintenance': return 'maintenance_order';
    case 'asset_inspection': return 'asset';
    case 'supplier_evaluation': return 'supplier';
    case 'customer_complaint': return 'customer_complaint';
    default: return 'stock_move';
  }
}

/**
 * Record measurements. Each measurement is evaluated against its plan point, so
 * pass/fail is derived from the specification rather than asserted by the
 * person entering the data.
 */
export function recordMeasurements(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const inspection = scoped(db, 'quality_inspections', payload.inspection_id, companyId, 'inspection');
  if (['passed', 'failed', 'conditionally_passed', 'cancelled'].includes(inspection.state)) {
    throw new QualityError('this inspection is already decided', 'QUALITY_STATE_INVALID');
  }
  const measurements = Array.isArray(payload.measurements) ? payload.measurements : [];
  if (!measurements.length) throw new QualityError('at least one measurement is required', 'INPUT_MISSING_FIELD');

  const upsert = db.prepare(`
    INSERT INTO quality_inspection_measurements (
      id, inspection_id, plan_point_id, company_id, numeric_value, text_value,
      passed, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(inspection_id, plan_point_id) DO UPDATE SET
      numeric_value = excluded.numeric_value,
      text_value = excluded.text_value,
      passed = excluded.passed,
      recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at
  `);
  const now = nowIso();
  for (const measurement of measurements) {
    const point = db.prepare(
      'SELECT * FROM quality_plan_points WHERE id = ? AND plan_id = ?',
    ).get(measurement.plan_point_id, inspection.plan_id);
    if (!point) {
      throw new QualityError(
        `plan point ${measurement.plan_point_id} does not belong to this inspection's plan`,
        'QUALITY_POINT_MISMATCH',
      );
    }
    const passed = evaluatePoint(point, measurement);
    upsert.run(
      makeId('qim'), inspection.id, point.id, companyId,
      measurement.numeric_value === undefined ? null : Number(measurement.numeric_value),
      measurement.text_value ?? null, passed ? 1 : 0, actor, now,
    );
  }
  db.prepare("UPDATE quality_inspections SET state = 'in_progress', updated_at = ? WHERE id = ?").run(now, inspection.id);
  return getInspection(db, inspection.id, companyId);
}

function evaluatePoint(point, measurement) {
  if (point.measurement_type === 'numeric') {
    const value = Number(measurement.numeric_value);
    if (!Number.isFinite(value)) return false;
    if (point.min_value !== null && value < Number(point.min_value)) return false;
    if (point.max_value !== null && value > Number(point.max_value)) return false;
    return true;
  }
  if (point.measurement_type === 'boolean') {
    return measurement.numeric_value === 1 || measurement.numeric_value === true
      || String(measurement.text_value).toLowerCase() === 'true';
  }
  if (point.expected_text) {
    return String(measurement.text_value || '').trim().toLowerCase() === String(point.expected_text).trim().toLowerCase();
  }
  return Boolean(measurement.text_value);
}

/**
 * Decide the inspection.
 *
 * `pass` is only available when every plan point has been measured and every
 * critical point passed — a decision cannot outrun its evidence. A failure
 * automatically opens a nonconformance with a rework Work Item.
 */
export function decideInspection(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const inspection = scoped(db, 'quality_inspections', payload.inspection_id, companyId, 'inspection');
  if (['passed', 'failed', 'conditionally_passed', 'cancelled'].includes(inspection.state)) {
    throw new QualityError('this inspection is already decided', 'QUALITY_STATE_INVALID');
  }
  const decision = payload.decision;
  if (!['pass', 'fail', 'conditional', 'cancel'].includes(decision)) {
    throw new QualityError(`unsupported decision: ${decision}`, 'INPUT_INVALID');
  }

  const points = db.prepare('SELECT * FROM quality_plan_points WHERE plan_id = ?').all(inspection.plan_id);
  const measurements = db.prepare(
    'SELECT * FROM quality_inspection_measurements WHERE inspection_id = ?',
  ).all(inspection.id);
  const measuredIds = new Set(measurements.map((row) => row.plan_point_id));
  const failedCritical = measurements.some((row) => {
    if (row.passed) return false;
    const point = points.find((candidate) => candidate.id === row.plan_point_id);
    return Number(point?.is_critical) === 1;
  });
  const anyFailed = measurements.some((row) => !row.passed);

  if (decision === 'pass') {
    const missing = points.filter((point) => !measuredIds.has(point.id));
    if (missing.length) {
      throw new QualityError(
        `${missing.length} plan point(s) have no measurement; the inspection cannot pass`,
        'QUALITY_EVIDENCE_INCOMPLETE',
      );
    }
    if (anyFailed) {
      throw new QualityError(
        'at least one measurement is out of specification; pass is not available',
        'QUALITY_MEASUREMENT_FAILED',
      );
    }
  }
  if (decision === 'conditional' && failedCritical) {
    throw new QualityError(
      'a critical characteristic failed; conditional approval is not available',
      'QUALITY_CRITICAL_FAILURE',
    );
  }

  const stateFor = { pass: 'passed', fail: 'failed', conditional: 'conditionally_passed', cancel: 'cancelled' };
  const now = nowIso();
  db.prepare(`
    UPDATE quality_inspections SET state = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?
  `).run(stateFor[decision], actor, now, now, inspection.id);

  let nonconformance = null;
  if (decision === 'fail') {
    nonconformance = createNonconformance(db, {
      company_id: companyId,
      actor,
      actor_id: actor,
      inspection_id: inspection.id,
      title: `Inspection ${inspection.reference} failed`,
      description: payload.reason || 'Automatically opened by a failed quality inspection',
      severity: failedCritical ? 'critical' : 'high',
      disposition: payload.disposition || 'rework',
      create_work_item: true,
    });
  }
  return { ...getInspection(db, inspection.id, companyId), nonconformance };
}

/**
 * An authorised deviation lets a failed inspection stop blocking downstream
 * work. It never rewrites the inspection result: the failure stays on record
 * with the name of whoever accepted it and why.
 */
export function approveDeviation(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const inspection = scoped(db, 'quality_inspections', payload.inspection_id, companyId, 'inspection');
  if (inspection.state !== 'failed') {
    throw new QualityError('only a failed inspection can carry a deviation approval', 'QUALITY_STATE_INVALID');
  }
  if (inspection.decided_by === actor && !payload.allow_self_approval) {
    throw new QualityError(
      'a deviation cannot be approved by the person who recorded the failure',
      'SEGREGATION_OF_DUTIES',
      403,
    );
  }
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new QualityError('a deviation approval requires a reason', 'INPUT_MISSING_FIELD');
  db.prepare(`
    UPDATE quality_inspections SET deviation_approved_by = ?, deviation_reason = ?, updated_at = ? WHERE id = ?
  `).run(actor, reason, nowIso(), inspection.id);
  return getInspection(db, inspection.id, companyId);
}

export function createNonconformance(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const title = String(payload.title || '').trim();
  if (!title) throw new QualityError('nonconformance title is required', 'INPUT_MISSING_FIELD');
  if (payload.inspection_id) scoped(db, 'quality_inspections', payload.inspection_id, companyId, 'inspection');

  const id = payload.id || makeId('ncr');
  const reference = payload.reference || nextReference(db, 'quality_nonconformances', companyId, 'NCR');
  const now = nowIso();

  let workItemId = null;
  if (payload.create_work_item !== false) {
    const workItem = createWorkItem(db, {
      company_id: companyId,
      title: `${reference} · ${title}`,
      description: payload.description || 'Quality corrective action',
      source_type: 'quality_nonconformance',
      source_id: id,
      status: 'todo',
      stage: 'quality',
      priority: payload.severity === 'critical' ? 'urgent' : 'high',
      qc_ref: id,
      actor,
      created_by: actor,
    });
    workItemId = workItem.id;
  }

  db.prepare(`
    INSERT INTO quality_nonconformances (
      id, company_id, reference, inspection_id, title, description, severity,
      defect_code, root_cause, corrective_action, preventive_action, disposition,
      supplier_party_id, work_item_id, state, opened_at, resolved_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?)
  `).run(
    id, companyId, reference, payload.inspection_id || null, title,
    payload.description || null, payload.severity || 'medium', payload.defect_code || null,
    payload.root_cause || null, payload.corrective_action || null, payload.preventive_action || null,
    payload.disposition || null, payload.supplier_party_id || null, workItemId, now, actor, now,
  );
  return scoped(db, 'quality_nonconformances', id, companyId, 'nonconformance');
}

export function resolveNonconformance(db, payload = {}) {
  const companyId = requireCompany(payload);
  requireActor(payload);
  const ncr = scoped(db, 'quality_nonconformances', payload.nonconformance_id, companyId, 'nonconformance');
  if (['resolved', 'closed'].includes(ncr.state)) {
    throw new QualityError('this nonconformance is already resolved', 'QUALITY_STATE_INVALID');
  }
  if (!payload.root_cause && !ncr.root_cause) {
    throw new QualityError('a root cause is required before resolving a nonconformance', 'INPUT_MISSING_FIELD');
  }
  if (!payload.corrective_action && !ncr.corrective_action) {
    throw new QualityError('a corrective action is required before resolving a nonconformance', 'INPUT_MISSING_FIELD');
  }
  const now = nowIso();
  db.prepare(`
    UPDATE quality_nonconformances SET
      root_cause = COALESCE(?, root_cause),
      corrective_action = COALESCE(?, corrective_action),
      preventive_action = COALESCE(?, preventive_action),
      disposition = COALESCE(?, disposition),
      state = ?, resolved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    payload.root_cause || null, payload.corrective_action || null,
    payload.preventive_action || null, payload.disposition || null,
    payload.close ? 'closed' : 'resolved', now, now, ncr.id,
  );
  return scoped(db, 'quality_nonconformances', ncr.id, companyId, 'nonconformance');
}

export function getInspection(db, id, companyId) {
  const inspection = scoped(db, 'quality_inspections', id, companyId, 'inspection');
  const measurements = db.prepare(`
    SELECT m.*, p.characteristic, p.measurement_type, p.is_critical, p.min_value, p.max_value
    FROM quality_inspection_measurements m
    JOIN quality_plan_points p ON p.id = m.plan_point_id
    WHERE m.inspection_id = ? ORDER BY p.sequence
  `).all(id);
  return { ...inspection, measurements };
}

/**
 * The single question every other domain asks quality: may this subject move on?
 * Used by manufacturing completion, stock release, delivery and maintenance
 * return-to-service.
 */
export function isBlockedByQuality(db, companyId, subjectType, subjectId) {
  const row = db.prepare(`
    SELECT reference, state FROM quality_inspections
    WHERE company_id = ? AND subject_type = ? AND subject_id = ?
      AND blocks_downstream = 1
      AND (state IN ('pending', 'in_progress')
           OR (state = 'failed' AND deviation_approved_by IS NULL))
    LIMIT 1
  `).get(companyId, subjectType, String(subjectId));
  return row ? { blocked: true, inspection_reference: row.reference, inspection_state: row.state } : { blocked: false };
}

export function listInspections(db, { company_id, state = null, subject_type = null, limit = 100 }) {
  let sql = 'SELECT * FROM quality_inspections WHERE company_id = ?';
  const params = [company_id];
  if (state) { sql += ' AND state = ?'; params.push(state); }
  if (subject_type) { sql += ' AND subject_type = ?'; params.push(subject_type); }
  sql += ` ORDER BY created_at DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`;
  return db.prepare(sql).all(...params);
}
