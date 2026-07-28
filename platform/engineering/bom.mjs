// Versioned Bill of Materials authority — Checkpoint D2.
//
// Immutability rule enforced here:
//   A BOM version is editable ONLY while `state = 'draft'`. Once submitted it
//   is locked to reviewers; once approved it is frozen. Once a production
//   order has consumed it (`consumed_at` set) it can never be edited or
//   rejected — the only legal path forward is a NEW revision plus explicit
//   supersession. This is what stops a posted production order's bill from
//   changing underneath it.

'use strict';

import crypto from 'node:crypto';

export class EngineeringError extends Error {
  constructor(message, code = 'ENGINEERING_RULE_VIOLATION', statusCode = 422) {
    super(message);
    this.name = 'EngineeringError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function fail(message, code, statusCode) {
  throw new EngineeringError(message, code, statusCode);
}

export function requireFields(input, fields) {
  for (const field of fields) {
    const value = input[field];
    if (value === undefined || value === null || value === '') {
      fail(`${field} is required`, 'INPUT_MISSING_FIELD', 400);
    }
  }
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

function variant(db, productId, companyId) {
  const row = db.prepare(
    "SELECT id FROM product_variants WHERE id = ? AND company_id IN (?, '*')",
  ).get(productId, companyId);
  if (!row) fail(`product variant not found: ${productId}`, 'PRODUCT_NOT_FOUND', 404);
  return row;
}

export function getBomVersion(db, versionId, companyId) {
  const row = db.prepare('SELECT * FROM bom_versions WHERE id = ? AND company_id = ?').get(versionId, companyId);
  if (!row) fail('BOM version not found', 'BOM_VERSION_NOT_FOUND', 404);
  return row;
}

/**
 * A version may only be structurally edited while it is a draft that no
 * production order has consumed.
 */
function assertEditable(version) {
  if (version.consumed_at) {
    fail(
      'this BOM version has been consumed by production and is immutable — raise a new revision',
      'BOM_VERSION_IMMUTABLE',
      409,
    );
  }
  if (version.state !== 'draft') {
    fail(
      `a ${version.state} BOM version cannot be edited — raise a new revision`,
      'BOM_VERSION_NOT_DRAFT',
      409,
    );
  }
}

// ---------------------------------------------------------------------------
// BOM header + first version
// ---------------------------------------------------------------------------

export function createBom(db, input = {}) {
  requireFields(input, ['product_id']);
  const companyId = input.company_id;
  variant(db, input.product_id, companyId);

  const bomType = String(input.bom_type || 'manufacturing');
  if (!['manufacturing', 'phantom', 'subcontract'].includes(bomType)) {
    fail(`unsupported BOM type: ${bomType}`, 'BOM_TYPE_INVALID', 400);
  }
  const quantity = Number(input.quantity || 1);
  if (!(quantity > 0)) fail('BOM quantity must be positive', 'BOM_QUANTITY_INVALID', 400);
  const yieldPercent = Number(input.yield_percent || 100);
  if (!(yieldPercent > 0) || yieldPercent > 100) {
    fail('BOM yield percent must be greater than 0 and at most 100', 'BOM_YIELD_INVALID', 400);
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM boms WHERE company_id = ?').get(companyId).c;
  const code = String(input.code || `BOM-${String(count + 1).padStart(5, '0')}`);
  if (db.prepare('SELECT id FROM boms WHERE company_id = ? AND code = ?').get(companyId, code)) {
    fail(`BOM code ${code} already exists`, 'BOM_CODE_DUPLICATE', 409);
  }

  const bomId = makeId('bom');
  const versionId = makeId('bomv');
  const stamp = now();

  db.prepare(`
    INSERT INTO boms (id, company_id, branch_id, code, product_id, name_ar, name_en,
      bom_type, uom_id, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    bomId, companyId, input.branch_id || null, code, input.product_id,
    String(input.name_ar || ''), String(input.name_en || ''), bomType,
    input.uom_id || null, input.actor || null, stamp, stamp,
  );

  db.prepare(`
    INSERT INTO bom_versions (id, company_id, bom_id, revision, quantity, state,
      effective_from, effective_to, yield_percent, drawings, work_instructions, notes,
      created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, companyId, bomId, quantity,
    input.effective_from || null, input.effective_to || null, yieldPercent,
    JSON.stringify(Array.isArray(input.drawings) ? input.drawings : []),
    String(input.work_instructions || ''), String(input.notes || ''), stamp, stamp,
  );

  for (const [index, line] of (Array.isArray(input.lines) ? input.lines : []).entries()) {
    addBomLine(db, { ...line, company_id: companyId, bom_version_id: versionId, sequence: line.sequence || (index + 1) * 10, actor: input.actor });
  }
  return readBom(db, bomId, companyId);
}

export function addBomLine(db, input = {}) {
  requireFields(input, ['bom_version_id', 'component_id', 'quantity']);
  const companyId = input.company_id;
  const version = getBomVersion(db, input.bom_version_id, companyId);
  assertEditable(version);
  variant(db, input.component_id, companyId);

  const quantity = Number(input.quantity);
  if (!(quantity > 0)) fail('BOM line quantity must be positive', 'BOM_LINE_QUANTITY_INVALID', 400);
  const lineType = String(input.line_type || 'component');
  if (!['component', 'by_product', 'co_product'].includes(lineType)) {
    fail(`unsupported BOM line type: ${lineType}`, 'BOM_LINE_TYPE_INVALID', 400);
  }
  const scrap = Number(input.scrap_factor_percent || 0);
  if (scrap < 0 || scrap >= 100) {
    fail('scrap factor must be between 0 and 100', 'BOM_SCRAP_FACTOR_INVALID', 400);
  }

  // A phantom line must point at a real child BOM, otherwise explosion has
  // nothing to expand into and the requirement silently disappears.
  const isPhantom = input.is_phantom ? 1 : 0;
  let childBomId = input.child_bom_id || null;
  if (isPhantom) {
    if (!childBomId) {
      childBomId = db.prepare(
        "SELECT id FROM boms WHERE company_id = ? AND product_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1",
      ).get(companyId, input.component_id)?.id || null;
    }
    if (!childBomId) {
      fail('a phantom BOM line requires a child BOM for the component', 'BOM_PHANTOM_CHILD_REQUIRED', 400);
    }
  }

  // A component cannot contain itself — that is an infinite explosion.
  const bom = db.prepare('SELECT product_id FROM boms WHERE id = ?').get(version.bom_id);
  if (bom && String(bom.product_id) === String(input.component_id) && lineType === 'component') {
    fail('a BOM cannot consume its own product as a component', 'BOM_SELF_REFERENCE', 409);
  }

  const id = makeId('boml');
  db.prepare(`
    INSERT INTO bom_lines (id, company_id, bom_version_id, sequence, line_type, component_id,
      uom_id, quantity, scrap_factor_percent, is_phantom, child_bom_id, cost_share_percent,
      operation_seq, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, version.id, Number(input.sequence || 10), lineType, input.component_id,
    input.uom_id || null, quantity, scrap, isPhantom, childBomId,
    Number(input.cost_share_percent || 0),
    input.operation_seq !== undefined && input.operation_seq !== null ? Number(input.operation_seq) : null,
    String(input.notes || ''), now(),
  );

  for (const sub of (Array.isArray(input.substitutes) ? input.substitutes : [])) {
    variant(db, sub.substitute_id, companyId);
    db.prepare(`
      INSERT INTO bom_line_substitutes (id, company_id, bom_line_id, substitute_id, conversion_ratio, priority, is_approved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bom_line_id, substitute_id) DO NOTHING
    `).run(
      makeId('bomsub'), companyId, id, sub.substitute_id,
      Number(sub.conversion_ratio || 1), Number(sub.priority || 10),
      sub.is_approved === false ? 0 : 1, now(),
    );
  }
  return db.prepare('SELECT * FROM bom_lines WHERE id = ?').get(id);
}

export function removeBomLine(db, input = {}) {
  requireFields(input, ['line_id']);
  const companyId = input.company_id;
  const line = db.prepare('SELECT * FROM bom_lines WHERE id = ? AND company_id = ?').get(input.line_id, companyId);
  if (!line) fail('BOM line not found', 'BOM_LINE_NOT_FOUND', 404);
  assertEditable(getBomVersion(db, line.bom_version_id, companyId));
  db.prepare('DELETE FROM bom_lines WHERE id = ?').run(line.id);
  return { removed: 1, line_id: line.id, bom_version_id: line.bom_version_id };
}

// ---------------------------------------------------------------------------
// Lifecycle: draft -> review -> approved -> superseded
// ---------------------------------------------------------------------------

export function submitBom(db, input = {}) {
  requireFields(input, ['bom_version_id']);
  const companyId = input.company_id;
  const version = getBomVersion(db, input.bom_version_id, companyId);
  if (version.state !== 'draft') {
    fail(`only a draft BOM version can be submitted (state is ${version.state})`, 'BOM_VERSION_NOT_DRAFT', 409);
  }
  const lines = db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE bom_version_id = ? AND line_type = 'component'")
    .get(version.id).c;
  if (!lines) fail('a BOM version must have at least one component line', 'BOM_VERSION_EMPTY', 409);

  const stamp = now();
  db.prepare("UPDATE bom_versions SET state = 'review', submitted_by = ?, submitted_at = ?, updated_at = ? WHERE id = ?")
    .run(input.actor || null, stamp, stamp, version.id);
  return getBomVersion(db, version.id, companyId);
}

export function approveBom(db, input = {}) {
  requireFields(input, ['bom_version_id']);
  const companyId = input.company_id;
  const version = getBomVersion(db, input.bom_version_id, companyId);
  if (version.state !== 'review') {
    fail(`only a version under review can be approved (state is ${version.state})`, 'BOM_VERSION_NOT_IN_REVIEW', 409);
  }
  // The submitter cannot also approve — separation of duties.
  if (version.submitted_by && input.actor && String(version.submitted_by) === String(input.actor)) {
    fail('a BOM version cannot be approved by the same actor who submitted it', 'BOM_SELF_APPROVAL_DENIED', 403);
  }

  const stamp = now();
  db.prepare("UPDATE bom_versions SET state = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?")
    .run(input.actor || null, stamp, stamp, version.id);

  // Approving a new revision automatically supersedes the previous approved
  // one, so exactly one version is effective at a time.
  const previous = db.prepare(`
    SELECT id FROM bom_versions
    WHERE bom_id = ? AND state = 'approved' AND id != ?
    ORDER BY revision DESC LIMIT 1
  `).get(version.bom_id, version.id);
  if (previous) {
    db.prepare("UPDATE bom_versions SET state = 'superseded', superseded_by_id = ?, superseded_at = ?, updated_at = ? WHERE id = ?")
      .run(version.id, stamp, stamp, previous.id);
  }
  return { ...getBomVersion(db, version.id, companyId), superseded_version_id: previous ? previous.id : null };
}

export function rejectBom(db, input = {}) {
  requireFields(input, ['bom_version_id']);
  const companyId = input.company_id;
  const version = getBomVersion(db, input.bom_version_id, companyId);
  if (version.consumed_at) {
    fail('a consumed BOM version cannot be rejected', 'BOM_VERSION_IMMUTABLE', 409);
  }
  if (version.state !== 'review') {
    fail(`only a version under review can be rejected (state is ${version.state})`, 'BOM_VERSION_NOT_IN_REVIEW', 409);
  }
  const stamp = now();
  db.prepare("UPDATE bom_versions SET state = 'rejected', rejected_reason = ?, updated_at = ? WHERE id = ?")
    .run(String(input.reason || ''), stamp, version.id);
  return getBomVersion(db, version.id, companyId);
}

export function newBomRevision(db, input = {}) {
  requireFields(input, ['bom_id']);
  const companyId = input.company_id;
  const bom = db.prepare('SELECT * FROM boms WHERE id = ? AND company_id = ?').get(input.bom_id, companyId);
  if (!bom) fail('BOM not found', 'BOM_NOT_FOUND', 404);

  const open = db.prepare("SELECT id FROM bom_versions WHERE bom_id = ? AND state IN ('draft','review')").get(bom.id);
  if (open) fail('this BOM already has an open draft or in-review revision', 'BOM_REVISION_ALREADY_OPEN', 409);

  const latest = db.prepare('SELECT * FROM bom_versions WHERE bom_id = ? ORDER BY revision DESC LIMIT 1').get(bom.id);
  const revision = (latest ? latest.revision : 0) + 1;
  const id = makeId('bomv');
  const stamp = now();

  db.prepare(`
    INSERT INTO bom_versions (id, company_id, bom_id, revision, quantity, state,
      effective_from, yield_percent, drawings, work_instructions, notes, eco_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, bom.id, revision,
    Number(input.quantity || (latest ? latest.quantity : 1)),
    input.effective_from || null,
    Number(input.yield_percent || (latest ? latest.yield_percent : 100)),
    latest ? latest.drawings : '[]',
    latest ? latest.work_instructions : '',
    String(input.notes || ''), input.eco_id || null, stamp, stamp,
  );

  // Copy the previous version's lines so a revision starts from the current
  // bill rather than an empty one.
  if (latest && input.copy_lines !== false) {
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
  return getBomVersion(db, id, companyId);
}

export function supersedeBom(db, input = {}) {
  requireFields(input, ['bom_version_id', 'superseded_by_id']);
  const companyId = input.company_id;
  const version = getBomVersion(db, input.bom_version_id, companyId);
  const replacement = getBomVersion(db, input.superseded_by_id, companyId);
  if (version.id === replacement.id) {
    fail('a BOM version cannot supersede itself', 'BOM_SUPERSEDE_SELF', 400);
  }
  if (replacement.state !== 'approved') {
    fail('the replacing BOM version must be approved', 'BOM_NOT_APPROVED', 409);
  }
  if (version.state === 'superseded') {
    fail('this BOM version is already superseded', 'BOM_ALREADY_SUPERSEDED', 409);
  }
  const stamp = now();
  db.prepare("UPDATE bom_versions SET state = 'superseded', superseded_by_id = ?, superseded_at = ?, updated_at = ? WHERE id = ?")
    .run(replacement.id, stamp, stamp, version.id);
  return getBomVersion(db, version.id, companyId);
}

/**
 * Resolve the single effective approved version for a BOM at a given date.
 * Manufacturing calls this — it must never pick a draft or superseded bill.
 */
export function effectiveBomVersion(db, companyId, bomId, onDate = null) {
  const date = onDate || now().slice(0, 10);
  return db.prepare(`
    SELECT * FROM bom_versions
    WHERE company_id = ? AND bom_id = ? AND state = 'approved'
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY revision DESC LIMIT 1
  `).get(companyId, bomId, date, date) || null;
}

export function effectiveBomForProduct(db, companyId, productId, onDate = null) {
  const bom = db.prepare(
    'SELECT id FROM boms WHERE company_id = ? AND product_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1',
  ).get(companyId, productId);
  if (!bom) return null;
  return effectiveBomVersion(db, companyId, bom.id, onDate);
}

/** Mark a version consumed the first time production uses it. Idempotent. */
export function markBomConsumed(db, companyId, versionId) {
  const version = getBomVersion(db, versionId, companyId);
  if (version.state !== 'approved') {
    fail('production requires an approved BOM version', 'BOM_NOT_APPROVED', 409);
  }
  if (!version.consumed_at) {
    db.prepare('UPDATE bom_versions SET consumed_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), version.id);
  }
  return getBomVersion(db, versionId, companyId);
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export function readBom(db, bomId, companyId) {
  const bom = db.prepare('SELECT * FROM boms WHERE id = ? AND company_id = ?').get(bomId, companyId);
  if (!bom) fail('BOM not found', 'BOM_NOT_FOUND', 404);
  const versions = db.prepare('SELECT * FROM bom_versions WHERE bom_id = ? ORDER BY revision DESC').all(bom.id);
  return {
    ...bom,
    versions: versions.map((version) => ({
      ...version,
      lines: db.prepare('SELECT * FROM bom_lines WHERE bom_version_id = ? ORDER BY sequence').all(version.id),
    })),
    effective_version: effectiveBomVersion(db, companyId, bom.id),
  };
}

export function listBoms(db, ctx = {}, query = {}) {
  const filters = ['b.company_id = ?'];
  const params = [ctx.companyId];
  if (query.product_id) { filters.push('b.product_id = ?'); params.push(String(query.product_id)); }
  if (query.bom_type) { filters.push('b.bom_type = ?'); params.push(String(query.bom_type)); }
  const limit = Math.min(Number(query.limit || 200), 500);
  return db.prepare(`
    SELECT b.*, v.id AS effective_version_id, v.revision AS effective_revision, v.state AS effective_state
    FROM boms b
    LEFT JOIN bom_versions v ON v.bom_id = b.id AND v.state = 'approved'
    WHERE ${filters.join(' AND ')}
    ORDER BY b.created_at DESC LIMIT ?
  `).all(...params, limit);
}
