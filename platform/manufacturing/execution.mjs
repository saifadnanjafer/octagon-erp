// Shop-floor execution: work-order state, labour and machine time, and the
// absorption of that time into WIP.
//
// The work order is the manufacturing quantity/cost record. Its canonical Work
// Item is the coordination record — assignment, dependencies, watchers,
// checklists, approvals. Both are updated together, and the Work Item is never
// the authority for a produced quantity.

import {
  ManufacturingError, makeId, nowIso, positive, requireActor, requireCompany,
  round2, scopedRow, assertState, financeContext,
} from './shared.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { requireAccountMapping } from './config.mjs';
import { recordCostFact } from './materials.mjs';
import { updateWorkItem } from '../work_items/work_items.mjs';

const WORK_ITEM_STATE_FOR = {
  ready: 'todo',
  waiting_material: 'blocked',
  waiting_approval: 'waiting_approval',
  scheduled: 'todo',
  in_progress: 'in_progress',
  paused: 'blocked',
  quality_hold: 'blocked',
  completed: 'done',
  cancelled: 'cancelled',
};

function loadWorkOrder(db, workOrderId, companyId) {
  const workOrder = scopedRow(db, 'production_work_orders', workOrderId, companyId, 'work order');
  const order = scopedRow(db, 'production_orders', workOrder.order_id, companyId, 'manufacturing order');
  return { workOrder, order };
}

