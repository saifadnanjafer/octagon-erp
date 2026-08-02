// BUILD-09 mobile picking, short-pick, staging, and canonical move delegation.
'use strict';

import crypto from 'node:crypto';

export class PickingError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message); this.name = 'PickingError'; this.code = code; this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };

function scope(input) {
  if (!input.company_id) throw new PickingError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new PickingError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function assertWarehouse(db, current) {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND company_id=? AND is_active=1').get(current.warehouseId, current.companyId)) {
    throw new PickingError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
  }
}

function location(db, id, current, label) {
  const row = db.prepare(`SELECT l.*,p.location_code,p.barcode,p.location_type,p.is_blocked,p.block_reason,p.fixed_product_id,p.picking_priority
    FROM stock_locations l LEFT JOIN wms_location_profiles p ON p.location_id=l.id
    WHERE l.id=? AND l.company_id=? AND l.warehouse_id=? AND l.is_active=1`).get(id, current.companyId, current.warehouseId);
  if (!row) throw new PickingError(`${label} is outside warehouse scope`, 'LOCATION_SCOPE_DENIED', 403);
  return row;
}

function taskRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_pick_tasks_v2 WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new PickingError('Pick task is outside warehouse scope', 'PICK_TASK_SCOPE_DENIED', 403);
  return row;
}

