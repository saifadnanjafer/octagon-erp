// BUILD-09 governed replenishment proposals and canonical movement requests.
'use strict';

import crypto from 'node:crypto';

export class ReplenishmentError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'ReplenishmentError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const round = (value) => Number(Number(value || 0).toFixed(4));

function scope(input) {
  if (!input.company_id) throw new ReplenishmentError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new ReplenishmentError('Warehouse scope is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function assertWarehouse(db, current) {
  const row = db.prepare('SELECT id FROM warehouses WHERE id=? AND company_id=?').get(current.warehouseId, current.companyId);
  if (!row) throw new ReplenishmentError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
}

function assertLocation(db, locationId, current, label) {
  const row = db.prepare(`SELECT l.id,p.zone_id,p.restricted,p.is_blocked AS blocked
    FROM stock_locations l JOIN wms_location_profiles p ON p.location_id=l.id
    WHERE l.id=? AND l.company_id=? AND p.company_id=? AND p.warehouse_id=? AND l.is_active=1`).get(
    locationId, current.companyId, current.companyId, current.warehouseId,
  );
  if (!row) throw new ReplenishmentError(`${label} location is outside warehouse scope`, 'LOCATION_SCOPE_DENIED', 403);
  return row;
}

function mapRule(row) {
  return {
    id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id,
    zoneId: row.zone_id, productId: row.product_id, categoryId: row.category_id,
    sourceLocationId: row.source_location_id, destinationLocationId: row.destination_location_id,
    minimumQuantity: Number(row.minimum_quantity), maximumQuantity: Number(row.maximum_quantity),
    reorderPoint: Number(row.reorder_point), targetQuantity: Number(row.target_quantity),
    safetyQuantity: Number(row.safety_quantity), demandWindowDays: row.demand_window_days,
    priority: row.priority, schedule: row.schedule, autoApprovalLimit: Number(row.auto_approval_limit),
    active: !!row.is_active, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function ruleInScope(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_replenishment_rules_v2 WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new ReplenishmentError('Replenishment rule is outside warehouse scope', 'REPLENISHMENT_RULE_SCOPE_DENIED', 403);
  return row;
}

function mapProposal(row) {
  return {
    id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id,
    ruleId: row.rule_id, productId: row.product_id,
    sourceLocationId: row.source_location_id, destinationLocationId: row.destination_location_id,
    destinationOnHand: Number(row.destination_on_hand), openPickDemand: Number(row.open_pick_demand),
    productionDemand: Number(row.production_demand), requestedQuantity: Number(row.requested_quantity),
    availableQuantity: Number(row.available_quantity), proposedQuantity: Number(row.proposed_quantity),
    shortageQuantity: Number(row.shortage_quantity), status: row.status, priority: row.priority,
    blockReason: row.block_reason, createdBy: row.created_by, approvedBy: row.approved_by,
    approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function proposalInScope(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_replenishment_proposals_v2 WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new ReplenishmentError('Replenishment proposal is outside warehouse scope', 'REPLENISHMENT_PROPOSAL_SCOPE_DENIED', 403);
  return row;
}

function available(db, companyId, productId, locationId) {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity-reserved_quantity),0) quantity
    FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?`).get(companyId, productId, locationId);
  return Math.max(0, round(row?.quantity));
}

function onHand(db, companyId, productId, locationId) {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity
    FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?`).get(companyId, productId, locationId);
  return round(row?.quantity);
}

export function createReplenishmentRule(db, input) {
  const current = scope(input);
  assertWarehouse(db, current);
  const source = assertLocation(db, input.source_location_id, current, 'Source');
  const destination = assertLocation(db, input.destination_location_id, current, 'Destination');
  if (source.id === destination.id) throw new ReplenishmentError('Source and destination must differ', 'REPLENISHMENT_LOCATION_CONFLICT');
  if (destination.blocked || destination.restricted) throw new ReplenishmentError('Destination is unavailable for replenishment', 'DESTINATION_UNAVAILABLE', 409);
  if (!input.product_id && !input.category_id) throw new ReplenishmentError('Product or category is required', 'REPLENISHMENT_SELECTOR_REQUIRED');
  const minimum = Number(input.minimum_quantity ?? 0);
  const maximum = Number(input.maximum_quantity ?? input.target_quantity ?? 0);
  const reorder = Number(input.reorder_point ?? minimum);
  const target = Number(input.target_quantity ?? maximum);
  if (minimum < 0 || maximum < minimum || target < minimum || reorder < 0 || target > maximum) {
    throw new ReplenishmentError('Minimum, reorder, target and maximum quantities are inconsistent', 'INVALID_REPLENISHMENT_LEVELS');
  }
  const id = uid('reprule');
  const stamp = now();
  db.prepare(`INSERT INTO wms_replenishment_rules_v2(
    id,company_id,warehouse_id,zone_id,product_id,category_id,source_location_id,destination_location_id,
    minimum_quantity,maximum_quantity,reorder_point,target_quantity,safety_quantity,demand_window_days,
    priority,schedule,auto_approval_limit,is_active,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(
    id, current.companyId, current.warehouseId, input.zone_id || destination.zone_id || null,
    input.product_id || null, input.category_id || null, source.id, destination.id,
    minimum, maximum, reorder, target, Number(input.safety_quantity || 0),
    Number(input.demand_window_days || 7), Number(input.priority || 100), input.schedule || 'demand',
    Number(input.auto_approval_limit || 0), input.actor || 'system', stamp, stamp,
  );
  return mapRule(ruleInScope(db, id, input));
}

function productsForRule(db, rule) {
  if (rule.product_id) return [rule.product_id];
  return db.prepare(`SELECT pv.id FROM product_variants pv JOIN product_templates pt ON pt.id=pv.template_id
    WHERE pt.company_id=? AND pt.category_id=? AND pv.is_active=1 ORDER BY pv.id`).all(rule.company_id, rule.category_id).map((row) => row.id);
}

export function calculateReplenishment(db, input) {
  const current = scope(input);
  assertWarehouse(db, current);
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM wms_replenishment_proposals_v2 WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return { proposals: [mapProposal(proposalInScope(db, replay.id, input))], replayed: true };
  }
  let sql = 'SELECT * FROM wms_replenishment_rules_v2 WHERE company_id=? AND warehouse_id=? AND is_active=1';
  const params = [current.companyId, current.warehouseId];
  if (input.rule_id) { sql += ' AND id=?'; params.push(input.rule_id); }
  sql += ' ORDER BY priority,id';
  const rules = db.prepare(sql).all(...params);
  const proposals = [];
  const stamp = now();
  for (const rule of rules) {
    for (const productId of productsForRule(db, rule)) {
      const destinationOnHand = onHand(db, current.companyId, productId, rule.destination_location_id);
      const openPickDemand = Math.max(0, Number(input.open_pick_demand_by_product?.[productId] || 0));
      const productionDemand = Math.max(0, Number(input.production_demand_by_product?.[productId] || 0));
      const effective = destinationOnHand - openPickDemand - productionDemand;
      if (effective > Number(rule.reorder_point)) continue;
      const requested = round(Math.max(0, Number(rule.target_quantity) + Number(rule.safety_quantity) - effective));
      if (requested <= 0) continue;
      const sourceAvailable = available(db, current.companyId, productId, rule.source_location_id);
      const proposed = round(Math.min(requested, sourceAvailable));
      const shortage = round(requested - proposed);
      let status = proposed <= 0 ? 'blocked' : shortage > 0 ? 'partial' : 'proposed';
      if (proposed > 0 && Number(rule.auto_approval_limit) > 0 && proposed <= Number(rule.auto_approval_limit)) status = 'auto_approved';
      const id = uid('repprop');
      const key = input.idempotency_key ? `${input.idempotency_key}:${rule.id}:${productId}` : null;
      db.prepare(`INSERT INTO wms_replenishment_proposals_v2(
        id,company_id,warehouse_id,rule_id,product_id,source_location_id,destination_location_id,
        destination_on_hand,open_pick_demand,production_demand,requested_quantity,available_quantity,
        proposed_quantity,status,priority,shortage_quantity,block_reason,created_by,approved_by,approved_at,
        created_at,updated_at,idempotency_key
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, current.companyId, current.warehouseId, rule.id, productId,
        rule.source_location_id, rule.destination_location_id, destinationOnHand,
        openPickDemand, productionDemand, requested, sourceAvailable, proposed, status,
        rule.priority, shortage, proposed <= 0 ? 'NO_AVAILABLE_SOURCE_STOCK' : null,
        input.actor || 'system', status === 'auto_approved' ? input.actor || 'system' : null,
        status === 'auto_approved' ? stamp : null, stamp, stamp, key,
      );
      proposals.push(mapProposal(proposalInScope(db, id, input)));
    }
  }
  return { proposals, replayed: false, evaluatedRules: rules.length };
}

function taskForProposal(db, proposal, input) {
  const existing = db.prepare(`SELECT * FROM wms_warehouse_tasks WHERE source_record_type='replenishment_proposal' AND source_record_id=?`).get(proposal.id);
  if (existing) return existing;
  if (Number(proposal.proposed_quantity) <= 0) throw new ReplenishmentError('Proposal has no movable quantity', 'REPLENISHMENT_ZERO_QUANTITY', 409);
  const id = uid('wtask');
  const stamp = now();
  const request = {
    company_id: proposal.company_id, branch_id: input.branch_id || null,
    reference: `REPLENISH/${proposal.id}`, product_id: proposal.product_id,
    product_qty: Number(proposal.proposed_quantity), location_id: proposal.source_location_id,
    location_dest_id: proposal.destination_location_id,
    source_document_type: 'wms_replenishment', source_document_id: proposal.id,
    idempotency_key: `${proposal.id}:canonical`,
  };
  db.prepare(`INSERT INTO wms_warehouse_tasks(
    id,company_id,branch_id,warehouse_id,task_type,source_record_type,source_record_id,product_id,
    source_location_id,destination_location_id,quantity,status,priority,canonical_action,
    canonical_request_json,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,'replenishment','replenishment_proposal',?,?,?,?,?,'ready',?,'stock:move:post',?,?,?,?)`).run(
    id, proposal.company_id, input.branch_id || null, proposal.warehouse_id,
    proposal.id, proposal.product_id, proposal.source_location_id, proposal.destination_location_id,
    proposal.proposed_quantity, proposal.priority, JSON.stringify(request), input.actor || 'system', stamp, stamp,
  );
  db.prepare(`UPDATE wms_replenishment_proposals_v2 SET status='task_created',updated_at=? WHERE id=?`).run(stamp, proposal.id);
  return db.prepare('SELECT * FROM wms_warehouse_tasks WHERE id=?').get(id);
}

function mappedTask(row) {
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    taskType: row.task_type, sourceRecordType: row.source_record_type, sourceRecordId: row.source_record_id,
    productId: row.product_id, sourceLocationId: row.source_location_id,
    destinationLocationId: row.destination_location_id, quantity: Number(row.quantity),
    status: row.status, priority: row.priority, canonicalAction: row.canonical_action,
    canonicalRequest: JSON.parse(row.canonical_request_json || '{}'), createdBy: row.created_by,
  };
}