function appendEvent(db, workOrder, eventType, actor, reason = null) {
  db.prepare(`
    INSERT INTO production_work_order_events (
      id, work_order_id, company_id, event_type, reason, actor_id, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(makeId('woev'), workOrder.id, workOrder.company_id, eventType, reason, actor, nowIso());
}

function setWorkOrderState(db, workOrder, state, { actor, reason = null, extra = {} }) {
  const now = nowIso();
  const assignments = ['state = ?', 'updated_at = ?', 'version = version + 1'];
  const params = [state, now];
  for (const [column, value] of Object.entries(extra)) {
    assignments.splice(assignments.length - 1, 0, `${column} = ?`);
    params.splice(params.length, 0, value);
  }
  params.push(workOrder.id);
  db.prepare(`UPDATE production_work_orders SET ${assignments.join(', ')} WHERE id = ?`).run(...params);

  if (workOrder.work_item_id && WORK_ITEM_STATE_FOR[state]) {
    updateWorkItem(db, workOrder.work_item_id, {
      company_id: workOrder.company_id,
      status: WORK_ITEM_STATE_FOR[state],
    });
  }
  appendEvent(db, workOrder, eventTypeFor(state), actor, reason);
}

function eventTypeFor(state) {
  switch (state) {
    case 'in_progress': return 'start';
    case 'paused': return 'pause';
    case 'completed': return 'complete';
    case 'cancelled': return 'cancel';
    case 'quality_hold': return 'quality_hold';
    case 'waiting_material': return 'block';
    default: return 'unblock';
  }
}

export function startWorkOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const { workOrder, order } = loadWorkOrder(db, payload.work_order_id, companyId);
  assertState(workOrder.state, ['ready', 'scheduled', 'paused'], 'work order');
  if (!['released', 'in_progress', 'partially_completed'].includes(order.state)) {
    throw new ManufacturingError(
      `manufacturing order ${order.reference} is ${order.state}; it cannot run work orders`,
      'MANUFACTURING_STATE_INVALID',
    );
  }

  // Sequence discipline: an earlier operation that is neither completed nor
  // cancelled blocks this one, unless the caller explicitly overlaps them.
  if (!payload.allow_parallel) {
    const blocking = db.prepare(`
      SELECT id, sequence FROM production_work_orders
      WHERE order_id = ? AND sequence < ? AND state NOT IN ('completed', 'cancelled')
      ORDER BY sequence LIMIT 1
    `).get(order.id, workOrder.sequence);
    if (blocking) {
      throw new ManufacturingError(
        `operation ${blocking.sequence} must finish before operation ${workOrder.sequence}`,
        'WORK_ORDER_SEQUENCE_BLOCKED',
      );
    }
  }

  const now = nowIso();
  setWorkOrderState(db, workOrder, 'in_progress', {
    actor,
    extra: {
      actual_start: workOrder.actual_start || now,
      operator_user_id: payload.operator_user_id || workOrder.operator_user_id || actor,
      blocking_reason: null,
    },
  });
  if (order.state === 'released') {
    db.prepare(`
      UPDATE production_orders SET state = 'in_progress', actual_start = COALESCE(actual_start, ?),
        updated_at = ?, version = version + 1 WHERE id = ?
    `).run(now, now, order.id);
  }
  return getWorkOrder(db, workOrder.id, companyId);
}

export function pauseWorkOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const { workOrder } = loadWorkOrder(db, payload.work_order_id, companyId);
  assertState(workOrder.state, ['in_progress'], 'work order');
  setWorkOrderState(db, workOrder, 'paused', {
    actor,
    reason: payload.reason || 'paused',
    extra: { blocking_reason: payload.reason || 'paused' },
  });
  return getWorkOrder(db, workOrder.id, companyId);
}

export function resumeWorkOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const { workOrder } = loadWorkOrder(db, payload.work_order_id, companyId);
  assertState(workOrder.state, ['paused', 'waiting_material', 'quality_hold', 'waiting_approval'], 'work order');
  if (workOrder.state === 'quality_hold' && !payload.quality_released) {
    throw new ManufacturingError(
      'a quality hold is released by a quality decision, not by resuming the work order',
      'QUALITY_HOLD_ACTIVE',
    );
  }
  setWorkOrderState(db, workOrder, 'in_progress', { actor, extra: { blocking_reason: null } });
  return getWorkOrder(db, workOrder.id, companyId);
}

export function completeWorkOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const { workOrder, order } = loadWorkOrder(db, payload.work_order_id, companyId);
  assertState(workOrder.state, ['in_progress', 'paused'], 'work order');

  const blockingInspection = db.prepare(`
    SELECT id FROM quality_inspections
    WHERE company_id = ? AND subject_type = 'work_order' AND subject_id = ?
      AND blocks_downstream = 1
      AND (state IN ('pending', 'in_progress')
           OR (state = 'failed' AND deviation_approved_by IS NULL))
    LIMIT 1
  `).get(companyId, workOrder.id);
  // Throw without writing first. This action runs inside the executor's
  // transaction, so a state change written here would be rolled back by the
  // throw — recording a hold that way would be a lie. `manufacturing:work_order:hold`
  // is the explicit, durable way to park a work order on quality hold.
  if (blockingInspection) {
    throw new ManufacturingError(
      'a mandatory quality inspection is not cleared for this work order',
      'QUALITY_HOLD_ACTIVE',
    );
  }

  const output = Number(payload.output_quantity ?? 0);
  const scrap = Number(payload.scrap_quantity ?? 0);
  const rework = Number(payload.rework_quantity ?? 0);
  const now = nowIso();
  setWorkOrderState(db, workOrder, 'completed', {
    actor,
    extra: {
      actual_end: now,
      output_quantity: Number(workOrder.output_quantity) + Math.max(0, output),
      scrap_quantity: Number(workOrder.scrap_quantity) + Math.max(0, scrap),
      rework_quantity: Number(workOrder.rework_quantity) + Math.max(0, rework),
      blocking_reason: null,
    },
  });

  const remaining = db.prepare(`
    SELECT COUNT(*) AS n FROM production_work_orders
    WHERE order_id = ? AND state NOT IN ('completed', 'cancelled')
  `).get(order.id).n;
  return { ...getWorkOrder(db, workOrder.id, companyId), open_work_orders: Number(remaining) };
}

/**
 * Park a work order on quality hold as an explicit, recorded decision.
 */
export function holdWorkOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const { workOrder } = loadWorkOrder(db, payload.work_order_id, companyId);
  assertState(workOrder.state, ['in_progress', 'paused', 'ready', 'scheduled'], 'work order');
  setWorkOrderState(db, workOrder, 'quality_hold', {
    actor,
    reason: payload.reason || 'quality hold',
    extra: { blocking_reason: payload.reason || 'quality hold' },
  });
  return getWorkOrder(db, workOrder.id, companyId);
}

/**
 * Record labour, machine or overhead time and absorb it into WIP.
 *
 * Rate resolution order: explicit rate → work-centre rate for that entry type →
 * fail closed. A zero-rate entry is allowed (it records duration only) but a
 * missing work centre with no explicit rate is not silently treated as free.
 */
export function recordTimeEntry(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const { workOrder, order } = loadWorkOrder(db, payload.work_order_id, companyId);
  const mapping = requireAccountMapping(db, companyId);
  const durationMinutes = positive(payload.duration_minutes, 'duration_minutes');
  const entryType = payload.entry_type;
  if (!['setup', 'labor', 'machine', 'downtime', 'rework'].includes(entryType)) {
    throw new ManufacturingError(`unsupported entry_type: ${entryType}`, 'INPUT_INVALID');
  }

  const workCenterId = payload.work_center_id || workOrder.work_center_id || null;
  const workCenter = workCenterId
    ? scopedRow(db, 'work_centers', workCenterId, companyId, 'work centre')
    : null;

  let rate = payload.rate_per_hour;
  if (rate === undefined || rate === null) {
    if (!workCenter) {
      throw new ManufacturingError(
        'rate_per_hour is required when the work order has no work centre',
        'MANUFACTURING_RATE_REQUIRED',
      );
    }
    rate = entryType === 'machine'
      ? Number(workCenter.machine_cost_per_hour)
      : Number(workCenter.labor_cost_per_hour);
  }
  rate = Number(rate);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new ManufacturingError('rate_per_hour must not be negative', 'INPUT_INVALID');
  }

  const amount = round2((durationMinutes / 60) * rate);
  // Overhead is absorbed per capitalised entry, at the work-centre rate, for
  // that entry's own duration. A company that does not want machine hours to
  // carry overhead as well as labour hours sets the rate to zero on the work
  // centre or overrides it per entry — the policy is a rate, not a hidden rule.
  const overheadRate = payload.overhead_rate_per_hour !== undefined
    ? Number(payload.overhead_rate_per_hour)
    : Number(workCenter?.overhead_cost_per_hour || 0);
  const overheadAmount = round2((durationMinutes / 60) * (Number.isFinite(overheadRate) ? overheadRate : 0));

  // Downtime is measured, never capitalised into the value of the product.
  const capitalise = entryType !== 'downtime';
  const costType = entryType === 'machine' ? 'machine' : (entryType === 'setup' ? 'setup' : 'labor');

  let financeDocumentId = null;
  if (capitalise && amount > 0) {
    const absorptionAccount = entryType === 'machine'
      ? (mapping.overhead_absorption_account_id || mapping.labor_absorption_account_id)
      : mapping.labor_absorption_account_id;
    if (!absorptionAccount) {
      throw new ManufacturingError(
        'labor_absorption_account_id is not configured for this company',
        'MANUFACTURING_ACCOUNT_MAPPING_MISSING',
      );
    }
    const posted = postSourceFact(db, financeContext(payload), {
      fact_type: 'manufacturing_wip_posting',
      source_id: `${workOrder.id}:${entryType}:${nowIso()}`,
      doc_date: nowIso().slice(0, 10),
      currency: payload.currency || 'IQD',
      lines: [
        { account_id: mapping.wip_account_id, debit: amount, credit: 0, description: `production_${costType}:${order.reference}` },
        { account_id: absorptionAccount, debit: 0, credit: amount, description: `production_${costType}:${order.reference}` },
      ],
    });
    financeDocumentId = posted.document_id;
    recordCostFact(db, {
      companyId, orderId: order.id, workOrderId: workOrder.id,
      costType, direction: 'debit_wip', amount, quantity: durationMinutes / 60,
      financeDocumentId, sourceReference: workOrder.id, projectId: order.project_id || null,
      currency: payload.currency || 'IQD',
    });
  }

  if (capitalise && overheadAmount > 0) {
    if (!mapping.overhead_absorption_account_id) {
      throw new ManufacturingError(
        'overhead_absorption_account_id is not configured for this company',
        'MANUFACTURING_ACCOUNT_MAPPING_MISSING',
      );
    }
    const postedOverhead = postSourceFact(db, financeContext(payload), {
      fact_type: 'manufacturing_wip_posting',
      source_id: `${workOrder.id}:overhead:${nowIso()}`,
      doc_date: nowIso().slice(0, 10),
      currency: payload.currency || 'IQD',
      lines: [
        { account_id: mapping.wip_account_id, debit: overheadAmount, credit: 0, description: `production_overhead:${order.reference}` },
        { account_id: mapping.overhead_absorption_account_id, debit: 0, credit: overheadAmount, description: `production_overhead:${order.reference}` },
      ],
    });
    recordCostFact(db, {
      companyId, orderId: order.id, workOrderId: workOrder.id,
      costType: 'overhead', direction: 'debit_wip', amount: overheadAmount,
      quantity: durationMinutes / 60, financeDocumentId: postedOverhead.document_id,
      sourceReference: workOrder.id, projectId: order.project_id || null,
      currency: payload.currency || 'IQD',
    });
  }

  const id = makeId('mte');
  db.prepare(`
    INSERT INTO production_time_entries (
      id, company_id, order_id, work_order_id, entry_type, work_center_id, operator_ref,
      duration_minutes, rate_per_hour, amount, currency, cost_fact_id, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, order.id, workOrder.id, entryType, workCenterId,
    payload.operator_ref || actor, durationMinutes, rate, capitalise ? amount : 0,
    payload.currency || 'IQD', financeDocumentId, actor, nowIso(),
  );

  if (workOrder.work_item_id) {
    const item = db.prepare('SELECT actual_hours FROM work_items WHERE id = ?').get(workOrder.work_item_id);
    updateWorkItem(db, workOrder.work_item_id, {
      company_id: companyId,
      actual_hours: Number(item?.actual_hours || 0) + (durationMinutes / 60),
    });
  }

  return {
    id,
    work_order_id: workOrder.id,
    entry_type: entryType,
    duration_minutes: durationMinutes,
    amount: capitalise ? amount : 0,
    overhead_amount: capitalise ? overheadAmount : 0,
    finance_document_id: financeDocumentId,
  };
}

export function getWorkOrder(db, id, companyId) {
  const workOrder = scopedRow(db, 'production_work_orders', id, companyId, 'work order');
  const operation = db.prepare('SELECT * FROM production_order_operations WHERE id = ?').get(workOrder.order_operation_id);
  const events = db.prepare(
    'SELECT * FROM production_work_order_events WHERE work_order_id = ? ORDER BY occurred_at, id',
  ).all(id);
  const timeEntries = db.prepare(
    'SELECT * FROM production_time_entries WHERE work_order_id = ? ORDER BY recorded_at, id',
  ).all(id);
  return { ...workOrder, operation, events, time_entries: timeEntries };
}

export function listWorkOrders(db, { company_id, order_id = null, work_center_id = null, state = null }) {
  let sql = 'SELECT * FROM production_work_orders WHERE company_id = ?';
  const params = [company_id];
  if (order_id) { sql += ' AND order_id = ?'; params.push(order_id); }
  if (work_center_id) { sql += ' AND work_center_id = ?'; params.push(work_center_id); }
  if (state) { sql += ' AND state = ?'; params.push(state); }
  sql += ' ORDER BY sequence, created_at';
  return db.prepare(sql).all(...params);
}
