// BUILD-09 governed production material flow. Inventory effects are canonical requests only.
'use strict';
import crypto from 'node:crypto';

export class MaterialFlowError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'MaterialFlowError'; this.code = code; this.statusCode = statusCode; }
}
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

function scope(input) {
  if (!input.company_id) throw new MaterialFlowError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new MaterialFlowError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function productionOrder(db, id, current) {
  const row = db.prepare('SELECT * FROM mfg_production_orders WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new MaterialFlowError('Production order is outside warehouse scope', 'PRODUCTION_ORDER_SCOPE_DENIED', 403);
  return row;
}

function requestRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM mfg_material_flow_requests WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new MaterialFlowError('Material request is outside warehouse scope', 'MATERIAL_REQUEST_SCOPE_DENIED', 403);
  return row;
}

function mapRequest(row) {
  return { id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    productionOrderId: row.production_order_id, workOrderId: row.work_order_id, requirementId: row.requirement_id,
    requestType: row.request_type, productId: row.product_id, substituteProductId: row.substitute_product_id,
    requestedQuantity: Number(row.requested_quantity), availableQuantity: row.available_quantity == null ? null : Number(row.available_quantity),
    approvedQuantity: row.approved_quantity == null ? null : Number(row.approved_quantity), fulfilledQuantity: Number(row.fulfilled_quantity),
    sourceLocationId: row.source_location_id, destinationLocationId: row.destination_location_id,
    lotId: row.lot_id, serialId: row.serial_id, shortageQuantity: row.shortage_quantity == null ? null : Number(row.shortage_quantity),
    partialAllowed: Boolean(row.partial_allowed), backflushPolicySupported: Boolean(row.backflush_policy_supported),
    status: row.status, reasonCode: row.reason_code, canonicalAction: row.canonical_action,
    canonicalRequest: parse(row.canonical_request_json), canonicalResultId: row.canonical_result_id,
    requestedBy: row.requested_by, approvedBy: row.approved_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function scopedLocation(db, id, current) {
  const row = db.prepare('SELECT * FROM stock_locations WHERE id=? AND company_id=? AND (warehouse_id=? OR warehouse_id IS NULL)').get(id, current.companyId, current.warehouseId);
  if (!row) throw new MaterialFlowError('Location is outside warehouse scope', 'MATERIAL_LOCATION_SCOPE_DENIED', 403);
  return row;
}

function ensureState(row, allowed, code) { if (!allowed.includes(row.status)) throw new MaterialFlowError(`Material request is ${row.status}`, code, 409); }

export function createMaterialFlowRequest(db, input) {
  const current = scope(input);
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM mfg_material_flow_requests WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapRequest(requestRow(db, replay.id, input));
  }
  const order = productionOrder(db, input.production_order_id, current);
  const allowedTypes = ['request', 'reservation', 'issue', 'return', 'substitution', 'shortage', 'backflush', 'production_receipt', 'co_product', 'by_product', 'putaway'];
  if (!allowedTypes.includes(input.request_type)) throw new MaterialFlowError('Invalid material flow request type', 'MATERIAL_REQUEST_TYPE_INVALID');
  if (input.request_type === 'backflush' && !input.backflush_policy_supported) throw new MaterialFlowError('Backflush is not supported by the current MRP policy', 'BACKFLUSH_POLICY_REQUIRED', 409);
  let requirement = null;
  if (input.requirement_id) {
    requirement = db.prepare('SELECT * FROM mfg_material_requirements WHERE id=? AND production_order_id=? AND company_id=?').get(input.requirement_id, order.id, current.companyId);
    if (!requirement) throw new MaterialFlowError('Material requirement is outside production order scope', 'REQUIREMENT_SCOPE_DENIED', 403);
  }
  const productId = input.product_id || requirement?.component_id || (['production_receipt', 'co_product', 'by_product'].includes(input.request_type) ? order.product_id : null);
  if (!productId || !db.prepare('SELECT 1 FROM product_variants WHERE id=? AND company_id=?').get(productId, current.companyId)) throw new MaterialFlowError('Product is outside company scope', 'PRODUCT_SCOPE_DENIED', 403);
  if (input.substitute_product_id && !db.prepare('SELECT 1 FROM product_variants WHERE id=? AND company_id=?').get(input.substitute_product_id, current.companyId)) throw new MaterialFlowError('Substitute product is outside company scope', 'SUBSTITUTE_SCOPE_DENIED', 403);
  const quantity = Number(input.requested_quantity); if (!(quantity > 0)) throw new MaterialFlowError('Requested quantity must be positive', 'MATERIAL_QUANTITY_INVALID');
  if (input.source_location_id) scopedLocation(db, input.source_location_id, current);
  if (input.destination_location_id) scopedLocation(db, input.destination_location_id, current);
  const id = uid('mflow'); const stamp = now();
  db.prepare(`INSERT INTO mfg_material_flow_requests(
    id,company_id,branch_id,warehouse_id,production_order_id,work_order_id,requirement_id,request_type,product_id,substitute_product_id,
    requested_quantity,source_location_id,destination_location_id,lot_id,serial_id,partial_allowed,backflush_policy_supported,status,
    reason_code,requested_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'requested',?,?,?,?,?)`).run(
    id, current.companyId, input.branch_id || null, current.warehouseId, order.id, input.work_order_id || null,
    requirement?.id || null, input.request_type, productId, input.substitute_product_id || null, quantity,
    input.source_location_id || requirement?.location_id || null, input.destination_location_id || null,
    input.lot_id || null, input.serial_id || null, input.partial_allowed === false ? 0 : 1,
    input.backflush_policy_supported ? 1 : 0, input.reason_code || null, input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapRequest(requestRow(db, id, input));
}

export function checkMaterialAvailability(db, input) {
  const row = requestRow(db, input.request_id, input); ensureState(row, ['requested', 'shortage', 'availability_checked'], 'MATERIAL_AVAILABILITY_INVALID_STATE');
  if (!row.source_location_id) throw new MaterialFlowError('Source location is required for availability', 'SOURCE_LOCATION_REQUIRED');
  const quant = db.prepare(`SELECT quantity,reserved_quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?`).get(row.company_id, row.substitute_product_id || row.product_id, row.source_location_id);
  const available = Math.max(0, Number(quant?.quantity || 0) - Number(quant?.reserved_quantity || 0));
  const shortage = Math.max(0, Number(row.requested_quantity) - available);
  const status = shortage > 0 ? 'shortage' : 'availability_checked';
  db.prepare('UPDATE mfg_material_flow_requests SET available_quantity=?,shortage_quantity=?,status=?,updated_at=? WHERE id=?').run(available, shortage, status, now(), row.id);
  return mapRequest(requestRow(db, row.id, input));
}

function canonicalPayload(row, approvedQuantity, actor) {
  const productId = row.substitute_product_id || row.product_id;
  if (row.request_type === 'reservation') {
    return { company_id: row.company_id, branch_id: row.branch_id, warehouse_id: row.warehouse_id,
      location_id: row.source_location_id, product_id: productId, lot_id: row.lot_id, serial_id: row.serial_id,
      quantity: approvedQuantity, allow_partial: Boolean(row.partial_allowed), source_document_type: 'mfg_material_flow_request',
      source_document_id: row.id, idempotency_key: `${row.id}:reservation`, actor };
  }
  return { company_id: row.company_id, branch_id: row.branch_id, reference: `MFG-FLOW/${row.id}`,
    product_id: productId, uom_id: 'unit', product_qty: approvedQuantity,
    location_id: row.source_location_id, location_dest_id: row.destination_location_id,
    lot_id: row.lot_id, serial_id: row.serial_id, source_document_type: `mfg_${row.request_type}`,
    source_document_id: row.production_order_id, source_line_id: row.id, idempotency_key: `${row.id}:stock`, actor };
}

export function approveMaterialFlow(db, input) {
  const row = requestRow(db, input.request_id, input); ensureState(row, ['availability_checked', 'shortage', 'requested'], 'MATERIAL_APPROVE_INVALID_STATE');
  if (row.requested_by === input.actor) throw new MaterialFlowError('Material approval requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  if (row.request_type === 'substitution' && !row.substitute_product_id) throw new MaterialFlowError('Substitution product is required', 'SUBSTITUTE_REQUIRED');
  const available = row.available_quantity == null ? Number(row.requested_quantity) : Number(row.available_quantity);
  const desired = Number(input.approved_quantity ?? row.requested_quantity);
  const approved = row.partial_allowed ? Math.min(desired, available || desired) : desired;
  if (!(approved > 0)) throw new MaterialFlowError('No material quantity can be approved', 'MATERIAL_NOT_AVAILABLE', 409);
  if (!row.partial_allowed && available < desired && !['return', 'production_receipt', 'co_product', 'by_product'].includes(row.request_type)) throw new MaterialFlowError('Full material quantity is not available', 'PARTIAL_ISSUE_NOT_ALLOWED', 409);
  if (!row.source_location_id || !row.destination_location_id) throw new MaterialFlowError('Source and destination locations are required for canonical material movement', 'MATERIAL_MOVEMENT_LOCATIONS_REQUIRED');
  const canonicalAction = row.request_type === 'reservation' ? 'stock:reservation:reserve' : 'stock:move:post';
  const request = canonicalPayload(row, approved, input.actor); const stamp = now();
  db.prepare(`UPDATE mfg_material_flow_requests SET approved_quantity=?,approved_by=?,status='approved',canonical_action=?,canonical_request_json=?,updated_at=? WHERE id=?`).run(approved, input.actor, canonicalAction, JSON.stringify(request), stamp, row.id);
  const taskType = row.request_type === 'return' ? 'production_return' : row.request_type === 'production_receipt' ? 'production_receipt' : 'production_issue';
  db.prepare(`INSERT INTO wms_warehouse_tasks(
    id,company_id,branch_id,warehouse_id,task_type,source_record_type,source_record_id,product_id,lot_id,serial_id,
    source_location_id,destination_location_id,quantity,status,priority,assigned_to,canonical_action,canonical_request_json,created_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,'mfg_material_flow_request',?,?,?,?,?,?,?,'ready',?,?,?, ?,?,?,?)`).run(
    uid('wtask'), row.company_id, row.branch_id, row.warehouse_id, taskType, row.id,
    row.substitute_product_id || row.product_id, row.lot_id, row.serial_id, row.source_location_id, row.destination_location_id,
    approved, Number(input.priority || 50), input.assigned_to || null, canonicalAction, JSON.stringify(request), input.actor, stamp, stamp,
  );
  db.prepare(`UPDATE mfg_material_flow_requests SET status='task_created',updated_at=? WHERE id=?`).run(stamp, row.id);
  return { ...mapRequest(requestRow(db, row.id, input)), warehouseTaskGenerated: true, inventoryWritten: false, financeWritten: false };
}

export function requestCanonicalMaterialEffect(db, input) {
  const row = requestRow(db, input.request_id, input); ensureState(row, ['task_created'], 'MATERIAL_CANONICAL_REQUEST_INVALID_STATE');
  db.prepare(`UPDATE mfg_material_flow_requests SET status='awaiting_canonical',updated_at=? WHERE id=?`).run(now(), row.id);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='awaiting_canonical',updated_at=? WHERE source_record_type='mfg_material_flow_request' AND source_record_id=?`).run(now(), row.id);
  return { ...mapRequest(requestRow(db, row.id, input)), executionBoundary: 'REQUEST_ONLY', inventoryWritten: false, financeWritten: false };
}

export function acknowledgeCanonicalMaterialEffect(db, input) {
  const row = requestRow(db, input.request_id, input); ensureState(row, ['awaiting_canonical'], 'MATERIAL_ACK_INVALID_STATE');
  let canonical;
  if (row.canonical_action === 'stock:reservation:reserve') {
    canonical = db.prepare('SELECT id,product_id,quantity,status FROM stock_reservations WHERE id=? AND company_id=?').get(input.canonical_result_id, row.company_id);
  } else {
    canonical = db.prepare('SELECT id,product_id,product_qty,state,location_id,location_dest_id FROM stock_moves WHERE id=? AND company_id=?').get(input.canonical_result_id, row.company_id);
  }
  if (!canonical || canonical.product_id !== (row.substitute_product_id || row.product_id) || Number(canonical.product_qty ?? canonical.quantity) !== Number(row.approved_quantity) || (canonical.state && canonical.state !== 'done')) throw new MaterialFlowError('Canonical inventory result does not match material request', 'CANONICAL_MATERIAL_MISMATCH', 409);
  const stamp = now();
  db.prepare(`UPDATE mfg_material_flow_requests SET status='completed',fulfilled_quantity=?,canonical_result_id=?,updated_at=? WHERE id=?`).run(row.approved_quantity, canonical.id, stamp, row.id);
  db.prepare(`UPDATE wms_warehouse_tasks SET status='completed',canonical_result_id=?,updated_at=? WHERE source_record_type='mfg_material_flow_request' AND source_record_id=?`).run(canonical.id, stamp, row.id);
  const followUpCanonicalAction = row.request_type === 'issue' ? 'manufacturing:material:issue' : row.request_type === 'return' ? 'manufacturing:material:return' : row.request_type === 'production_receipt' ? 'manufacturing:order:complete' : null;
  return { ...mapRequest(requestRow(db, row.id, input)), followUpCanonicalAction, manufacturingWritten: false };
}

export function listMaterialFlowRequests(db, input) {
  const current = scope(input); let sql = 'SELECT * FROM mfg_material_flow_requests WHERE company_id=? AND warehouse_id=?'; const params = [current.companyId, current.warehouseId];
  if (input.production_order_id) { sql += ' AND production_order_id=?'; params.push(input.production_order_id); }
  if (input.request_type) { sql += ' AND request_type=?'; params.push(input.request_type); }
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY created_at DESC'; return db.prepare(sql).all(...params).map(mapRequest);
}

export function materialShortageBoard(db, input) {
  return listMaterialFlowRequests(db, { ...input, status: 'shortage' }).map((row) => ({ ...row, resolvableByPartialIssue: row.partialAllowed && Number(row.availableQuantity || 0) > 0,
    substitutionRequested: row.requestType === 'substitution', backflushSupported: row.backflushPolicySupported }));
}