export function approveReplenishment(db, input) {
  const proposal = proposalInScope(db, input.proposal_id, input);
  if (['task_created', 'awaiting_canonical', 'completed'].includes(proposal.status)) {
    const existing = db.prepare(`SELECT * FROM wms_warehouse_tasks WHERE source_record_type='replenishment_proposal' AND source_record_id=?`).get(proposal.id);
    return { proposal: mapProposal(proposal), task: existing ? mappedTask(existing) : null, replayed: true };
  }
  if (!['proposed', 'partial', 'auto_approved', 'failed'].includes(proposal.status)) throw new ReplenishmentError('Proposal is not approvable', 'REPLENISHMENT_NOT_APPROVABLE', 409);
  if (input.actor && proposal.created_by === input.actor && proposal.status !== 'auto_approved') {
    throw new ReplenishmentError('Manual replenishment approval requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  }
  const stamp = now();
  db.prepare(`UPDATE wms_replenishment_proposals_v2 SET status='approved',approved_by=?,approved_at=?,updated_at=? WHERE id=?`).run(input.actor || 'system', stamp, stamp, proposal.id);
  const approved = proposalInScope(db, proposal.id, input);
  const task = taskForProposal(db, approved, input);
  return { proposal: mapProposal(proposalInScope(db, proposal.id, input)), task: mappedTask(task), replayed: false, inventoryWritten: false };
}

export function cancelReplenishment(db, input) {
  const proposal = proposalInScope(db, input.proposal_id, input);
  if (['awaiting_canonical', 'completed'].includes(proposal.status)) throw new ReplenishmentError('Canonical movement cannot be cancelled here', 'CANONICAL_MOVEMENT_OWNS_STATE', 409);
  db.prepare(`UPDATE wms_replenishment_proposals_v2 SET status='cancelled',block_reason=?,updated_at=? WHERE id=?`).run(input.reason || 'Cancelled by operator', now(), proposal.id);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='cancelled',updated_at=? WHERE source_record_type='replenishment_proposal' AND source_record_id=? AND status NOT IN ('awaiting_canonical','completed')`).run(now(), proposal.id);
  return mapProposal(proposalInScope(db, proposal.id, input));
}

export function retryReplenishment(db, input) {
  const proposal = proposalInScope(db, input.proposal_id, input);
  if (!['blocked', 'failed', 'partial'].includes(proposal.status)) throw new ReplenishmentError('Only blocked, failed or partial proposals can be retried', 'REPLENISHMENT_RETRY_INVALID_STATE', 409);
  const sourceAvailable = available(db, proposal.company_id, proposal.product_id, proposal.source_location_id);
  const proposed = round(Math.min(Number(proposal.requested_quantity), sourceAvailable));
  const shortage = round(Number(proposal.requested_quantity) - proposed);
  const status = proposed <= 0 ? 'blocked' : shortage > 0 ? 'partial' : 'proposed';
  db.prepare(`UPDATE wms_replenishment_proposals_v2 SET available_quantity=?,proposed_quantity=?,shortage_quantity=?,status=?,block_reason=?,updated_at=? WHERE id=?`).run(
    sourceAvailable, proposed, shortage, status, proposed <= 0 ? 'NO_AVAILABLE_SOURCE_STOCK' : null, now(), proposal.id,
  );
  return mapProposal(proposalInScope(db, proposal.id, input));
}

export function listReplenishmentRules(db, input) {
  const current = scope(input);
  return db.prepare('SELECT * FROM wms_replenishment_rules_v2 WHERE company_id=? AND warehouse_id=? ORDER BY priority,id').all(current.companyId, current.warehouseId).map(mapRule);
}

export function listReplenishmentProposals(db, input) {
  const current = scope(input);
  let sql = 'SELECT * FROM wms_replenishment_proposals_v2 WHERE company_id=? AND warehouse_id=?';
  const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY priority,created_at DESC';
  return db.prepare(sql).all(...params).map(mapProposal);
}
