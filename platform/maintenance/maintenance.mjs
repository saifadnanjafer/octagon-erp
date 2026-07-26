// Canonical Maintenance engine.
//
// This is the ONLY maintenance engine in Octagon. Asset servicing, work-centre
// servicing and fleet servicing all run through it — fleet does not get its own.
//
//   request → order(draft) → approved → scheduled → in_progress
//           → waiting_parts / quality_hold → completed → closed
//
// What it delegates:
//   spare parts   → Phase 04 stock engine (`executeStockOperation`)
//   external work → Phase 04 procurement (a commitment + requisition)
//   cost          → Phase 03 finance through `project_cost_posting`
//   coordination  → Phase 04 Work Items
//   inspection    → Phase 05 Quality
//   equipment     → Phase 05 Assets / Fleet
//
// Preventive generation is idempotent by construction: every generated order
// carries a deterministic `generation_key` protected by a unique index, so
// running the generator twice for the same due window cannot create a duplicate.

import {
  createDomainError, domainGuards, makeId, nowIso, today, round2, round6,
} from '../kernel/domain/kit.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { createWorkItem, updateWorkItem } from '../work_items/work_items.mjs';
import { isBlockedByQuality, createInspection } from '../quality/quality.mjs';
import { setMaintenanceState, latestMeter } from '../assets/assets.mjs';

export const MaintenanceError = createDomainError('MaintenanceError', 'MAINTENANCE_ERROR');
const g = domainGuards(MaintenanceError);

const WORK_ITEM_STATE_FOR = {
  draft: 'todo',
  approved: 'todo',
  scheduled: 'todo',
  in_progress: 'in_progress',
  waiting_parts: 'blocked',
  quality_hold: 'blocked',
  completed: 'done',
  closed: 'done',
  cancelled: 'cancelled',
};

const EXECUTABLE_STATES = ['approved', 'scheduled', 'in_progress', 'waiting_parts'];

// --------------------------------------------------------------------------
// Teams and requests
// --------------------------------------------------------------------------

export function createTeam(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  g.requireActor(payload);
  const code = g.requireText(payload.code, 'team code');
  const id = payload.id || makeId('mteam');
  db.prepare(`
    INSERT INTO maintenance_teams (id, company_id, code, name, members, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, code) DO UPDATE SET name = excluded.name, members = excluded.members
  `).run(
    id, companyId, code, g.requireText(payload.name, 'team name'),
    JSON.stringify(payload.members || []), nowIso(),
  );
  return db.prepare('SELECT * FROM maintenance_teams WHERE company_id = ? AND code = ?').get(companyId, code);
}

export function createRequest(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const title = g.requireText(payload.title, 'request title');
  if (payload.asset_id) g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  if (payload.work_center_id) g.scopedRow(db, 'work_centers', payload.work_center_id, companyId, 'work centre');

  const id = payload.id || makeId('mreq');
  const reference = payload.reference || g.nextReference(db, 'maintenance_requests', companyId, 'MR');
  const now = nowIso();
  db.prepare(`
    INSERT INTO maintenance_requests (
      id, company_id, reference, asset_id, work_center_id, location_id, title, description,
      maintenance_type, priority, symptom, failure_code, state, requested_by, requested_at,
      order_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, NULL, ?)
  `).run(
    id, companyId, reference, payload.asset_id || null, payload.work_center_id || null,
    payload.location_id || null, title, payload.description || null,
    payload.maintenance_type || 'corrective', payload.priority || 'medium',
    payload.symptom || null, payload.failure_code || null, actor, now, now,
  );
  return g.scopedRow(db, 'maintenance_requests', id, companyId, 'maintenance request');
}

// --------------------------------------------------------------------------
// Preventive plans
// --------------------------------------------------------------------------

