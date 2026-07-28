// Work centers, resources, versioned Routings, and Engineering Change Orders
// — Checkpoint D2.
//
// Routing versions follow the same immutability contract as BOM versions:
// editable only while draft and unconsumed; approved versions used by a
// production order can only be replaced through a new revision.
//
// Work-centre standard rates are mirrored into the Checkpoint D1
// `project_cost_rates` table (rate_scope = 'work_center') so there is exactly
// ONE standard-cost authority for labour and machine time, and payroll is
// still never consulted.

'use strict';

import { fail, requireFields, makeId } from './bom.mjs';

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Work centers
// ---------------------------------------------------------------------------

export function createWorkCenter(db, input = {}) {
  requireFields(input, ['code', 'name']);
  const companyId = input.company_id;
  if (db.prepare('SELECT id FROM work_centers WHERE company_id = ? AND code = ?').get(companyId, String(input.code))) {
    fail(`work center code ${input.code} already exists`, 'WORK_CENTER_CODE_DUPLICATE', 409);
  }
  const capacity = Number(input.capacity_per_hour || 1);
  if (!(capacity > 0)) fail('work center capacity must be positive', 'WORK_CENTER_CAPACITY_INVALID', 400);
  const efficiency = Number(input.efficiency_percent || 100);
  if (!(efficiency > 0)) fail('work center efficiency must be positive', 'WORK_CENTER_EFFICIENCY_INVALID', 400);

  const id = makeId('wc');
  const stamp = now();
  db.prepare(`
    INSERT INTO work_centers (id, company_id, branch_id, code, name_ar, name_en, description,
      warehouse_id, wip_location_id, capacity_per_hour, efficiency_percent, working_hours_per_day,
      absorption_account_id, machine_cost_per_hour, labor_cost_per_hour, overhead_cost_per_hour,
      is_subcontract, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, input.branch_id || null, String(input.code),
    String(input.name_ar || input.name || ''), String(input.name_en || input.name || ''),
    String(input.description || ''), input.warehouse_id || null, input.wip_location_id || null,
    capacity, efficiency, Number(input.working_hours_per_day || 8),
    input.absorption_account_id || null,
    Number(input.machine_cost_per_hour || 0), Number(input.labor_cost_per_hour || 0),
    Number(input.overhead_cost_per_hour || 0),
    input.is_subcontract ? 1 : 0, stamp, stamp,
  );

  syncWorkCenterRate(db, companyId, id, Number(input.machine_cost_per_hour || 0));
  return db.prepare('SELECT * FROM work_centers WHERE id = ?').get(id);
}

/**
 * Mirror the work-centre machine rate into the single canonical standard-cost
 * table so effort costing has one authority to read.
 */
function syncWorkCenterRate(db, companyId, workCenterId, hourlyCost) {
  const stamp = now();
  db.prepare(`
    INSERT INTO project_cost_rates (id, company_id, rate_scope, rate_key, hourly_cost, currency_code, is_active, created_at, updated_at)
    VALUES (?, ?, 'work_center', ?, ?, 'IQD', 1, ?, ?)
    ON CONFLICT(company_id, rate_scope, rate_key) DO UPDATE SET
      hourly_cost = excluded.hourly_cost,
      is_active = 1,
      updated_at = excluded.updated_at
  `).run(`pcr_wc_${workCenterId}`, companyId, workCenterId, Number(hourlyCost || 0), stamp, stamp);
}

export function updateWorkCenter(db, input = {}) {
  requireFields(input, ['work_center_id']);
  const companyId = input.company_id;
  const wc = db.prepare('SELECT * FROM work_centers WHERE id = ? AND company_id = ?').get(input.work_center_id, companyId);
  if (!wc) fail('work center not found', 'WORK_CENTER_NOT_FOUND', 404);

  const machineRate = input.machine_cost_per_hour !== undefined ? Number(input.machine_cost_per_hour) : wc.machine_cost_per_hour;
  db.prepare(`
    UPDATE work_centers SET name_ar = ?, name_en = ?, description = ?, warehouse_id = ?,
      wip_location_id = ?, capacity_per_hour = ?, efficiency_percent = ?, working_hours_per_day = ?,
      absorption_account_id = ?, machine_cost_per_hour = ?, labor_cost_per_hour = ?,
      overhead_cost_per_hour = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name_ar !== undefined ? String(input.name_ar) : wc.name_ar,
    input.name_en !== undefined ? String(input.name_en) : wc.name_en,
    input.description !== undefined ? String(input.description) : wc.description,
    input.warehouse_id !== undefined ? input.warehouse_id : wc.warehouse_id,
    input.wip_location_id !== undefined ? input.wip_location_id : wc.wip_location_id,
    input.capacity_per_hour !== undefined ? Number(input.capacity_per_hour) : wc.capacity_per_hour,
    input.efficiency_percent !== undefined ? Number(input.efficiency_percent) : wc.efficiency_percent,
    input.working_hours_per_day !== undefined ? Number(input.working_hours_per_day) : wc.working_hours_per_day,
    input.absorption_account_id !== undefined ? input.absorption_account_id : wc.absorption_account_id,
    machineRate,
    input.labor_cost_per_hour !== undefined ? Number(input.labor_cost_per_hour) : wc.labor_cost_per_hour,
    input.overhead_cost_per_hour !== undefined ? Number(input.overhead_cost_per_hour) : wc.overhead_cost_per_hour,
    input.is_active === false ? 0 : wc.is_active,
    now(), wc.id,
  );
  syncWorkCenterRate(db, companyId, wc.id, machineRate);
  return db.prepare('SELECT * FROM work_centers WHERE id = ?').get(wc.id);
}

