// BUILD-09 dock scheduling, check-in, staging capacity, and departure control.
'use strict';
import crypto from 'node:crypto';

export class DockError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'DockError'; this.code = code; this.statusCode = statusCode; }
}
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

function scope(input) {
  if (!input.company_id) throw new DockError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new DockError('Warehouse is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}
function assertWarehouse(db, current) {
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND company_id=? AND is_active=1').get(current.warehouseId, current.companyId)) throw new DockError('Warehouse is outside company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
}
function dockRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_docks_v2 WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new DockError('Dock is outside warehouse scope', 'DOCK_SCOPE_DENIED', 403);
  return row;
}
function appointmentRow(db, id, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_dock_appointments_v2 WHERE id=? AND company_id=? AND warehouse_id=?').get(id, current.companyId, current.warehouseId);
  if (!row) throw new DockError('Appointment is outside warehouse scope', 'DOCK_APPOINTMENT_SCOPE_DENIED', 403);
  return row;
}
const mapDock = (row) => ({ id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id, code: row.code, name: row.name, dockType: row.dock_type, capacityUnits: Number(row.capacity_units), stagingLocationId: row.staging_location_id, active: !!row.is_active, createdBy: row.created_by });
const mapAppointment = (row) => ({
  id: row.id, companyId: row.company_id, branchId: row.branch_id, warehouseId: row.warehouse_id,
  appointmentType: row.appointment_type, sourceDocumentType: row.source_document_type, sourceDocumentId: row.source_document_id,
  carrierName: row.carrier_name, vehicleReference: row.vehicle_reference, supplierId: row.supplier_id, customerId: row.customer_id,
  expectedArrival: row.expected_arrival, expectedDeparture: row.expected_departure, actualArrival: row.actual_arrival,
  actualDeparture: row.actual_departure, dockId: row.dock_id, stagingLocationId: row.staging_location_id,
  expectedUnits: Number(row.expected_units), status: row.status, detentionStartedAt: row.detention_started_at,
  detentionEndedAt: row.detention_ended_at, notes: row.notes, createdBy: row.created_by,
  checkedInBy: row.checked_in_by, assignedBy: row.assigned_by, createdAt: row.created_at, updatedAt: row.updated_at,
});
function locationInScope(db, id, current, allowedTypes = []) {
  const row = db.prepare(`SELECT p.*,l.is_active FROM wms_location_profiles p JOIN stock_locations l ON l.id=p.location_id
    WHERE p.location_id=? AND p.company_id=? AND p.warehouse_id=? AND p.retired_at IS NULL AND l.is_active=1`).get(id, current.companyId, current.warehouseId);
  if (!row) throw new DockError('Location is outside warehouse scope', 'LOCATION_SCOPE_DENIED', 403);
  if (allowedTypes.length && !allowedTypes.includes(row.location_type)) throw new DockError('Location type is not valid for this operation', 'INVALID_LOCATION_TYPE', 409);
  return row;
}
function conflict(db, dockId, arrival, departure, exceptId = '') {
  return db.prepare(`SELECT id FROM wms_dock_appointments_v2 WHERE dock_id=? AND id<>? AND status NOT IN ('departed','cancelled')
    AND expected_arrival < ? AND expected_departure > ? LIMIT 1`).get(dockId, exceptId, departure, arrival);
}
function ensureState(row, allowed, code) { if (!allowed.includes(row.status)) throw new DockError(`Appointment is ${row.status}`, code, 409); }

export function createDock(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  if (!input.code || !input.name || !['inbound', 'outbound', 'mixed'].includes(input.dock_type)) throw new DockError('Dock code, name, and type are required', 'INVALID_DOCK');
  if (input.staging_location_id) locationInScope(db, input.staging_location_id, current, ['staging', 'receiving_dock', 'shipping_dock']);
  const id = uid('dock'); const stamp = now();
  db.prepare(`INSERT INTO wms_docks_v2(id,company_id,warehouse_id,code,name,dock_type,capacity_units,staging_location_id,is_active,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, current.companyId, current.warehouseId, String(input.code).trim().toUpperCase(), input.name, input.dock_type, Number(input.capacity_units || 1), input.staging_location_id || null, input.actor, stamp, stamp);
  return mapDock(dockRow(db, id, input));
}

export function createDockAppointment(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  if (!['inbound', 'outbound'].includes(input.appointment_type) || !input.expected_arrival || !input.expected_departure || input.expected_departure <= input.expected_arrival) throw new DockError('Valid appointment type and time window are required', 'INVALID_DOCK_APPOINTMENT');
  if (input.idempotency_key) {
    const replay = db.prepare('SELECT * FROM wms_dock_appointments_v2 WHERE idempotency_key=?').get(input.idempotency_key);
    if (replay) return mapAppointment(appointmentRow(db, replay.id, input));
  }
  let dock = null;
  if (input.dock_id) {
    dock = dockRow(db, input.dock_id, input);
    if (dock.dock_type !== 'mixed' && dock.dock_type !== input.appointment_type) throw new DockError('Dock direction does not match appointment', 'DOCK_DIRECTION_MISMATCH', 409);
    if (conflict(db, dock.id, input.expected_arrival, input.expected_departure)) throw new DockError('Dock has a conflicting appointment', 'DOCK_APPOINTMENT_CONFLICT', 409);
  }
  if (input.staging_location_id) locationInScope(db, input.staging_location_id, current, ['staging', 'receiving_dock', 'shipping_dock']);
  const id = uid('dockappt'); const stamp = now();
  db.prepare(`INSERT INTO wms_dock_appointments_v2(
    id,company_id,branch_id,warehouse_id,appointment_type,source_document_type,source_document_id,carrier_name,vehicle_reference,
    supplier_id,customer_id,expected_arrival,expected_departure,dock_id,staging_location_id,expected_units,status,created_by,created_at,updated_at,idempotency_key
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, current.companyId, input.branch_id || null, current.warehouseId, input.appointment_type,
    input.source_document_type || null, input.source_document_id || null, input.carrier_name || null,
    input.vehicle_reference || null, input.supplier_id || null, input.customer_id || null,
    input.expected_arrival, input.expected_departure, dock?.id || null, input.staging_location_id || dock?.staging_location_id || null,
    Number(input.expected_units || 0), dock ? 'scheduled' : 'expected', input.actor, stamp, stamp, input.idempotency_key || null,
  );
  return mapAppointment(appointmentRow(db, id, input));
}

export function checkInDockAppointment(db, input) {
  const row = appointmentRow(db, input.appointment_id, input); ensureState(row, ['expected', 'scheduled'], 'DOCK_CHECKIN_INVALID_STATE');
  const stamp = input.actual_arrival || now();
  const late = stamp > row.expected_arrival;
  db.prepare(`UPDATE wms_dock_appointments_v2 SET actual_arrival=?,vehicle_reference=COALESCE(?,vehicle_reference),status='checked_in',detention_started_at=?,checked_in_by=?,updated_at=? WHERE id=?`).run(stamp, input.vehicle_reference || null, late ? stamp : null, input.actor, now(), row.id);
  return mapAppointment(appointmentRow(db, row.id, input));
}

export function assignDock(db, input) {
  const row = appointmentRow(db, input.appointment_id, input); ensureState(row, ['expected', 'scheduled', 'checked_in'], 'DOCK_ASSIGN_INVALID_STATE');
  const dock = dockRow(db, input.dock_id, input);
  if (!dock.is_active || (dock.dock_type !== 'mixed' && dock.dock_type !== row.appointment_type)) throw new DockError('Dock is unavailable for this appointment', 'DOCK_UNAVAILABLE', 409);
  if (Number(row.expected_units) > Number(dock.capacity_units)) throw new DockError('Appointment exceeds dock capacity', 'DOCK_CAPACITY_EXCEEDED', 409);
  if (conflict(db, dock.id, row.expected_arrival, row.expected_departure, row.id)) throw new DockError('Dock has a conflicting appointment', 'DOCK_APPOINTMENT_CONFLICT', 409);
  db.prepare(`UPDATE wms_dock_appointments_v2 SET dock_id=?,staging_location_id=COALESCE(staging_location_id,?),status='dock_assigned',assigned_by=?,updated_at=? WHERE id=?`).run(dock.id, dock.staging_location_id, input.actor, now(), row.id);
  return mapAppointment(appointmentRow(db, row.id, input));
}

export function startDockService(db, input) {
  const row = appointmentRow(db, input.appointment_id, input); ensureState(row, ['dock_assigned'], 'DOCK_SERVICE_INVALID_STATE');
  const status = row.appointment_type === 'inbound' ? 'unloading' : 'loading';
  db.prepare('UPDATE wms_dock_appointments_v2 SET status=?,updated_at=? WHERE id=?').run(status, now(), row.id);
  return mapAppointment(appointmentRow(db, row.id, input));
}

export function allocateStaging(db, input) {
  const current = scope(input); assertWarehouse(db, current);
  const staging = locationInScope(db, input.staging_location_id, current, ['staging', 'receiving_dock', 'shipping_dock']);
  const quantity = Number(input.quantity); if (!(quantity > 0)) throw new DockError('Staging quantity must be positive', 'INVALID_STAGING_QUANTITY');
  const occupied = db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM wms_staging_allocations WHERE staging_location_id=? AND status IN ('reserved','occupied','partially_released')`).get(staging.location_id).quantity;
  if (staging.capacity_units != null && Number(occupied) + quantity > Number(staging.capacity_units)) throw new DockError('Staging lane capacity exceeded', 'STAGING_CAPACITY_EXCEEDED', 409);
  const id = uid('stagealloc'); const stamp = now();
  db.prepare(`INSERT INTO wms_staging_allocations(id,company_id,warehouse_id,staging_location_id,source_type,source_id,product_id,quantity,capacity_before,capacity_after,status,allocated_by,allocated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'occupied',?,?)`).run(id, current.companyId, current.warehouseId, staging.location_id, input.source_type, input.source_id, input.product_id || null, quantity, Number(occupied), Number(occupied) + quantity, input.actor, stamp);
  return db.prepare('SELECT * FROM wms_staging_allocations WHERE id=?').get(id);
}

export function releaseStaging(db, input) {
  const current = scope(input);
  const row = db.prepare('SELECT * FROM wms_staging_allocations WHERE id=? AND company_id=? AND warehouse_id=?').get(input.allocation_id, current.companyId, current.warehouseId);
  if (!row) throw new DockError('Staging allocation is outside warehouse scope', 'STAGING_SCOPE_DENIED', 403);
  if (!['reserved', 'occupied', 'partially_released'].includes(row.status)) throw new DockError('Staging allocation is not releasable', 'STAGING_RELEASE_INVALID_STATE', 409);
  const release = Number(input.quantity || row.quantity); if (release <= 0 || release > Number(row.quantity)) throw new DockError('Release quantity is invalid', 'INVALID_STAGING_RELEASE');
  const remaining = Number(row.quantity) - release; const status = remaining ? 'partially_released' : 'released';
  db.prepare('UPDATE wms_staging_allocations SET quantity=?,status=?,released_at=? WHERE id=?').run(remaining || row.quantity, status, status === 'released' ? now() : null, row.id);
  return db.prepare('SELECT * FROM wms_staging_allocations WHERE id=?').get(row.id);
}

export function departDockAppointment(db, input) {
  const row = appointmentRow(db, input.appointment_id, input); ensureState(row, ['unloading', 'loading', 'staged', 'crossdock_review', 'ready_to_depart'], 'DOCK_DEPART_INVALID_STATE');
  const open = db.prepare(`SELECT COUNT(*) count FROM wms_crossdock_matches WHERE (inbound_appointment_id=? OR outbound_appointment_id=?) AND status IN ('approved','task_created','awaiting_canonical')`).get(row.id, row.id).count;
  if (open) throw new DockError('Cross-dock tasks remain open', 'CROSSDOCK_TASKS_OPEN', 409);
  const stamp = now();
  db.prepare(`UPDATE wms_dock_appointments_v2 SET status='departed',actual_departure=?,detention_ended_at=CASE WHEN detention_started_at IS NULL THEN NULL ELSE ? END,updated_at=? WHERE id=?`).run(stamp, stamp, stamp, row.id);
  return mapAppointment(appointmentRow(db, row.id, input));
}

export function cancelDockAppointment(db, input) {
  const row = appointmentRow(db, input.appointment_id, input); ensureState(row, ['expected', 'scheduled', 'checked_in', 'dock_assigned', 'conflict', 'blocked'], 'DOCK_CANCEL_INVALID_STATE');
  db.prepare(`UPDATE wms_dock_appointments_v2 SET status='cancelled',notes=COALESCE(?,notes),updated_at=? WHERE id=?`).run(input.reason || null, now(), row.id);
  return mapAppointment(appointmentRow(db, row.id, input));
}

export function listDocks(db, input) { const current = scope(input); assertWarehouse(db, current); return db.prepare('SELECT * FROM wms_docks_v2 WHERE company_id=? AND warehouse_id=? ORDER BY code').all(current.companyId, current.warehouseId).map(mapDock); }
export function listDockAppointments(db, input) {
  const current = scope(input); assertWarehouse(db, current); let sql = 'SELECT * FROM wms_dock_appointments_v2 WHERE company_id=? AND warehouse_id=?'; const params = [current.companyId, current.warehouseId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); } sql += ' ORDER BY expected_arrival'; return db.prepare(sql).all(...params).map(mapAppointment);
}
export function listStagingAllocations(db, input) { const current = scope(input); assertWarehouse(db, current); return db.prepare(`SELECT * FROM wms_staging_allocations WHERE company_id=? AND warehouse_id=? AND (?='' OR status=?) ORDER BY allocated_at`).all(current.companyId, current.warehouseId, input.status || '', input.status || ''); }