export function createPlan(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const name = g.requireText(payload.name, 'plan name');
  const triggerType = payload.trigger_type;
  if (!['calendar', 'meter', 'both'].includes(triggerType)) {
    throw new MaintenanceError(`unsupported trigger_type: ${triggerType}`, 'INPUT_INVALID');
  }
  const intervalDays = Number(payload.interval_days || 0);
  const meterInterval = Number(payload.meter_interval || 0);
  if ((triggerType === 'calendar' || triggerType === 'both') && !(intervalDays > 0)) {
    throw new MaintenanceError('a calendar trigger needs a positive interval_days', 'INPUT_INVALID');
  }
  if ((triggerType === 'meter' || triggerType === 'both') && !(meterInterval > 0)) {
    throw new MaintenanceError('a meter trigger needs a positive meter_interval', 'INPUT_INVALID');
  }
  if (payload.asset_id) g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  if (!payload.asset_id && !payload.asset_category_id) {
    throw new MaintenanceError('a plan needs either an asset or an asset category', 'INPUT_MISSING_FIELD');
  }

  const code = String(payload.code || '').trim() || g.nextReference(db, 'maintenance_plans', companyId, 'PM', 'code');
  const id = payload.id || makeId('mplan');
  const now = nowIso();
  const nextDue = payload.next_due_date
    || (intervalDays > 0 ? addDays(today(), intervalDays) : null);
  const nextMeter = payload.next_due_meter
    || (meterInterval > 0 && payload.asset_id
      ? round6(Number(latestMeter(db, payload.asset_id, payload.meter_type || 'hours')?.reading || 0) + meterInterval)
      : null);

  db.prepare(`
    INSERT INTO maintenance_plans (
      id, company_id, code, name, asset_id, asset_category_id, maintenance_type,
      trigger_type, interval_days, meter_type, meter_interval, lead_days, team_id,
      checklist, spare_parts, estimated_hours, quality_plan_id, last_generated_at,
      last_generated_meter, next_due_date, next_due_meter, is_active, created_at,
      created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?)
  `).run(
    id, companyId, code, name, payload.asset_id || null, payload.asset_category_id || null,
    payload.maintenance_type || 'preventive', triggerType, intervalDays,
    payload.meter_type || null, meterInterval, Number(payload.lead_days || 0),
    payload.team_id || null, JSON.stringify(payload.checklist || []),
    JSON.stringify(payload.spare_parts || []), Number(payload.estimated_hours || 0),
    payload.quality_plan_id || null, nextDue, nextMeter, now, actor, now,
  );
  return g.scopedRow(db, 'maintenance_plans', id, companyId, 'maintenance plan');
}