function mapTask(row) {
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
    pickingType: row.picking_type, sourceDocumentId: row.source_document_id, sourceLineId: row.source_line_id,
    productId: row.product_id, lotId: row.lot_id, serialId: row.serial_id,
    sourceLocationId: row.source_location_id, stagingLocationId: row.staging_location_id,
    destinationLocationId: row.destination_location_id, requestedQuantity: Number(row.requested_quantity),
    pickedQuantity: Number(row.picked_quantity), shortQuantity: Number(row.short_quantity), strategy: row.strategy,
    routeSequence: row.route_sequence, status: row.status, assignedTo: row.assigned_to,
    sourceScan: row.source_scan, productScan: row.product_scan, lotSerialScan: row.lot_serial_scan,
    exceptionCode: row.exception_code, exceptionReason: row.exception_reason,
    substituteProductId: row.substitute_product_id, proof: parse(row.proof_json, []),
    canonicalAction: row.canonical_action, canonicalRequest: parse(row.canonical_request_json, {}),
    canonicalResultId: row.canonical_result_id, waveId: row.wave_id,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function product(db, id, companyId) {
  const row = db.prepare(`SELECT v.*,t.uom_id,t.category_id FROM product_variants v JOIN product_templates t ON t.id=v.template_id
    WHERE v.id=? AND v.company_id=? AND v.is_active=1`).get(id, companyId);
  if (!row) throw new PickingError('Product is outside company scope', 'PRODUCT_SCOPE_DENIED', 403);
  return row;
}

function ensureState(row, allowed, code) {
  if (!allowed.includes(row.status)) throw new PickingError(`Pick task is ${row.status}`, code, 409);
}

function available(db, row) {
  const balance = db.prepare(`SELECT COALESCE(SUM(quantity-reserved_quantity),0) quantity FROM stock_quants
    WHERE company_id=? AND product_id=? AND location_id=?`).get(row.company_id, row.product_id, row.source_location_id);
  return Math.max(0, Number(balance?.quantity || 0));
}

export function createPickTask(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  const source = location(db, input.source_location_id, current, 'Source location');
  const destination = location(db, input.destination_location_id, current, 'Destination location');
  const item = product(db, input.product_id, current.companyId);
  if (source.id === destination.id) throw new PickingError('Source and destination must differ', 'PICK_LOCATION_CONFLICT');
  if (source.is_blocked) throw new PickingError('Source location is blocked', 'SOURCE_LOCATION_BLOCKED', 409);
  if (['quality_hold', 'quarantine'].includes(source.location_type)) throw new PickingError('Quality-controlled stock cannot be picked', 'QUALITY_HOLD_REFUSAL', 409);
  if (source.fixed_product_id && source.fixed_product_id !== item.id) throw new PickingError('Fixed bin does not contain the requested product', 'FIXED_BIN_MISMATCH', 409);
  const quantity = Number(input.quantity || input.requested_quantity);
  if (!(quantity > 0)) throw new PickingError('Requested quantity must be positive', 'INVALID_PICK_QUANTITY');
  if (input.serial_id && quantity !== 1) throw new PickingError('Serial-specific task quantity must be one', 'SERIAL_QUANTITY_INVALID');
  const allowedTypes = ['sales_delivery', 'internal_transfer', 'production_issue', 'service_parts', 'supplier_return', 'rma_replacement'];
  const strategies = ['fifo', 'fefo', 'nearest', 'fixed_bin', 'lot_priority', 'serial_specific', 'manual_override'];
  if (!allowedTypes.includes(input.picking_type)) throw new PickingError('Unsupported picking type', 'INVALID_PICKING_TYPE');
  if (!strategies.includes(input.strategy || 'fifo')) throw new PickingError('Unsupported picking strategy', 'INVALID_PICKING_STRATEGY');
  if (!input.source_document_id) throw new PickingError('Source document is required', 'SOURCE_DOCUMENT_REQUIRED');
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM wms_pick_tasks_v2 WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapTask(taskRow(db, replay.id, input));
  }
  const id = uid('picktask');
  const stamp = now();
  db.prepare(`INSERT INTO wms_pick_tasks_v2(
    id,company_id,branch_id,warehouse_id,picking_type,source_document_id,source_line_id,product_id,lot_id,serial_id,
    source_location_id,staging_location_id,destination_location_id,requested_quantity,strategy,route_sequence,status,
    assigned_to,created_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ready',?,?,?,?,?)`).run(
    id, current.companyId, input.branch_id || null, current.warehouseId, input.picking_type,
    input.source_document_id, input.source_line_id || null, item.id, input.lot_id || null,
    input.serial_id || null, source.id, input.staging_location_id || null, destination.id,
    quantity, input.strategy || 'fifo', Number(input.route_sequence || 100), input.assigned_to || null,
    input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapTask(taskRow(db, id, input));
}

export function assignPickTask(db, input) {
  const row = taskRow(db, input.task_id, input);
  ensureState(row, ['ready', 'assigned'], 'PICK_ASSIGN_INVALID_STATE');
  if (!input.assigned_to) throw new PickingError('Operator assignment is required', 'PICK_OPERATOR_REQUIRED');
  db.prepare(`UPDATE wms_pick_tasks_v2 SET assigned_to=?,status='assigned',updated_at=? WHERE id=?`).run(input.assigned_to, now(), row.id);
  return mapTask(taskRow(db, row.id, input));
}

function expectedLocationScan(locationRow) {
  return locationRow.barcode || locationRow.location_code || locationRow.id;
}

export function scanPickSource(db, input) {
  const row = taskRow(db, input.task_id, input);
  ensureState(row, ['ready', 'assigned'], 'PICK_SOURCE_SCAN_INVALID_STATE');
  if (row.assigned_to && row.assigned_to !== input.actor) throw new PickingError('Task belongs to another operator', 'PICK_ASSIGNMENT_DENIED', 403);
  const current = { companyId: row.company_id, warehouseId: row.warehouse_id };
  const source = location(db, row.source_location_id, current, 'Source location');
  if (String(input.barcode || '') !== String(expectedLocationScan(source)) && String(input.barcode || '') !== source.id) {
    throw new PickingError('Source location barcode mismatch', 'PICK_SOURCE_SCAN_MISMATCH', 409);
  }
  if (source.is_blocked || ['quality_hold', 'quarantine'].includes(source.location_type)) throw new PickingError('Source stock is blocked or on quality hold', 'QUALITY_HOLD_REFUSAL', 409);
  db.prepare(`UPDATE wms_pick_tasks_v2 SET source_scan=?,assigned_to=COALESCE(assigned_to,?),status='source_scanned',updated_at=? WHERE id=?`).run(input.barcode, input.actor, now(), row.id);
  return mapTask(taskRow(db, row.id, input));
}

export function scanPickProduct(db, input) {
  const row = taskRow(db, input.task_id, input);
  ensureState(row, ['source_scanned'], 'PICK_PRODUCT_SCAN_INVALID_STATE');
  const item = product(db, row.product_id, row.company_id);
  const allowed = [item.id, item.sku, item.barcode].filter(Boolean).map(String);
  if (!allowed.includes(String(input.barcode || ''))) throw new PickingError('Product barcode mismatch', 'PICK_PRODUCT_SCAN_MISMATCH', 409);
  if (row.serial_id && String(input.lot_serial || '') !== String(row.serial_id)) throw new PickingError('Reserved serial does not match scan', 'PICK_SERIAL_MISMATCH', 409);
  db.prepare(`UPDATE wms_pick_tasks_v2 SET product_scan=?,lot_serial_scan=?,status='product_scanned',updated_at=? WHERE id=?`).run(input.barcode, input.lot_serial || null, now(), row.id);
  return mapTask(taskRow(db, row.id, input));
}

export function confirmPick(db, input) {
  const row = taskRow(db, input.task_id, input);
  ensureState(row, ['product_scanned'], 'PICK_CONFIRM_INVALID_STATE');
  const quantity = Number(input.quantity);
  if (quantity < 0 || quantity > Number(row.requested_quantity)) throw new PickingError('Confirmed quantity is outside task limits', 'INVALID_PICK_CONFIRMATION');
  if (quantity > available(db, row)) throw new PickingError('Canonical available quantity is insufficient', 'PICK_AVAILABLE_QUANTITY_EXCEEDED', 409);
  const short = Number(row.requested_quantity) - quantity;
  if (short > 0 && !input.short_reason) throw new PickingError('Short pick reason is required', 'SHORT_PICK_REASON_REQUIRED');
  if (input.substitute_product_id) {
    product(db, input.substitute_product_id, row.company_id);
    db.prepare(`UPDATE wms_pick_tasks_v2 SET status='exception',exception_code='SUBSTITUTE_REQUEST',exception_reason=?,substitute_product_id=?,updated_at=? WHERE id=?`).run(
      input.short_reason || 'Substitute requested', input.substitute_product_id, now(), row.id,
    );
    return mapTask(taskRow(db, row.id, input));
  }
  const status = short > 0 ? 'short' : 'picked';
  db.prepare(`UPDATE wms_pick_tasks_v2 SET picked_quantity=?,short_quantity=?,status=?,exception_code=?,exception_reason=?,proof_json=?,updated_at=? WHERE id=?`).run(
    quantity, short, status, short > 0 ? 'SHORT_PICK' : null, input.short_reason || null,
    JSON.stringify(Array.isArray(input.proof) ? input.proof.slice(0, 20) : []), now(), row.id,
  );
  return { ...mapTask(taskRow(db, row.id, input)), inventoryWritten: false };
}

export function stagePick(db, input) {
  const row = taskRow(db, input.task_id, input);
  ensureState(row, ['picked', 'short'], 'PICK_STAGE_INVALID_STATE');
  if (Number(row.picked_quantity) <= 0) throw new PickingError('Nothing was picked for staging', 'PICK_ZERO_QUANTITY', 409);
  const current = { companyId: row.company_id, warehouseId: row.warehouse_id };
  const staging = location(db, input.staging_location_id || row.staging_location_id, current, 'Staging location');
  if (!['staging', 'shipping_dock', 'bin'].includes(staging.location_type)) throw new PickingError('Destination is not a staging location', 'INVALID_STAGING_LOCATION', 409);
  db.prepare(`UPDATE wms_pick_tasks_v2 SET staging_location_id=?,status='staged',updated_at=? WHERE id=?`).run(staging.id, now(), row.id);
  return mapTask(taskRow(db, row.id, input));
}

export function requestPickPost(db, input) {
  const row = taskRow(db, input.task_id, input);
  ensureState(row, ['picked', 'short', 'staged', 'packed'], 'PICK_POST_INVALID_STATE');
  if (Number(row.picked_quantity) <= 0) throw new PickingError('Nothing was picked for canonical posting', 'PICK_ZERO_QUANTITY', 409);
  const item = product(db, row.product_id, row.company_id);
  if (!item.uom_id) throw new PickingError('Canonical Product UOM is required', 'PRODUCT_UOM_REQUIRED', 409);
  const request = {
    company_id: row.company_id, branch_id: row.branch_id, reference: `PICK/${row.id}`,
    product_id: row.product_id, product_qty: Number(row.picked_quantity),
    location_id: row.source_location_id, location_dest_id: row.staging_location_id || row.destination_location_id,
    lot_id: row.lot_id, serial_id: row.serial_id,
    source_document_type: row.picking_type, source_document_id: row.source_document_id,
    uom_id: item.uom_id,
    source_line_id: row.source_line_id, reservation_id: input.reservation_id || null,
    idempotency_key: `${row.id}:canonical-pick`,
  };
  db.prepare(`UPDATE wms_pick_tasks_v2 SET status='awaiting_canonical',canonical_request_json=?,updated_at=? WHERE id=?`).run(JSON.stringify(request), now(), row.id);
  return { ...mapTask(taskRow(db, row.id, input)), executionBoundary: 'REQUEST_ONLY', inventoryWritten: false };
}

export function acknowledgePickPost(db, input) {
  const row = taskRow(db, input.task_id, input);
  ensureState(row, ['awaiting_canonical'], 'PICK_ACK_INVALID_STATE');
  if (!input.canonical_result_id) throw new PickingError('Canonical stock move result is required', 'CANONICAL_RESULT_REQUIRED');
  const move = db.prepare('SELECT id,state,product_id,product_qty FROM stock_moves WHERE id=? AND company_id=?').get(input.canonical_result_id, row.company_id);
  if (!move || move.state !== 'done' || move.product_id !== row.product_id || Number(move.product_qty) !== Number(row.picked_quantity)) {
    throw new PickingError('Canonical move does not match completed pick', 'CANONICAL_PICK_MISMATCH', 409);
  }
  db.prepare(`UPDATE wms_pick_tasks_v2 SET canonical_result_id=?,status='completed',updated_at=? WHERE id=?`).run(move.id, now(), row.id);
  return mapTask(taskRow(db, row.id, input));
}

export function listPickTasks(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  let sql = 'SELECT * FROM wms_pick_tasks_v2 WHERE company_id=? AND warehouse_id=?';
  const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  if (input.assigned_to) { sql += ' AND assigned_to=?'; params.push(input.assigned_to); }
  if (input.wave_id) { sql += ' AND wave_id=?'; params.push(input.wave_id); }
  sql += ' ORDER BY route_sequence,created_at';
  return db.prepare(sql).all(...params).map(mapTask);
}
