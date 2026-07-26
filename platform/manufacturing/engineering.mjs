// Engineering master data: bills of material, routings and engineering change.
//
// Versioning rule (the reason this file exists at all):
//   A BOM or routing is never edited in place once approved. `revise()` creates
//   a NEW version row that points back at its predecessor and marks the
//   predecessor `superseded`. A manufacturing order records the exact version it
//   was released against, so changing engineering data can never rewrite the
//   history of an order that already consumed material.

import {
  ManufacturingError, makeId, nowIso, positive, nonNegative,
  requireActor, requireCompany, round6, scopedRow, assertState,
} from './shared.mjs';

const EDITABLE_STATES = ['draft'];

function assertProduct(db, productId, companyId, label) {
  const row = db.prepare('SELECT id, company_id FROM product_variants WHERE id = ?').get(productId);
  if (!row) throw new ManufacturingError(`${label} not found: ${productId}`, 'RECORD_NOT_FOUND', 404);
  if (row.company_id !== companyId) {
    throw new ManufacturingError(`${label} is outside the active company`, 'COMPANY_SCOPE_VIOLATION', 403);
  }
  return row;
}

// --------------------------------------------------------------------------
// Bills of material
// --------------------------------------------------------------------------

export function createBom(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  assertProduct(db, payload.product_id, companyId, 'BOM product');
  const quantity = positive(payload.quantity, 'BOM quantity');
  const bomType = payload.bom_type || 'normal';
  if (!['normal', 'phantom', 'subcontract', 'configurable'].includes(bomType)) {
    throw new ManufacturingError(`unsupported bom_type: ${bomType}`, 'INPUT_INVALID');
  }
  if (payload.routing_id) scopedRow(db, 'routings', payload.routing_id, companyId, 'routing');

  const code = String(payload.code || '').trim() || `BOM-${String(payload.product_id).slice(-8).toUpperCase()}`;
  const version = Number(payload.version || 1);
  const duplicate = db.prepare(
    'SELECT id FROM bom_headers WHERE company_id = ? AND code = ? AND version = ?',
  ).get(companyId, code, version);
  if (duplicate) {
    throw new ManufacturingError(`BOM ${code} v${version} already exists`, 'BOM_DUPLICATE', 409);
  }

  const id = payload.id || makeId('bom');
  const now = nowIso();
  db.prepare(`
    INSERT INTO bom_headers (
      id, company_id, product_id, code, version, revision_of_id, bom_type, quantity,
      uom_id, routing_id, status, effective_from, effective_to, scrap_percent,
      yield_percent, engineering_change_id, attachments_json, approved_by, approved_at,
      created_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
  `).run(
    id, companyId, payload.product_id, code, version, payload.revision_of_id || null,
    bomType, quantity, payload.uom_id || null, payload.routing_id || null,
    payload.effective_from || null, payload.effective_to || null,
    nonNegative(payload.scrap_percent, 'scrap_percent'),
    positive(payload.yield_percent || 100, 'yield_percent'),
    payload.engineering_change_id || null,
    JSON.stringify(payload.attachments || []),
    now, actor, now,
  );

  replaceBomLines(db, id, companyId, payload.lines || []);
  return getBom(db, id, companyId);
}