function addDays(dateIso, days) {
  const base = new Date(`${String(dateIso).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Number(days));
  return base.toISOString().slice(0, 10);
}

/**
 * Generate the maintenance orders that are due.
 *
 * Idempotency is structural, not advisory: `generation_key` encodes
 * plan + asset + the exact due point, and a unique index rejects a second
 * insert. Running the generator twice produces the same set of orders.
 */
export function generatePreventiveOrders(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const asOf = payload.as_of || today();
  const plans = db.prepare(`
    SELECT * FROM maintenance_plans WHERE company_id = ? AND is_active = 1
    ${payload.plan_id ? 'AND id = ?' : ''}
  `).all(...(payload.plan_id ? [companyId, payload.plan_id] : [companyId]));

  const created = [];
  const skipped = [];

  for (const plan of plans) {
    const targets = plan.asset_id
      ? [db.prepare('SELECT * FROM assets WHERE id = ? AND company_id = ?').get(plan.asset_id, companyId)].filter(Boolean)
      : db.prepare(`
          SELECT * FROM assets WHERE company_id = ? AND category_id = ?
            AND state IN ('active', 'under_maintenance')
        `).all(companyId, plan.asset_category_id);

    for (const asset of targets) {
      const due = dueSignal(db, plan, asset, asOf);
      if (!due.due) {
        skipped.push({ plan_id: plan.id, asset_id: asset.id, reason: due.reason });
        continue;
      }
      const generationKey = `${plan.id}:${asset.id}:${due.key}`;
      const existing = db.prepare(
        'SELECT id FROM maintenance_orders WHERE company_id = ? AND generation_key = ?',
      ).get(companyId, generationKey);
      if (existing) {
        skipped.push({ plan_id: plan.id, asset_id: asset.id, reason: 'already generated', order_id: existing.id });
        continue;
      }

      const order = createOrder(db, {
        company_id: companyId,
        actor,
        actor_id: actor,
        plan_id: plan.id,
        asset_id: asset.id,
        title: `${plan.name} — ${asset.asset_tag}`,
        description: `Preventive maintenance generated from plan ${plan.code}`,
        maintenance_type: plan.maintenance_type,
        priority: 'medium',
        team_id: plan.team_id,
        scheduled_start: due.scheduled_start,
        planned_hours: Number(plan.estimated_hours || 0),
        checklist: safeJson(plan.checklist),
        generation_key: generationKey,
        quality_plan_id: plan.quality_plan_id,
      });
      created.push({ plan_id: plan.id, asset_id: asset.id, order_id: order.id, generation_key: generationKey });

      db.prepare(`
        UPDATE maintenance_plans SET last_generated_at = ?, last_generated_meter = ?,
          next_due_date = ?, next_due_meter = ?, updated_at = ? WHERE id = ?
      `).run(
        nowIso(), due.meter_reading ?? plan.last_generated_meter,
        due.next_due_date, due.next_due_meter, nowIso(), plan.id,
      );
    }
  }
  return { generated: created.length, created, skipped };
}

function safeJson(text) {
  try { return JSON.parse(text || '[]'); } catch (_) { return []; }
}

function dueSignal(db, plan, asset, asOf) {
  const calendarDue = (plan.trigger_type === 'calendar' || plan.trigger_type === 'both')
    && plan.next_due_date && plan.next_due_date <= addDays(asOf, Number(plan.lead_days || 0));

  let meterDue = false;
  let meterReading = null;
  if (plan.trigger_type === 'meter' || plan.trigger_type === 'both') {
    const latest = latestMeter(db, asset.id, plan.meter_type || 'hours');
    meterReading = latest ? latest.reading : null;
    if (meterReading !== null && plan.next_due_meter !== null && plan.next_due_meter !== undefined) {
      meterDue = meterReading >= Number(plan.next_due_meter);
    }
  }

  if (!calendarDue && !meterDue) {
    return { due: false, reason: 'not due yet' };
  }
  const key = meterDue && meterReading !== null
    ? `meter:${round6(Number(plan.next_due_meter))}`
    : `date:${plan.next_due_date}`;
  return {
    due: true,
    key,
    scheduled_start: plan.next_due_date || asOf,
    meter_reading: meterReading,
    next_due_date: Number(plan.interval_days) > 0
      ? addDays(plan.next_due_date || asOf, Number(plan.interval_days))
      : plan.next_due_date,
    next_due_meter: Number(plan.meter_interval) > 0 && meterReading !== null
      ? round6(meterReading + Number(plan.meter_interval))
      : plan.next_due_meter,
  };
}

// --------------------------------------------------------------------------
// Orders
// --------------------------------------------------------------------------

export function createOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const title = g.requireText(payload.title, 'maintenance order title');
  if (payload.asset_id) g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  if (payload.request_id) g.scopedRow(db, 'maintenance_requests', payload.request_id, companyId, 'maintenance request');
  if (payload.project_id) g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');

  const id = payload.id || makeId('mord');
  const reference = payload.reference || g.nextReference(db, 'maintenance_orders', companyId, 'MO-MNT');
  const now = nowIso();

  const workItem = createWorkItem(db, {
    company_id: companyId,
    branch_id: payload.branch_id || '*',
    title: `${reference} · ${title}`,
    description: payload.description || 'Maintenance work',
    source_type: 'maintenance_order',
    source_id: id,
    status: 'todo',
    stage: 'maintenance',
    priority: payload.priority || 'medium',
    estimated_hours: Number(payload.planned_hours || 0),
    maintenance_ref: id,
    project_ref: payload.project_id || null,
    checklist_json: payload.checklist || [],
    actor,
    created_by: actor,
  });

  db.prepare(`
    INSERT INTO maintenance_orders (
      id, company_id, branch_id, reference, request_id, plan_id, asset_id, vehicle_id,
      work_center_id, location_id, project_id, work_item_id, title, description,
      maintenance_type, priority, state, team_id, technician_ref, service_provider_party_id,
      scheduled_start, scheduled_end, actual_start, actual_end, downtime_minutes,
      planned_hours, actual_hours, checklist, permits, failure_code, symptom,
      root_cause, corrective_action, parts_cost, labor_cost, external_cost, currency,
      quality_inspection_id, generation_key, approved_by, approved_at,
      returned_to_service_at, created_at, created_by, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, NULL, NULL,
      0, ?, 0, ?, ?, ?, ?, NULL, NULL, 0, 0, 0, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, 1)
  `).run(
    id, companyId, payload.branch_id || null, reference, payload.request_id || null,
    payload.plan_id || null, payload.asset_id || null, payload.vehicle_id || null,
    payload.work_center_id || null, payload.location_id || null, payload.project_id || null,
    workItem.id, title, payload.description || null,
    payload.maintenance_type || 'corrective', payload.priority || 'medium',
    payload.team_id || null, payload.technician_ref || null,
    payload.service_provider_party_id || null,
    payload.scheduled_start || null, payload.scheduled_end || null,
    Number(payload.planned_hours || 0),
    JSON.stringify(payload.checklist || []), JSON.stringify(payload.permits || []),
    payload.failure_code || null, payload.symptom || null,
    payload.currency || 'IQD', payload.generation_key || null, now, actor, now,
  );

  if (payload.request_id) {
    db.prepare("UPDATE maintenance_requests SET state = 'converted', order_id = ?, updated_at = ? WHERE id = ?")
      .run(id, now, payload.request_id);
  }
  if (payload.quality_plan_id) {
    createInspection(db, {
      company_id: companyId, actor, actor_id: actor,
      plan_id: payload.quality_plan_id,
      subject_type: 'maintenance_order',
      subject_id: id,
    });
  }
  return getOrder(db, id, companyId);
}

function setState(db, order, state, extra = {}) {
  const now = nowIso();
  const assignments = ['state = ?', 'updated_at = ?', 'version = version + 1'];
  const params = [state, now];
  for (const [column, value] of Object.entries(extra)) {
    assignments.splice(assignments.length - 1, 0, `${column} = ?`);
    params.splice(params.length, 0, value);
  }
  params.push(order.id);
  db.prepare(`UPDATE maintenance_orders SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  if (order.work_item_id && WORK_ITEM_STATE_FOR[state]) {
    updateWorkItem(db, order.work_item_id, { company_id: order.company_id, status: WORK_ITEM_STATE_FOR[state] });
  }
}

export function approveOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  g.assertState(order.state, ['draft'], 'maintenance order', 'MAINTENANCE_STATE_INVALID');
  setState(db, order, payload.scheduled_start || order.scheduled_start ? 'scheduled' : 'approved', {
    approved_by: actor,
    approved_at: nowIso(),
    scheduled_start: payload.scheduled_start || order.scheduled_start,
  });
  return getOrder(db, order.id, companyId);
}