export function addWorkCenterResource(db, input = {}) {
  requireFields(input, ['work_center_id', 'name']);
  const companyId = input.company_id;
  const wc = db.prepare('SELECT id FROM work_centers WHERE id = ? AND company_id = ?').get(input.work_center_id, companyId);
  if (!wc) fail('work center not found', 'WORK_CENTER_NOT_FOUND', 404);
  const resourceType = String(input.resource_type || 'machine');
  if (!['machine', 'tool', 'labor_pool'].includes(resourceType)) {
    fail(`unsupported resource type: ${resourceType}`, 'WORK_CENTER_RESOURCE_TYPE_INVALID', 400);
  }
  const id = makeId('wcr');
  const stamp = now();
  db.prepare(`
    INSERT INTO work_center_resources (id, company_id, work_center_id, resource_type, code, name,
      asset_ref, capacity_per_hour, cost_per_hour, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, wc.id, resourceType, String(input.code || ''), String(input.name),
    input.asset_ref || null, Number(input.capacity_per_hour || 1), Number(input.cost_per_hour || 0),
    stamp, stamp,
  );
  return db.prepare('SELECT * FROM work_center_resources WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// Routings
// ---------------------------------------------------------------------------

export function getRoutingVersion(db, versionId, companyId) {
  const row = db.prepare('SELECT * FROM routing_versions WHERE id = ? AND company_id = ?').get(versionId, companyId);
  if (!row) fail('routing version not found', 'ROUTING_VERSION_NOT_FOUND', 404);
  return row;
}

function assertRoutingEditable(version) {
  if (version.consumed_at) {
    fail(
      'this routing version has been consumed by production and is immutable — raise a new revision',
      'ROUTING_VERSION_IMMUTABLE',
      409,
    );
  }
  if (version.state !== 'draft') {
    fail(`a ${version.state} routing version cannot be edited — raise a new revision`, 'ROUTING_VERSION_NOT_DRAFT', 409);
  }
}

export function createRouting(db, input = {}) {
  requireFields(input, ['product_id']);
  const companyId = input.company_id;
  const product = db.prepare("SELECT id FROM product_variants WHERE id = ? AND company_id IN (?, '*')")
    .get(input.product_id, companyId);
  if (!product) fail(`product variant not found: ${input.product_id}`, 'PRODUCT_NOT_FOUND', 404);

  const count = db.prepare('SELECT COUNT(*) AS c FROM routings WHERE company_id = ?').get(companyId).c;
  const code = String(input.code || `RTG-${String(count + 1).padStart(5, '0')}`);
  if (db.prepare('SELECT id FROM routings WHERE company_id = ? AND code = ?').get(companyId, code)) {
    fail(`routing code ${code} already exists`, 'ROUTING_CODE_DUPLICATE', 409);
  }

  const routingId = makeId('rtg');
  const versionId = makeId('rtgv');
  const stamp = now();
  db.prepare(`
    INSERT INTO routings (id, company_id, branch_id, code, product_id, name_ar, name_en, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    routingId, companyId, input.branch_id || null, code, input.product_id,
    String(input.name_ar || ''), String(input.name_en || ''), input.actor || null, stamp, stamp,
  );
  db.prepare(`
    INSERT INTO routing_versions (id, company_id, routing_id, revision, state, effective_from, notes, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?)
  `).run(versionId, companyId, routingId, input.effective_from || null, String(input.notes || ''), stamp, stamp);

  for (const [index, op] of (Array.isArray(input.operations) ? input.operations : []).entries()) {
    addRoutingOperation(db, { ...op, company_id: companyId, routing_version_id: versionId, sequence: op.sequence || (index + 1) * 10, actor: input.actor });
  }
  return readRouting(db, routingId, companyId);
}

export function addRoutingOperation(db, input = {}) {
  requireFields(input, ['routing_version_id', 'work_center_id', 'name']);
  const companyId = input.company_id;
  const version = getRoutingVersion(db, input.routing_version_id, companyId);
  assertRoutingEditable(version);

  const wc = db.prepare('SELECT * FROM work_centers WHERE id = ? AND company_id = ? AND is_active = 1')
    .get(input.work_center_id, companyId);
  if (!wc) fail('work center not found or inactive', 'WORK_CENTER_NOT_FOUND', 404);

  const setup = Number(input.setup_minutes || 0);
  const cycle = Number(input.cycle_minutes_per_unit || 0);
  const queue = Number(input.queue_minutes || 0);
  if (setup < 0 || cycle < 0 || queue < 0) {
    fail('operation times cannot be negative', 'ROUTING_OPERATION_TIME_INVALID', 400);
  }
  if (setup === 0 && cycle === 0) {
    fail('an operation must define setup time or cycle time', 'ROUTING_OPERATION_TIME_REQUIRED', 400);
  }

  const isSubcontract = input.is_subcontract ? 1 : 0;
  if (isSubcontract && !input.subcontract_party_id) {
    fail('a subcontract operation requires a supplier party', 'ROUTING_SUBCONTRACT_PARTY_REQUIRED', 400);
  }
  if (input.subcontract_party_id) {
    const party = db.prepare('SELECT id FROM parties WHERE id = ? AND company_id = ?').get(input.subcontract_party_id, companyId);
    if (!party) fail('subcontract supplier not found', 'PARTY_NOT_FOUND', 404);
  }

  const sequence = Number(input.sequence
    || (db.prepare('SELECT COALESCE(MAX(sequence),0) AS s FROM routing_operations WHERE routing_version_id = ?').get(version.id).s + 10));
  if (db.prepare('SELECT id FROM routing_operations WHERE routing_version_id = ? AND sequence = ?').get(version.id, sequence)) {
    fail(`operation sequence ${sequence} already exists on this routing version`, 'ROUTING_OPERATION_SEQUENCE_DUPLICATE', 409);
  }

  const id = makeId('rtgop');
  db.prepare(`
    INSERT INTO routing_operations (id, company_id, routing_version_id, sequence, code, name, description,
      work_center_id, resource_id, setup_minutes, cycle_minutes_per_unit, queue_minutes,
      labor_required, machine_required, labor_rate_per_hour, machine_rate_per_hour, predecessor_seq,
      is_subcontract, subcontract_party_id, subcontract_service_cost, quality_checkpoint,
      quality_plan_ref, work_instructions, attachments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, version.id, sequence, String(input.code || ''), String(input.name),
    String(input.description || ''), wc.id, input.resource_id || null,
    setup, cycle, queue,
    Number(input.labor_required !== undefined ? input.labor_required : 1),
    Number(input.machine_required !== undefined ? input.machine_required : 1),
    // Rates default to the work centre's configured standard rates.
    Number(input.labor_rate_per_hour !== undefined ? input.labor_rate_per_hour : wc.labor_cost_per_hour),
    Number(input.machine_rate_per_hour !== undefined ? input.machine_rate_per_hour : wc.machine_cost_per_hour),
    input.predecessor_seq !== undefined && input.predecessor_seq !== null ? Number(input.predecessor_seq) : null,
    isSubcontract, input.subcontract_party_id || null, Number(input.subcontract_service_cost || 0),
    input.quality_checkpoint ? 1 : 0, input.quality_plan_ref || null,
    String(input.work_instructions || ''),
    JSON.stringify(Array.isArray(input.attachments) ? input.attachments : []),
    now(),
  );
  return db.prepare('SELECT * FROM routing_operations WHERE id = ?').get(id);
}

export function submitRouting(db, input = {}) {
  requireFields(input, ['routing_version_id']);
  const companyId = input.company_id;
  const version = getRoutingVersion(db, input.routing_version_id, companyId);
  if (version.state !== 'draft') {
    fail(`only a draft routing version can be submitted (state is ${version.state})`, 'ROUTING_VERSION_NOT_DRAFT', 409);
  }
  const ops = db.prepare('SELECT COUNT(*) AS c FROM routing_operations WHERE routing_version_id = ?').get(version.id).c;
  if (!ops) fail('a routing version must have at least one operation', 'ROUTING_VERSION_EMPTY', 409);

  const stamp = now();
  db.prepare("UPDATE routing_versions SET state = 'review', submitted_by = ?, submitted_at = ?, updated_at = ? WHERE id = ?")
    .run(input.actor || null, stamp, stamp, version.id);
  return getRoutingVersion(db, version.id, companyId);
}

export function approveRouting(db, input = {}) {
  requireFields(input, ['routing_version_id']);
  const companyId = input.company_id;
  const version = getRoutingVersion(db, input.routing_version_id, companyId);
  if (version.state !== 'review') {
    fail(`only a version under review can be approved (state is ${version.state})`, 'ROUTING_VERSION_NOT_IN_REVIEW', 409);
  }
  if (version.submitted_by && input.actor && String(version.submitted_by) === String(input.actor)) {
    fail('a routing version cannot be approved by the same actor who submitted it', 'ROUTING_SELF_APPROVAL_DENIED', 403);
  }
  const stamp = now();
  db.prepare("UPDATE routing_versions SET state = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?")
    .run(input.actor || null, stamp, stamp, version.id);

  const previous = db.prepare(`
    SELECT id FROM routing_versions WHERE routing_id = ? AND state = 'approved' AND id != ?
    ORDER BY revision DESC LIMIT 1
  `).get(version.routing_id, version.id);
  if (previous) {
    db.prepare("UPDATE routing_versions SET state = 'superseded', superseded_by_id = ?, superseded_at = ?, updated_at = ? WHERE id = ?")
      .run(version.id, stamp, stamp, previous.id);
  }
  return { ...getRoutingVersion(db, version.id, companyId), superseded_version_id: previous ? previous.id : null };
}

export function newRoutingRevision(db, input = {}) {
  requireFields(input, ['routing_id']);
  const companyId = input.company_id;
  const routing = db.prepare('SELECT * FROM routings WHERE id = ? AND company_id = ?').get(input.routing_id, companyId);
  if (!routing) fail('routing not found', 'ROUTING_NOT_FOUND', 404);
  const open = db.prepare("SELECT id FROM routing_versions WHERE routing_id = ? AND state IN ('draft','review')").get(routing.id);
  if (open) fail('this routing already has an open draft or in-review revision', 'ROUTING_REVISION_ALREADY_OPEN', 409);

  const latest = db.prepare('SELECT * FROM routing_versions WHERE routing_id = ? ORDER BY revision DESC LIMIT 1').get(routing.id);
  const revision = (latest ? latest.revision : 0) + 1;
  const id = makeId('rtgv');
  const stamp = now();
  db.prepare(`
    INSERT INTO routing_versions (id, company_id, routing_id, revision, state, effective_from, notes, eco_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(id, companyId, routing.id, revision, input.effective_from || null, String(input.notes || ''), input.eco_id || null, stamp, stamp);

  if (latest && input.copy_operations !== false) {
    const ops = db.prepare('SELECT * FROM routing_operations WHERE routing_version_id = ? ORDER BY sequence').all(latest.id);
    const insert = db.prepare(`
      INSERT INTO routing_operations (id, company_id, routing_version_id, sequence, code, name, description,
        work_center_id, resource_id, setup_minutes, cycle_minutes_per_unit, queue_minutes,
        labor_required, machine_required, labor_rate_per_hour, machine_rate_per_hour, predecessor_seq,
        is_subcontract, subcontract_party_id, subcontract_service_cost, quality_checkpoint,
        quality_plan_ref, work_instructions, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const op of ops) {
      insert.run(
        makeId('rtgop'), companyId, id, op.sequence, op.code, op.name, op.description,
        op.work_center_id, op.resource_id, op.setup_minutes, op.cycle_minutes_per_unit, op.queue_minutes,
        op.labor_required, op.machine_required, op.labor_rate_per_hour, op.machine_rate_per_hour,
        op.predecessor_seq, op.is_subcontract, op.subcontract_party_id, op.subcontract_service_cost,
        op.quality_checkpoint, op.quality_plan_ref, op.work_instructions, op.attachments, stamp,
      );
    }
  }
  return getRoutingVersion(db, id, companyId);
}

export function effectiveRoutingVersion(db, companyId, routingId, onDate = null) {
  const date = onDate || now().slice(0, 10);
  return db.prepare(`
    SELECT * FROM routing_versions
    WHERE company_id = ? AND routing_id = ? AND state = 'approved'
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY revision DESC LIMIT 1
  `).get(companyId, routingId, date, date) || null;
}

export function effectiveRoutingForProduct(db, companyId, productId, onDate = null) {
  const routing = db.prepare(
    'SELECT id FROM routings WHERE company_id = ? AND product_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1',
  ).get(companyId, productId);
  if (!routing) return null;
  return effectiveRoutingVersion(db, companyId, routing.id, onDate);
}

export function markRoutingConsumed(db, companyId, versionId) {
  const version = getRoutingVersion(db, versionId, companyId);
  if (version.state !== 'approved') {
    fail('production requires an approved routing version', 'ROUTING_NOT_APPROVED', 409);
  }
  if (!version.consumed_at) {
    db.prepare('UPDATE routing_versions SET consumed_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), version.id);
  }
  return getRoutingVersion(db, versionId, companyId);
}

export function readRouting(db, routingId, companyId) {
  const routing = db.prepare('SELECT * FROM routings WHERE id = ? AND company_id = ?').get(routingId, companyId);
  if (!routing) fail('routing not found', 'ROUTING_NOT_FOUND', 404);
  const versions = db.prepare('SELECT * FROM routing_versions WHERE routing_id = ? ORDER BY revision DESC').all(routing.id);
  return {
    ...routing,
    versions: versions.map((version) => ({
      ...version,
      operations: db.prepare('SELECT * FROM routing_operations WHERE routing_version_id = ? ORDER BY sequence').all(version.id),
    })),
    effective_version: effectiveRoutingVersion(db, companyId, routing.id),
  };
}

// ---------------------------------------------------------------------------
// Engineering change orders
// ---------------------------------------------------------------------------

export function createEco(db, input = {}) {
  requireFields(input, ['title']);
  const companyId = input.company_id;
  const changeType = String(input.change_type || 'bom');
  if (!['bom', 'routing', 'both'].includes(changeType)) {
    fail(`unsupported ECO change type: ${changeType}`, 'ECO_TYPE_INVALID', 400);
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM engineering_change_orders WHERE company_id = ?').get(companyId).c;
  const id = makeId('eco');
  const stamp = now();
  db.prepare(`
    INSERT INTO engineering_change_orders (id, company_id, eco_number, title, description, change_type,
      bom_id, routing_id, reason, state, requested_by, attachments, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)
  `).run(
    id, companyId, `ECO-${String(count + 1).padStart(4, '0')}`, String(input.title),
    String(input.description || ''), changeType, input.bom_id || null, input.routing_id || null,
    String(input.reason || ''), input.actor || null,
    JSON.stringify(Array.isArray(input.attachments) ? input.attachments : []), stamp, stamp,
  );
  return db.prepare('SELECT * FROM engineering_change_orders WHERE id = ?').get(id);
}

/**
 * Approving an ECO opens the governed revision(s) it authorises. It never
 * edits an approved version in place.
 */
export function approveEco(db, input = {}) {
  requireFields(input, ['eco_id']);
  const companyId = input.company_id;
  const eco = db.prepare('SELECT * FROM engineering_change_orders WHERE id = ? AND company_id = ?').get(input.eco_id, companyId);
  if (!eco) fail('engineering change order not found', 'ECO_NOT_FOUND', 404);
  if (!['draft', 'submitted'].includes(eco.state)) {
    fail(`engineering change order is already ${eco.state}`, 'ECO_CLOSED', 409);
  }
  const stamp = now();

  let bomVersion = null;
  let routingVersion = null;
  if (['bom', 'both'].includes(eco.change_type) && eco.bom_id) {
    bomVersion = newBomRevisionForEco(db, companyId, eco, input.actor);
  }
  if (['routing', 'both'].includes(eco.change_type) && eco.routing_id) {
    routingVersion = newRoutingRevision(db, {
      company_id: companyId, routing_id: eco.routing_id, eco_id: eco.id, actor: input.actor,
      notes: `ECO ${eco.eco_number}`,
    });
  }

  db.prepare(`
    UPDATE engineering_change_orders
    SET state = 'approved', decided_by = ?, decided_at = ?, decision_reason = ?,
        resulting_bom_version_id = ?, resulting_routing_version_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.actor || null, stamp, String(input.reason || ''),
    bomVersion ? bomVersion.id : null, routingVersion ? routingVersion.id : null, stamp, eco.id,
  );
  return {
    ...db.prepare('SELECT * FROM engineering_change_orders WHERE id = ?').get(eco.id),
    resulting_bom_version: bomVersion,
    resulting_routing_version: routingVersion,
  };
}

// Imported lazily to avoid a circular module dependency at load time.
function newBomRevisionForEco(db, companyId, eco, actor) {
  // eslint-disable-next-line global-require
  const open = db.prepare("SELECT id FROM bom_versions WHERE bom_id = ? AND state IN ('draft','review')").get(eco.bom_id);
  if (open) return db.prepare('SELECT * FROM bom_versions WHERE id = ?').get(open.id);
  const latest = db.prepare('SELECT * FROM bom_versions WHERE bom_id = ? ORDER BY revision DESC LIMIT 1').get(eco.bom_id);
  const revision = (latest ? latest.revision : 0) + 1;
  const id = makeId('bomv');
  const stamp = now();
  db.prepare(`
    INSERT INTO bom_versions (id, company_id, bom_id, revision, quantity, state, yield_percent,
      drawings, work_instructions, notes, eco_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, eco.bom_id, revision,
    latest ? latest.quantity : 1, latest ? latest.yield_percent : 100,
    latest ? latest.drawings : '[]', latest ? latest.work_instructions : '',
    `ECO ${eco.eco_number}`, eco.id, stamp, stamp,
  );
  if (latest) {
    const lines = db.prepare('SELECT * FROM bom_lines WHERE bom_version_id = ? ORDER BY sequence').all(latest.id);
    const insert = db.prepare(`
      INSERT INTO bom_lines (id, company_id, bom_version_id, sequence, line_type, component_id,
        uom_id, quantity, scrap_factor_percent, is_phantom, child_bom_id, cost_share_percent,
        operation_seq, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      insert.run(
        makeId('boml'), companyId, id, line.sequence, line.line_type, line.component_id,
        line.uom_id, line.quantity, line.scrap_factor_percent, line.is_phantom,
        line.child_bom_id, line.cost_share_percent, line.operation_seq, line.notes, stamp,
      );
    }
  }
  return db.prepare('SELECT * FROM bom_versions WHERE id = ?').get(id);
}

export function rejectEco(db, input = {}) {
  requireFields(input, ['eco_id']);
  const companyId = input.company_id;
  const eco = db.prepare('SELECT * FROM engineering_change_orders WHERE id = ? AND company_id = ?').get(input.eco_id, companyId);
  if (!eco) fail('engineering change order not found', 'ECO_NOT_FOUND', 404);
  if (!['draft', 'submitted'].includes(eco.state)) {
    fail(`engineering change order is already ${eco.state}`, 'ECO_CLOSED', 409);
  }
  const stamp = now();
  db.prepare(`
    UPDATE engineering_change_orders SET state = 'rejected', decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(input.actor || null, stamp, String(input.reason || ''), stamp, eco.id);
  return db.prepare('SELECT * FROM engineering_change_orders WHERE id = ?').get(eco.id);
}