function replaceBomLines(db, bomId, companyId, lines) {
  db.prepare('DELETE FROM bom_lines WHERE bom_id = ?').run(bomId);
  const insert = db.prepare(`
    INSERT INTO bom_lines (
      id, bom_id, company_id, sequence, line_type, product_id, quantity, uom_id,
      scrap_percent, operation_ref, is_phantom, substitute_of_line_id,
      cost_share_percent, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = nowIso();
  let sequence = 10;
  const created = [];
  for (const line of lines) {
    assertProduct(db, line.product_id, companyId, 'BOM component');
    const lineType = line.line_type || 'component';
    if (!['component', 'by_product', 'co_product'].includes(lineType)) {
      throw new ManufacturingError(`unsupported BOM line_type: ${lineType}`, 'INPUT_INVALID');
    }
    const lineId = line.id || makeId('boml');
    insert.run(
      lineId, bomId, companyId, Number(line.sequence || sequence), lineType,
      line.product_id, positive(line.quantity, 'BOM line quantity'), line.uom_id || null,
      nonNegative(line.scrap_percent, 'BOM line scrap_percent'), line.operation_ref || null,
      line.is_phantom ? 1 : 0, line.substitute_of_line_id || null,
      nonNegative(line.cost_share_percent, 'cost_share_percent'), line.notes || null, now,
    );
    created.push(lineId);
    sequence += 10;
  }
  return created;
}

export function updateBomLines(db, payload = {}) {
  const companyId = requireCompany(payload);
  const bom = scopedRow(db, 'bom_headers', payload.bom_id, companyId, 'BOM');
  assertState(bom.status, EDITABLE_STATES, 'BOM');
  replaceBomLines(db, bom.id, companyId, payload.lines || []);
  db.prepare('UPDATE bom_headers SET updated_at = ? WHERE id = ?').run(nowIso(), bom.id);
  return getBom(db, bom.id, companyId);
}

export function approveBom(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const bom = scopedRow(db, 'bom_headers', payload.bom_id, companyId, 'BOM');
  assertState(bom.status, ['draft'], 'BOM');
  const lineCount = db.prepare('SELECT COUNT(*) AS n FROM bom_lines WHERE bom_id = ?').get(bom.id).n;
  if (!lineCount) {
    throw new ManufacturingError('a BOM must have at least one line before approval', 'BOM_EMPTY');
  }
  if (bom.engineering_change_id) {
    const change = scopedRow(db, 'engineering_changes', bom.engineering_change_id, companyId, 'engineering change');
    if (change.status !== 'approved' && change.status !== 'applied') {
      throw new ManufacturingError(
        'the linked engineering change must be approved before this BOM version can be approved',
        'ENGINEERING_CHANGE_NOT_APPROVED',
      );
    }
  }
  const now = nowIso();
  db.prepare(`
    UPDATE bom_headers SET status = 'approved', approved_by = ?, approved_at = ?,
      effective_from = COALESCE(effective_from, ?), updated_at = ? WHERE id = ?
  `).run(actor, now, payload.effective_from || now, now, bom.id);
  if (bom.revision_of_id) {
    db.prepare(`
      UPDATE bom_headers SET status = 'superseded', effective_to = COALESCE(effective_to, ?), updated_at = ?
      WHERE id = ? AND status = 'approved'
    `).run(now, now, bom.revision_of_id);
  }
  return getBom(db, bom.id, companyId);
}

export function reviseBom(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const source = scopedRow(db, 'bom_headers', payload.bom_id, companyId, 'BOM');
  if (source.status === 'obsolete') {
    throw new ManufacturingError('an obsolete BOM cannot be revised', 'MANUFACTURING_STATE_INVALID');
  }
  const nextVersion = Number(db.prepare(
    'SELECT COALESCE(MAX(version), 0) AS v FROM bom_headers WHERE company_id = ? AND code = ?',
  ).get(companyId, source.code).v) + 1;

  const existingLines = db.prepare('SELECT * FROM bom_lines WHERE bom_id = ? ORDER BY sequence').all(source.id);
  const lines = payload.lines || existingLines.map((line) => ({
    sequence: line.sequence,
    line_type: line.line_type,
    product_id: line.product_id,
    quantity: line.quantity,
    uom_id: line.uom_id,
    scrap_percent: line.scrap_percent,
    operation_ref: line.operation_ref,
    is_phantom: line.is_phantom,
    cost_share_percent: line.cost_share_percent,
    notes: line.notes,
  }));

  return createBom(db, {
    company_id: companyId,
    actor,
    actor_id: actor,
    product_id: payload.product_id || source.product_id,
    code: source.code,
    version: nextVersion,
    revision_of_id: source.id,
    bom_type: payload.bom_type || source.bom_type,
    quantity: payload.quantity || source.quantity,
    uom_id: payload.uom_id || source.uom_id,
    routing_id: payload.routing_id || source.routing_id,
    scrap_percent: payload.scrap_percent ?? source.scrap_percent,
    yield_percent: payload.yield_percent ?? source.yield_percent,
    engineering_change_id: payload.engineering_change_id || null,
    effective_from: payload.effective_from || null,
    lines,
  });
}

export function getBom(db, id, companyId) {
  const header = scopedRow(db, 'bom_headers', id, companyId, 'BOM');
  const lines = db.prepare('SELECT * FROM bom_lines WHERE bom_id = ? ORDER BY sequence, id').all(id);
  return { ...header, lines };
}

/**
 * The BOM that is authoritative for a product on a given date: approved,
 * inside its effective window, highest version. Returns null when none applies
 * — the caller decides whether that is an error.
 */
export function resolveEffectiveBom(db, { company_id, product_id, on_date = null, bom_id = null }) {
  if (bom_id) {
    const explicit = scopedRow(db, 'bom_headers', bom_id, company_id, 'BOM');
    return explicit;
  }
  const date = on_date || nowIso();
  return db.prepare(`
    SELECT * FROM bom_headers
    WHERE company_id = ? AND product_id = ? AND status = 'approved'
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY version DESC
    LIMIT 1
  `).get(company_id, product_id, date, date) || null;
}

/**
 * Deterministic multi-level explosion.
 *
 * - Phantom components (line flag or a phantom child BOM) are not requirements
 *   themselves; their own children are exploded in their place.
 * - Scrap and yield inflate the required quantity: a 5% line scrap means 5%
 *   more must be issued for the same output.
 * - `bom_path` makes each requirement addressable and is what stops two
 *   different branches of the tree from colliding on the same product.
 * - `maxDepth` guards against a BOM that (incorrectly) contains itself.
 */
export function explodeBom(db, {
  company_id,
  bom,
  quantity,
  on_date = null,
  maxDepth = 12,
}) {
  if (!bom) throw new ManufacturingError('a BOM is required to explode', 'BOM_REQUIRED');
  const requirements = [];
  const byProducts = [];

  const walk = (currentBom, multiplier, depth, path, seen) => {
    if (depth > maxDepth) {
      throw new ManufacturingError('BOM explosion exceeded maximum depth (possible cycle)', 'BOM_CYCLE');
    }
    if (seen.has(currentBom.id)) {
      throw new ManufacturingError(`BOM cycle detected at ${currentBom.code}`, 'BOM_CYCLE');
    }
    const nextSeen = new Set(seen).add(currentBom.id);

    const batch = Number(currentBom.quantity) || 1;
    const yieldFactor = Number(currentBom.yield_percent || 100) / 100;
    const headerScrap = 1 + (Number(currentBom.scrap_percent || 0) / 100);
    const lines = db.prepare('SELECT * FROM bom_lines WHERE bom_id = ? ORDER BY sequence, id').all(currentBom.id);

    for (const line of lines) {
      const lineScrap = 1 + (Number(line.scrap_percent || 0) / 100);
      const perUnit = (Number(line.quantity) / batch) * lineScrap * headerScrap / yieldFactor;
      const required = round6(perUnit * multiplier);
      const linePath = `${path}/${line.id}`;

      if (line.line_type === 'by_product' || line.line_type === 'co_product') {
        byProducts.push({
          bom_line_id: line.id,
          product_id: line.product_id,
          uom_id: line.uom_id,
          quantity: required,
          line_type: line.line_type,
          cost_share_percent: Number(line.cost_share_percent || 0),
          bom_path: linePath,
        });
        continue;
      }

      const childBom = resolveEffectiveBom(db, { company_id, product_id: line.product_id, on_date });
      const treatAsPhantom = Number(line.is_phantom) === 1 || childBom?.bom_type === 'phantom';
      if (treatAsPhantom && childBom) {
        walk(childBom, required, depth + 1, linePath, nextSeen);
        continue;
      }
      if (treatAsPhantom && !childBom) {
        throw new ManufacturingError(
          `component ${line.product_id} is marked phantom but has no approved BOM to explode`,
          'BOM_PHANTOM_UNRESOLVED',
        );
      }

      requirements.push({
        bom_line_id: line.id,
        product_id: line.product_id,
        uom_id: line.uom_id,
        quantity: required,
        operation_ref: line.operation_ref,
        bom_path: linePath,
        depth,
      });
    }
  };

  walk(bom, positive(quantity, 'explosion quantity'), 0, bom.id, new Set());

  // Two branches can legitimately reach the same product. They stay separate
  // rows (distinct bom_path) so lineage back to the BOM line is never lost.
  return { requirements, byProducts };
}

// --------------------------------------------------------------------------
// Routings
// --------------------------------------------------------------------------

export function createRouting(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const name = String(payload.name || '').trim();
  if (!name) throw new ManufacturingError('routing name is required', 'INPUT_MISSING_FIELD');
  const code = String(payload.code || '').trim() || `RT-${name.slice(0, 12).toUpperCase().replace(/\s+/g, '-')}`;
  const version = Number(payload.version || 1);
  const duplicate = db.prepare(
    'SELECT id FROM routings WHERE company_id = ? AND code = ? AND version = ?',
  ).get(companyId, code, version);
  if (duplicate) throw new ManufacturingError(`routing ${code} v${version} already exists`, 'ROUTING_DUPLICATE', 409);

  const id = payload.id || makeId('rt');
  const now = nowIso();
  db.prepare(`
    INSERT INTO routings (
      id, company_id, code, name, version, revision_of_id, status, effective_from,
      effective_to, engineering_change_id, approved_by, approved_at, created_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL, ?, ?, ?)
  `).run(
    id, companyId, code, name, version, payload.revision_of_id || null,
    payload.effective_from || null, payload.effective_to || null,
    payload.engineering_change_id || null, now, actor, now,
  );

  const insertOperation = db.prepare(`
    INSERT INTO routing_operations (
      id, routing_id, company_id, sequence, name, work_center_id, skill_requirement,
      setup_minutes, run_minutes_per_unit, cleanup_minutes, queue_minutes, move_minutes,
      is_subcontracted, subcontractor_party_id, quality_plan_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInstruction = db.prepare(`
    INSERT INTO work_instructions (
      id, company_id, routing_operation_id, instruction_type, title, body, attachment_ref, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let sequence = 10;
  for (const operation of payload.operations || []) {
    if (operation.work_center_id) scopedRow(db, 'work_centers', operation.work_center_id, companyId, 'work centre');
    const operationId = operation.id || makeId('rtop');
    insertOperation.run(
      operationId, id, companyId, Number(operation.sequence || sequence),
      String(operation.name || `Operation ${sequence / 10}`),
      operation.work_center_id || null, operation.skill_requirement || null,
      nonNegative(operation.setup_minutes, 'setup_minutes'),
      nonNegative(operation.run_minutes_per_unit, 'run_minutes_per_unit'),
      nonNegative(operation.cleanup_minutes, 'cleanup_minutes'),
      nonNegative(operation.queue_minutes, 'queue_minutes'),
      nonNegative(operation.move_minutes, 'move_minutes'),
      operation.is_subcontracted ? 1 : 0, operation.subcontractor_party_id || null,
      operation.quality_plan_id || null, now,
    );
    for (const instruction of operation.instructions || []) {
      insertInstruction.run(
        makeId('wins'), companyId, operationId,
        instruction.instruction_type || 'work',
        String(instruction.title || 'Instruction'),
        instruction.body || null, instruction.attachment_ref || null, now,
      );
    }
    sequence += 10;
  }
  return getRouting(db, id, companyId);
}

export function approveRouting(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const routing = scopedRow(db, 'routings', payload.routing_id, companyId, 'routing');
  assertState(routing.status, ['draft'], 'routing');
  const operationCount = db.prepare('SELECT COUNT(*) AS n FROM routing_operations WHERE routing_id = ?').get(routing.id).n;
  if (!operationCount) {
    throw new ManufacturingError('a routing must have at least one operation before approval', 'ROUTING_EMPTY');
  }
  const now = nowIso();
  db.prepare(`
    UPDATE routings SET status = 'approved', approved_by = ?, approved_at = ?,
      effective_from = COALESCE(effective_from, ?), updated_at = ? WHERE id = ?
  `).run(actor, now, payload.effective_from || now, now, routing.id);
  if (routing.revision_of_id) {
    db.prepare(`
      UPDATE routings SET status = 'superseded', effective_to = COALESCE(effective_to, ?), updated_at = ?
      WHERE id = ? AND status = 'approved'
    `).run(now, now, routing.revision_of_id);
  }
  return getRouting(db, routing.id, companyId);
}

export function getRouting(db, id, companyId) {
  const header = scopedRow(db, 'routings', id, companyId, 'routing');
  const operations = db.prepare(
    'SELECT * FROM routing_operations WHERE routing_id = ? ORDER BY sequence, id',
  ).all(id);
  const instructions = db.prepare(`
    SELECT wi.* FROM work_instructions wi
    JOIN routing_operations op ON op.id = wi.routing_operation_id
    WHERE op.routing_id = ?
    ORDER BY op.sequence, wi.id
  `).all(id);
  return {
    ...header,
    operations: operations.map((operation) => ({
      ...operation,
      instructions: instructions.filter((row) => row.routing_operation_id === operation.id),
    })),
  };
}

// --------------------------------------------------------------------------
// Engineering change
// --------------------------------------------------------------------------

export function createEngineeringChange(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const title = String(payload.title || '').trim();
  if (!title) throw new ManufacturingError('engineering change title is required', 'INPUT_MISSING_FIELD');
  const reference = String(payload.reference || '').trim()
    || `ECO-${String(db.prepare('SELECT COUNT(*) AS n FROM engineering_changes WHERE company_id = ?').get(companyId).n + 1).padStart(5, '0')}`;
  const id = payload.id || makeId('eco');
  const now = nowIso();
  db.prepare(`
    INSERT INTO engineering_changes (
      id, company_id, reference, title, description, status, effective_from,
      requested_by, approved_by, approved_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, NULL, NULL, ?, ?)
  `).run(id, companyId, reference, title, payload.description || null, payload.effective_from || null, actor, now, now);
  return scopedRow(db, 'engineering_changes', id, companyId, 'engineering change');
}

export function approveEngineeringChange(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const change = scopedRow(db, 'engineering_changes', payload.change_id, companyId, 'engineering change');
  assertState(change.status, ['draft', 'submitted'], 'engineering change');
  if (change.requested_by === actor && !payload.allow_self_approval) {
    throw new ManufacturingError(
      'an engineering change cannot be approved by the person who requested it',
      'SEGREGATION_OF_DUTIES',
      403,
    );
  }
  const now = nowIso();
  db.prepare(`
    UPDATE engineering_changes SET status = 'approved', approved_by = ?, approved_at = ?,
      effective_from = COALESCE(effective_from, ?), updated_at = ? WHERE id = ?
  `).run(actor, now, payload.effective_from || now, now, change.id);
  return scopedRow(db, 'engineering_changes', change.id, companyId, 'engineering change');
}
