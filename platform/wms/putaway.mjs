// BUILD-09 governed putaway rules and scan-driven task orchestration.
'use strict';

import crypto from 'node:crypto';

export class PutawayError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'PutawayError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
const round = (value) => Number(Number(value || 0).toFixed(4));

function scope(input) {
  if (!input.company_id) throw new PutawayError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new PutawayError('Warehouse scope is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function assertWarehouse(db, current) {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND company_id=?').get(current.warehouseId, current.companyId)) {
    throw new PutawayError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
  }
}

function ruleInScope(db, id, current) {
  const row = db.prepare('SELECT * FROM wms_putaway_rules WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new PutawayError('Putaway rule is outside warehouse scope', 'PUTAWAY_RULE_SCOPE_DENIED', 403);
  return row;
}

function recommendationInScope(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_putaway_recommendations WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new PutawayError('Putaway recommendation is outside warehouse scope', 'PUTAWAY_SCOPE_DENIED', 403);
  const lines = db.prepare('SELECT * FROM wms_putaway_recommendation_lines WHERE recommendation_id=? ORDER BY sequence').all(id);
  return {
    id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id,
    sourceLocationId: row.source_location_id, productId: row.product_id,
    lotId: row.lot_id, serialId: row.serial_id, quantity: Number(row.quantity),
    unitWeight: Number(row.unit_weight), unitVolume: Number(row.unit_volume),
    qualityStatus: row.quality_status, selectedRuleId: row.selected_rule_id,
    status: row.status, exceptionReason: row.exception_reason,
    requestedBy: row.requested_by, acceptedBy: row.accepted_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
    lines: lines.map((line) => ({
      id: line.id, destinationLocationId: line.destination_location_id,
      quantity: Number(line.quantity), capacityBefore: line.capacity_before,
      capacityAfter: line.capacity_after, sequence: line.sequence,
      restrictionOverride: !!line.restriction_override,
    })),
  };
}

function taskInScope(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_warehouse_tasks WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new PutawayError('Warehouse task is outside warehouse scope', 'WAREHOUSE_TASK_SCOPE_DENIED', 403);
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id,
    warehouseId: row.warehouse_id, taskType: row.task_type,
    sourceRecordType: row.source_record_type, sourceRecordId: row.source_record_id,
    productId: row.product_id, lotId: row.lot_id, serialId: row.serial_id,
    sourceLocationId: row.source_location_id, destinationLocationId: row.destination_location_id,
    quantity: Number(row.quantity), status: row.status, priority: row.priority,
    assignedTo: row.assigned_to, sourceScan: row.source_scan,
    destinationScan: row.destination_scan, canonicalAction: row.canonical_action,
    canonicalRequest: parse(row.canonical_request_json), canonicalResultId: row.canonical_result_id,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createPutawayRule(db, input) {
  const current = scope(input);
  assertWarehouse(db, current);
  if (!input.name) throw new PutawayError('Putaway rule name is required', 'INVALID_PUTAWAY_RULE');
  if (!input.destination_zone_id && !input.destination_location_id) {
    throw new PutawayError('Destination zone or location is required', 'PUTAWAY_DESTINATION_REQUIRED');
  }
  if (input.destination_zone_id && !db.prepare('SELECT 1 FROM wms_zones WHERE id=? AND company_id=? AND warehouse_id=?').get(input.destination_zone_id, current.companyId, current.warehouseId)) {
    throw new PutawayError('Destination zone is outside scope', 'ZONE_SCOPE_DENIED', 403);
  }
  if (input.destination_location_id && !db.prepare(`SELECT 1 FROM wms_location_profiles WHERE location_id=? AND company_id=? AND warehouse_id=?`).get(input.destination_location_id, current.companyId, current.warehouseId)) {
    throw new PutawayError('Destination location is outside scope', 'LOCATION_SCOPE_DENIED', 403);
  }
  const id = uid('parule');
  const stamp = now();
  db.prepare(`INSERT INTO wms_putaway_rules(
    id,company_id,warehouse_id,name,rule_type,product_id,category_id,supplier_id,
    receipt_type,lot_pattern,destination_zone_id,destination_location_id,
    temperature_min,temperature_max,hazard_class,requires_quality_status,
    strategy,priority,allow_split,is_active,conditions_json,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(
    id, current.companyId, current.warehouseId, input.name,
    input.rule_type || 'fallback', input.product_id || null, input.category_id || null,
    input.supplier_id || null, input.receipt_type || null, input.lot_pattern || null,
    input.destination_zone_id || null, input.destination_location_id || null,
    input.temperature_min ?? null, input.temperature_max ?? null,
    input.hazard_class || null, input.requires_quality_status || null,
    input.strategy || 'priority', Number(input.priority || 100),
    input.allow_split === false ? 0 : 1, JSON.stringify(input.conditions || {}),
    input.actor, stamp, stamp,
  );
  return mapRule(ruleInScope(db, id, current));
}

export function updatePutawayRule(db, input) {
  const current = scope(input);
  const record = ruleInScope(db, input.rule_id || input.id, current);
  db.prepare(`UPDATE wms_putaway_rules SET name=?,priority=?,allow_split=?,is_active=?,
    strategy=?,conditions_json=?,updated_at=? WHERE id=?`).run(
    input.name || record.name, Number(input.priority ?? record.priority),
    input.allow_split === undefined ? record.allow_split : Number(!!input.allow_split),
    input.active === undefined ? record.is_active : Number(!!input.active),
    input.strategy || record.strategy,
    JSON.stringify(input.conditions || parse(record.conditions_json)),
    now(), record.id,
  );
  return mapRule(ruleInScope(db, record.id, current));
}

function mapRule(row) {
  return {
    id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id,
    name: row.name, ruleType: row.rule_type, productId: row.product_id,
    categoryId: row.category_id, supplierId: row.supplier_id,
    receiptType: row.receipt_type, lotPattern: row.lot_pattern,
    destinationZoneId: row.destination_zone_id,
    destinationLocationId: row.destination_location_id,
    temperatureMin: row.temperature_min, temperatureMax: row.temperature_max,
    hazardClass: row.hazard_class, requiresQualityStatus: row.requires_quality_status,
    strategy: row.strategy, priority: row.priority, allowSplit: !!row.allow_split,
    active: !!row.is_active, conditions: parse(row.conditions_json),
  };
}

function matchRule(rule, item) {
  if (rule.product_id && rule.product_id !== item.product_id) return false;
  if (rule.category_id && rule.category_id !== item.category_id) return false;
  if (rule.supplier_id && rule.supplier_id !== item.supplier_id) return false;
  if (rule.receipt_type && rule.receipt_type !== item.receipt_type) return false;
  if (rule.lot_pattern && !new RegExp(rule.lot_pattern).test(item.lot_code || '')) return false;
  if (rule.requires_quality_status && rule.requires_quality_status !== item.quality_status) return false;
  if (rule.hazard_class && rule.hazard_class !== item.hazard_class) return false;
  if (rule.temperature_min != null && Number(item.temperature ?? 0) < Number(rule.temperature_min)) return false;
  if (rule.temperature_max != null && Number(item.temperature ?? 0) > Number(rule.temperature_max)) return false;
  const conditions = parse(rule.conditions_json);
  return Object.entries(conditions).every(([key, expected]) => item[key] === expected);
}

function locationCompatibility(profile, item) {
  if (profile.is_blocked || profile.retired_at || !profile.is_active) return { allowed: false, reason: 'LOCATION_BLOCKED' };
  if (profile.fixed_product_id && profile.fixed_product_id !== item.product_id) return { allowed: false, reason: 'FIXED_BIN_PRODUCT_MISMATCH' };
  if (profile.temperature_min != null && Number(item.temperature ?? 0) < Number(profile.temperature_min)) return { allowed: false, reason: 'TEMPERATURE_BELOW_RANGE' };
  if (profile.temperature_max != null && Number(item.temperature ?? 0) > Number(profile.temperature_max)) return { allowed: false, reason: 'TEMPERATURE_ABOVE_RANGE' };
  const restrictions = parse(profile.restrictions_json);
  if (profile.hazardous && !item.hazard_class) return { allowed: false, reason: 'HAZARD_CLASS_REQUIRED' };
  if (restrictions.allowedHazardClasses && !restrictions.allowedHazardClasses.includes(item.hazard_class)) return { allowed: false, reason: 'HAZARD_CLASS_DENIED' };
  if (restrictions.deniedCategories && restrictions.deniedCategories.includes(item.category_id)) return { allowed: false, reason: 'CATEGORY_RESTRICTED' };
  if (restrictions.qualityStatuses && !restrictions.qualityStatuses.includes(item.quality_status)) return { allowed: false, reason: 'QUALITY_STATUS_DENIED' };
  if (item.quality_status === 'hold' && !['quality_hold', 'quarantine'].includes(profile.location_type)) return { allowed: false, reason: 'QUALITY_HOLD_REQUIRES_CONTROLLED_AREA' };
  return { allowed: true, restricted: !!profile.restricted };
}

function candidatesForRule(db, rule, current, item) {
  let sql = `SELECT p.*,l.is_active,
    COALESCE((SELECT SUM(ABS(q.quantity)) FROM stock_quants q WHERE q.company_id=p.company_id AND q.location_id=p.location_id),0) used_units,
    COALESCE((SELECT SUM(ABS(q.quantity)) FROM stock_quants q WHERE q.company_id=p.company_id AND q.location_id=p.location_id AND q.product_id=?),0) affinity_units
    FROM wms_location_profiles p JOIN stock_locations l ON l.id=p.location_id
    WHERE p.company_id=? AND p.warehouse_id=? AND p.retired_at IS NULL`;
  const params = [item.product_id, current.companyId, current.warehouseId];
  if (rule.destination_location_id) { sql += ' AND p.location_id=?'; params.push(rule.destination_location_id); }
  else if (rule.destination_zone_id) { sql += ' AND p.zone_id=?'; params.push(rule.destination_zone_id); }
  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => {
    const compatibility = locationCompatibility(row, item);
    const capacityUnits = Number(row.capacity_units || 0);
    const availableUnits = capacityUnits ? Math.max(0, capacityUnits - Number(row.used_units || 0)) : Number.POSITIVE_INFINITY;
    const weightAvailable = row.weight_limit ? Math.max(0, Number(row.weight_limit) - Number(row.used_units || 0) * Number(item.unit_weight || 0)) : Number.POSITIVE_INFINITY;
    const volumeAvailable = row.volume_limit ? Math.max(0, Number(row.volume_limit) - Number(row.used_units || 0) * Number(item.unit_volume || 0)) : Number.POSITIVE_INFINITY;
    const maxByWeight = item.unit_weight ? weightAvailable / Number(item.unit_weight) : Number.POSITIVE_INFINITY;
    const maxByVolume = item.unit_volume ? volumeAvailable / Number(item.unit_volume) : Number.POSITIVE_INFINITY;
    return {
      ...row, compatibility,
      availableQuantity: Math.max(0, Math.floor(Math.min(availableUnits, maxByWeight, maxByVolume) * 10000) / 10000),
    };
  }).filter((row) => row.compatibility.allowed && row.availableQuantity > 0)
    .sort((a, b) => {
      if (rule.strategy === 'affinity' && b.affinity_units !== a.affinity_units) return b.affinity_units - a.affinity_units;
      if (a.fixed_product_id === item.product_id && b.fixed_product_id !== item.product_id) return -1;
      if (b.fixed_product_id === item.product_id && a.fixed_product_id !== item.product_id) return 1;
      return Number(a.putaway_priority) - Number(b.putaway_priority) || a.location_code.localeCompare(b.location_code);
    });
}

export function recommendPutaway(db, input) {
  const current = scope(input);
  assertWarehouse(db, current);
  if (!input.product_id || Number(input.quantity) <= 0 || !input.source_location_id) {
    throw new PutawayError('Product, positive quantity and source location are required', 'INVALID_PUTAWAY_REQUEST');
  }
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT id FROM wms_putaway_recommendations WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return recommendationInScope(db, replay.id, input);
  }
  const rules = db.prepare(`SELECT * FROM wms_putaway_rules WHERE company_id=? AND warehouse_id=? AND is_active=1 ORDER BY priority,id`).all(current.companyId, current.warehouseId);
  const item = {
    ...input, quality_status: input.quality_status || 'released',
    unit_weight: Number(input.unit_weight || 0), unit_volume: Number(input.unit_volume || 0),
  };
  const matchedRules = rules.filter((rule) => matchRule(rule, item));
  if (!matchedRules.length) throw new PutawayError('No governed putaway rule matches this receipt', 'NO_PUTAWAY_RULE', 409);

  let chosen = null;
  let allocation = [];
  for (const rule of matchedRules) {
    const candidates = candidatesForRule(db, rule, current, item);
    if (!candidates.length) continue;
    let remaining = Number(input.quantity);
    const proposed = [];
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, candidate.availableQuantity);
      if (quantity <= 0) continue;
      proposed.push({ candidate, quantity: round(quantity) });
      remaining = round(remaining - quantity);
      if (!rule.allow_split) break;
    }
    if (remaining <= 0 || (proposed.length && input.allow_partial)) {
      chosen = rule;
      allocation = proposed;
      break;
    }
  }
  if (!chosen || !allocation.length) throw new PutawayError('No compatible destination has sufficient capacity', 'PUTAWAY_CAPACITY_UNAVAILABLE', 409);
  const allocated = round(allocation.reduce((sum, line) => sum + line.quantity, 0));
  if (allocated < Number(input.quantity) && !input.allow_partial) throw new PutawayError('Split putaway capacity is insufficient', 'PUTAWAY_SPLIT_INSUFFICIENT', 409);

  const id = uid('parec');
  const stamp = now();
  db.prepare(`INSERT INTO wms_putaway_recommendations(
    id,company_id,warehouse_id,source_location_id,product_id,lot_id,serial_id,
    quantity,unit_weight,unit_volume,quality_status,selected_rule_id,status,
    requested_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'suggested',?,?,?,?)`).run(
    id, current.companyId, current.warehouseId, input.source_location_id,
    input.product_id, input.lot_id || null, input.serial_id || null,
    allocated, item.unit_weight, item.unit_volume, item.quality_status,
    chosen.id, input.actor, stamp, stamp, input.idempotency_key || null,
  );
  const insert = db.prepare(`INSERT INTO wms_putaway_recommendation_lines(
    id,recommendation_id,destination_location_id,quantity,capacity_before,capacity_after,sequence,restriction_override
  ) VALUES(?,?,?,?,?,?,?,0)`);
  allocation.forEach(({ candidate, quantity }, index) => insert.run(
    uid('parl'), id, candidate.location_id, quantity,
    Number(candidate.used_units || 0), Number(candidate.used_units || 0) + quantity, index + 1,
  ));
  return recommendationInScope(db, id, input);
}

function createTasks(db, recommendation, input, override = false) {
  const productUom = db.prepare('SELECT t.uom_id FROM product_variants v JOIN product_templates t ON t.id=v.template_id WHERE v.id=? AND v.company_id=?').get(recommendation.productId, recommendation.companyId);
  if (!productUom?.uom_id) throw new PutawayError('Canonical Product UOM is required', 'PRODUCT_UOM_REQUIRED', 409);
  const stamp = now();
  const insert = db.prepare(`INSERT INTO wms_warehouse_tasks(
    id,company_id,branch_id,warehouse_id,task_type,source_record_type,source_record_id,
    product_id,lot_id,serial_id,source_location_id,destination_location_id,quantity,
    status,priority,assigned_to,canonical_action,canonical_request_json,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,'putaway','putaway_recommendation',?,?,?,?,?,?,?,'ready',?,?,'stock:move:post',?,?,?,?)`);
  const tasks = recommendation.lines.map((line) => {
    const taskId = uid('wtask');
    const request = {
      company_id: recommendation.companyId,
      branch_id: input.branch_id || null,
      reference: `PUTAWAY/${recommendation.id}`,
      uom_id: productUom.uom_id,
      product_id: recommendation.productId,
      product_qty: line.quantity,
      location_id: recommendation.sourceLocationId,
      location_dest_id: line.destinationLocationId,
      lot_id: recommendation.lotId,
      serial_id: recommendation.serialId,
      source_document_type: 'wms_putaway',
      source_document_id: recommendation.id,
      idempotency_key: `${recommendation.id}:${line.sequence}:canonical`,
    };
    insert.run(
      taskId, recommendation.companyId, input.branch_id || null,
      recommendation.warehouseId, recommendation.id, recommendation.productId,
      recommendation.lotId, recommendation.serialId, recommendation.sourceLocationId,
      line.destinationLocationId, line.quantity,
      Number(input.priority || 100), input.assigned_to || input.actor,
      JSON.stringify(request), input.actor, stamp, stamp,
    );
    if (override) db.prepare('UPDATE wms_putaway_recommendation_lines SET restriction_override=1 WHERE id=?').run(line.id);
    return taskInScope(db, taskId, input);
  });
  db.prepare(`UPDATE wms_putaway_recommendations SET status='task_created',accepted_by=?,updated_at=? WHERE id=?`).run(input.actor, stamp, recommendation.id);
  return { ...recommendationInScope(db, recommendation.id, input), tasks };
}

export function acceptPutaway(db, input) {
  const recommendation = recommendationInScope(db, input.recommendation_id, input);
  if (!['suggested', 'accepted'].includes(recommendation.status)) {
    if (recommendation.status === 'task_created') {
      const tasks = db.prepare(`SELECT id FROM wms_warehouse_tasks WHERE source_record_type='putaway_recommendation' AND source_record_id=? ORDER BY id`).all(recommendation.id).map((row) => taskInScope(db, row.id, input));
      return { ...recommendation, tasks };
    }
    throw new PutawayError('Recommendation is not open for acceptance', 'PUTAWAY_NOT_OPEN', 409);
  }
  return createTasks(db, recommendation, input, false);
}

export function overridePutaway(db, input) {
  const recommendation = recommendationInScope(db, input.recommendation_id, input);
  if (!input.destination_location_id || !input.reason) throw new PutawayError('Override destination and reason are required', 'INVALID_PUTAWAY_OVERRIDE');
  const profile = db.prepare(`SELECT p.*,l.is_active FROM wms_location_profiles p JOIN stock_locations l ON l.id=p.location_id
    WHERE p.location_id=? AND p.company_id=? AND p.warehouse_id=?`).get(input.destination_location_id, recommendation.companyId, recommendation.warehouseId);
  if (!profile) throw new PutawayError('Override destination is outside scope', 'LOCATION_SCOPE_DENIED', 403);
  const compatibility = locationCompatibility(profile, { product_id: recommendation.productId, quality_status: recommendation.qualityStatus });
  const restricted = profile.restricted || !compatibility.allowed;
  if (restricted) {
    if (!input.approved_by) throw new PutawayError('Restricted override requires approval', 'RESTRICTED_OVERRIDE_APPROVAL_REQUIRED', 403);
    if (input.approved_by === input.actor) throw new PutawayError('Restricted override requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  }
  db.prepare('DELETE FROM wms_putaway_recommendation_lines WHERE recommendation_id=?').run(recommendation.id);
  db.prepare(`INSERT INTO wms_putaway_recommendation_lines(id,recommendation_id,destination_location_id,quantity,sequence,restriction_override)
    VALUES(?,?,?,?,1,?)`).run(uid('parl'), recommendation.id, input.destination_location_id, recommendation.quantity, restricted ? 1 : 0);
  db.prepare(`UPDATE wms_putaway_recommendations SET status='overridden',exception_reason=?,accepted_by=?,updated_at=? WHERE id=?`).run(input.reason, input.approved_by || input.actor, now(), recommendation.id);
  return createTasks(db, recommendationInScope(db, recommendation.id, input), input, restricted);
}

function expectedBarcode(db, locationId) {
  const row = db.prepare('SELECT barcode,location_code FROM wms_location_profiles WHERE location_id=?').get(locationId);
  return row?.barcode || row?.location_code || locationId;
}

export function scanTaskSource(db, input) {
  const task = taskInScope(db, input.task_id, input);
  if (!['ready', 'assigned'].includes(task.status)) throw new PutawayError('Task is not ready for source scan', 'TASK_SOURCE_SCAN_INVALID_STATE', 409);
  const expected = expectedBarcode(db, task.sourceLocationId);
  if (String(input.barcode || '') !== String(expected) && String(input.barcode || '') !== task.sourceLocationId) {
    throw new PutawayError('Source barcode does not match task', 'SOURCE_SCAN_MISMATCH', 409);
  }
  db.prepare(`UPDATE wms_warehouse_tasks SET status='source_scanned',source_scan=?,assigned_to=COALESCE(assigned_to,?),updated_at=? WHERE id=?`).run(input.barcode, input.actor, now(), task.id);
  return taskInScope(db, task.id, input);
}

export function scanTaskDestination(db, input) {
  const task = taskInScope(db, input.task_id, input);
  if (task.status !== 'source_scanned') throw new PutawayError('Source must be scanned first', 'TASK_DESTINATION_SCAN_INVALID_STATE', 409);
  const expected = expectedBarcode(db, task.destinationLocationId);
  if (String(input.barcode || '') !== String(expected) && String(input.barcode || '') !== task.destinationLocationId) {
    throw new PutawayError('Destination barcode does not match task', 'DESTINATION_SCAN_MISMATCH', 409);
  }
  db.prepare(`UPDATE wms_warehouse_tasks SET status='destination_scanned',destination_scan=?,updated_at=? WHERE id=?`).run(input.barcode, now(), task.id);
  return taskInScope(db, task.id, input);
}

export function requestCanonicalMovement(db, input) {
  const task = taskInScope(db, input.task_id, input);
  if (task.status !== 'destination_scanned') throw new PutawayError('Both locations must be scanned before canonical request', 'TASK_NOT_SCAN_COMPLETE', 409);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='awaiting_canonical',updated_at=? WHERE id=?`).run(now(), task.id);
  return { ...taskInScope(db, task.id, input), executionBoundary: 'REQUEST_ONLY', inventoryWritten: false };
}

export function acknowledgeCanonicalMovement(db, input) {
  const task = taskInScope(db, input.task_id, input);
  if (task.status !== 'awaiting_canonical' || !input.canonical_result_id) {
    throw new PutawayError('Canonical movement result is required', 'CANONICAL_RESULT_REQUIRED', 409);
  }
  const canonical = db.prepare('SELECT id,state FROM stock_moves WHERE id=? AND company_id=?').get(input.canonical_result_id, task.companyId);
  if (!canonical || canonical.state !== 'done') throw new PutawayError('Canonical movement is not posted', 'CANONICAL_MOVEMENT_NOT_POSTED', 409);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='completed',canonical_result_id=?,updated_at=? WHERE id=?`).run(canonical.id, now(), task.id);
  const remaining = db.prepare(`SELECT COUNT(*) count FROM wms_warehouse_tasks WHERE source_record_type=? AND source_record_id=? AND status<>'completed'`).get(task.sourceRecordType, task.sourceRecordId).count;
  if (!remaining && task.sourceRecordType === 'putaway_recommendation') {
    db.prepare(`UPDATE wms_putaway_recommendations SET status='completed',updated_at=? WHERE id=?`).run(now(), task.sourceRecordId);
  }
  if (!remaining && task.sourceRecordType === 'replenishment_proposal') {
    db.prepare(`UPDATE wms_replenishment_proposals_v2 SET status='completed',updated_at=? WHERE id=?`).run(now(), task.sourceRecordId);
  }
  return taskInScope(db, task.id, input);
}

export function listPutawayRules(db, input) {
  const current = scope(input);
  return db.prepare(`SELECT * FROM wms_putaway_rules WHERE company_id=? AND warehouse_id=? ORDER BY priority,id`).all(current.companyId, current.warehouseId).map(mapRule);
}

export function listPutawayQueue(db, input) {
  const current = scope(input);
  let sql = 'SELECT id FROM wms_putaway_recommendations WHERE company_id=? AND warehouse_id=?';
  const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params).map((row) => recommendationInScope(db, row.id, input));
}

export function listWarehouseTasks(db, input) {
  const current = scope(input);
  let sql = 'SELECT id FROM wms_warehouse_tasks WHERE company_id=? AND warehouse_id=?';
  const params = [current.companyId, current.warehouseId];
  if (input.task_type) { sql += ' AND task_type=?'; params.push(input.task_type); }
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY priority,created_at';
  return db.prepare(sql).all(...params).map((row) => taskInScope(db, row.id, input));
}