/**
 * Starting maintenance takes the asset out of service. That is a real state
 * change on the asset register, not a flag on the order — otherwise production
 * planning would keep scheduling a machine that is on a workbench in pieces.
 */
export function startOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  g.assertState(order.state, ['approved', 'scheduled', 'waiting_parts'], 'maintenance order', 'MAINTENANCE_STATE_INVALID');
  setState(db, order, 'in_progress', { actual_start: order.actual_start || nowIso() });
  if (order.asset_id) {
    setMaintenanceState(db, { company_id: companyId, asset_id: order.asset_id, under_maintenance: true });
  }
  if (order.vehicle_id) {
    db.prepare("UPDATE fleet_vehicles SET state = 'under_maintenance', updated_at = ? WHERE id = ? AND company_id = ?")
      .run(nowIso(), order.vehicle_id, companyId);
  }
  return getOrder(db, order.id, companyId);
}

/**
 * Issue a spare part. The movement is a canonical Phase 04 stock move to the
 * maintenance consumption location; maintenance records the cost only.
 */
export function issueSparePart(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  g.assertState(order.state, EXECUTABLE_STATES, 'maintenance order', 'MAINTENANCE_STATE_INVALID');
  const quantity = g.positive(payload.quantity, 'quantity');

  const warehouseId = payload.warehouse_id
    || db.prepare('SELECT id FROM warehouses WHERE company_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1').get(companyId)?.id;
  if (!warehouseId) throw new MaintenanceError('a warehouse is required to issue spare parts', 'INPUT_MISSING_FIELD');
  const warehouse = g.scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');
  const destination = payload.location_dest_id || ensureMaintenanceLocation(db, companyId, warehouseId).id;
  const uomId = payload.uom_id
    || db.prepare('SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(payload.product_id)?.uom_id;
  if (!uomId) throw new MaintenanceError('a unit of measure is required to issue a spare part', 'INPUT_MISSING_FIELD');

  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: order.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${order.reference}/PART`,
    product_id: payload.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: payload.location_id || warehouse.lot_stock_id,
    location_dest_id: destination,
    source_document_type: 'maintenance_order',
    source_document_id: order.id,
    idempotency_key: payload.stock_idempotency_key || `maint-part:${order.id}:${payload.product_id}:${makeId('n')}`,
  });

  const value = round2(Math.abs(Number(move.total_value || 0)));
  db.prepare(`
    INSERT INTO maintenance_parts (
      id, order_id, company_id, product_id, quantity, value, stock_move_id,
      finance_document_id, issued_by, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('mpart'), order.id, companyId, payload.product_id, quantity, value,
    move.id, move.accounting?.finance_document_id || null, actor, nowIso(),
  );
  db.prepare('UPDATE maintenance_orders SET parts_cost = parts_cost + ?, updated_at = ? WHERE id = ?')
    .run(value, nowIso(), order.id);

  return {
    order_id: order.id,
    stock_move_id: move.id,
    quantity,
    value,
    finance_document_id: move.accounting?.finance_document_id || null,
  };
}

/**
 * The maintenance consumption location.
 *
 * Deliberately NOT the manufacturing `production` location: a spare part fitted
 * during maintenance is a maintenance expense, not manufacturing work in
 * progress, and routing it through the WIP account would leave value in WIP that
 * no manufacturing order can ever clear. `consumption` is a distinct
 * non-internal usage, so the Phase 04 stock port posts
 * Dr <product category expense account> / Cr Inventory.
 */
export function ensureMaintenanceLocation(db, companyId, warehouseId) {
  const existing = db.prepare(`
    SELECT * FROM stock_locations
    WHERE company_id = ? AND warehouse_id = ? AND usage = 'consumption'
      AND name = 'Maintenance Consumption'
    ORDER BY created_at LIMIT 1
  `).get(companyId, warehouseId);
  if (existing) return existing;

  const warehouse = g.scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');
  const id = makeId('loc_mnt');
  db.prepare(`
    INSERT INTO stock_locations (
      id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at
    ) VALUES (?, ?, ?, ?, 'Maintenance Consumption', ?, 'consumption', 0, ?)
  `).run(id, companyId, warehouseId, warehouse.view_location_id, `${warehouse.code}/MaintenanceConsumption`, nowIso());
  return db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(id);
}

export function recordLabor(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  g.assertState(order.state, EXECUTABLE_STATES, 'maintenance order', 'MAINTENANCE_STATE_INVALID');
  const hours = g.positive(payload.hours, 'hours');
  const rate = g.nonNegative(payload.rate_per_hour, 'rate_per_hour');
  const amount = round2(hours * rate);

  let financeDocumentId = null;
  if (amount > 0 && payload.expense_account_id && payload.credit_account_id) {
    const posted = postSourceFact(db, g.financeContext(payload), {
      fact_type: 'project_cost_posting',
      source_id: `${order.id}:labor:${payload.technician_ref || actor}:${nowIso()}`,
      doc_date: payload.doc_date || today(),
      currency: payload.currency || order.currency || 'IQD',
      lines: [
        { account_id: payload.expense_account_id, debit: amount, credit: 0, description: `maintenance_labor:${order.reference}` },
        { account_id: payload.credit_account_id, debit: 0, credit: amount, description: `maintenance_labor:${order.reference}` },
      ],
    });
    financeDocumentId = posted.document_id;
  }

  const id = payload.id || makeId('mlab');
  db.prepare(`
    INSERT INTO maintenance_labor_entries (
      id, order_id, company_id, technician_ref, hours, rate_per_hour, amount,
      currency, finance_document_id, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, order.id, companyId, payload.technician_ref || actor, hours, rate, amount,
    payload.currency || order.currency || 'IQD', financeDocumentId, actor, nowIso(),
  );
  db.prepare('UPDATE maintenance_orders SET labor_cost = labor_cost + ?, actual_hours = actual_hours + ?, updated_at = ? WHERE id = ?')
    .run(amount, hours, nowIso(), order.id);

  if (order.work_item_id) {
    const item = db.prepare('SELECT actual_hours FROM work_items WHERE id = ?').get(order.work_item_id);
    updateWorkItem(db, order.work_item_id, {
      company_id: companyId,
      actual_hours: Number(item?.actual_hours || 0) + hours,
    });
  }
  return { id, order_id: order.id, hours, amount, finance_document_id: financeDocumentId };
}

export function completeOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  g.assertState(order.state, ['in_progress', 'waiting_parts', 'quality_hold'], 'maintenance order', 'MAINTENANCE_STATE_INVALID');
  if (!payload.root_cause && !order.root_cause && order.maintenance_type !== 'preventive') {
    throw new MaintenanceError(
      'a corrective maintenance order needs a root cause before completion',
      'INPUT_MISSING_FIELD',
    );
  }
  const now = nowIso();
  const downtime = order.actual_start
    ? Math.max(0, Math.round((Date.parse(now) - Date.parse(order.actual_start)) / 60_000))
    : Number(payload.downtime_minutes || 0);

  setState(db, order, 'completed', {
    actual_end: now,
    downtime_minutes: Number(payload.downtime_minutes ?? downtime),
    root_cause: payload.root_cause || order.root_cause,
    corrective_action: payload.corrective_action || order.corrective_action,
    failure_code: payload.failure_code || order.failure_code,
    external_cost: round2(Number(order.external_cost) + Number(payload.external_cost || 0)),
  });
  return getOrder(db, order.id, companyId);
}

/**
 * Return-to-service is the quality gate. A mandatory inspection that has not
 * passed (and carries no approved deviation) blocks the equipment from going
 * back into production.
 */
export function returnToService(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  // `quality_hold` is included: an order parked on hold returns to service once
  // the inspection clears, without having to be "completed" a second time.
  g.assertState(order.state, ['completed', 'quality_hold'], 'maintenance order', 'MAINTENANCE_STATE_INVALID');

  // The gate throws without writing a state change first: this action runs
  // inside the executor's transaction, so any write made here would be rolled
  // back by the throw anyway. A caller that wants the order parked on hold
  // calls `maintenance:order:hold` — the hold is its own recorded decision, not
  // a side effect of a failed attempt.
  const quality = isBlockedByQuality(db, companyId, 'maintenance_order', order.id);
  if (quality.blocked) {
    throw new MaintenanceError(
      `inspection ${quality.inspection_reference} (${quality.inspection_state}) blocks return to service`,
      'QUALITY_HOLD_ACTIVE',
    );
  }

  const now = nowIso();
  setState(db, order, 'closed', { returned_to_service_at: now });
  if (order.asset_id) {
    setMaintenanceState(db, { company_id: companyId, asset_id: order.asset_id, under_maintenance: false });
  }
  if (order.vehicle_id) {
    db.prepare("UPDATE fleet_vehicles SET state = 'active', updated_at = ? WHERE id = ? AND company_id = ?")
      .run(now, order.vehicle_id, companyId);
  }
  return getOrder(db, order.id, companyId);
}

/**
 * Park an order on quality hold as an explicit, recorded decision.
 */
export function holdOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  g.requireActor(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  g.assertState(order.state, ['in_progress', 'waiting_parts', 'completed'], 'maintenance order', 'MAINTENANCE_STATE_INVALID');
  setState(db, order, 'quality_hold', {});
  return getOrder(db, order.id, companyId);
}

export function cancelOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const order = g.scopedRow(db, 'maintenance_orders', payload.order_id, companyId, 'maintenance order');
  g.assertState(order.state, ['draft', 'approved', 'scheduled', 'waiting_parts'], 'maintenance order', 'MAINTENANCE_STATE_INVALID');
  setState(db, order, 'cancelled', {});
  if (order.asset_id) {
    setMaintenanceState(db, { company_id: companyId, asset_id: order.asset_id, under_maintenance: false });
  }
  return getOrder(db, order.id, companyId);
}

export function getOrder(db, id, companyId) {
  const order = g.scopedRow(db, 'maintenance_orders', id, companyId, 'maintenance order');
  const parts = db.prepare('SELECT * FROM maintenance_parts WHERE order_id = ? ORDER BY issued_at').all(id);
  const labor = db.prepare('SELECT * FROM maintenance_labor_entries WHERE order_id = ? ORDER BY recorded_at').all(id);
  return {
    ...order,
    parts,
    labor,
    total_cost: round2(Number(order.parts_cost) + Number(order.labor_cost) + Number(order.external_cost)),
  };
}

export function listOrders(db, { company_id, state = null, asset_id = null, vehicle_id = null, limit = 200 }) {
  let sql = 'SELECT * FROM maintenance_orders WHERE company_id = ?';
  const params = [company_id];
  if (state) { sql += ' AND state = ?'; params.push(state); }
  if (asset_id) { sql += ' AND asset_id = ?'; params.push(asset_id); }
  if (vehicle_id) { sql += ' AND vehicle_id = ?'; params.push(vehicle_id); }
  sql += ` ORDER BY created_at DESC LIMIT ${Math.min(Number(limit) || 200, 1000)}`;
  return db.prepare(sql).all(...params);
}

export { round2, round6 };
