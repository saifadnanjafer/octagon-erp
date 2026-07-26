// Canonical Fleet foundation.
//
// A vehicle is not a parallel universe. It is an **asset** (`assets` row) that
// happens to move, and servicing it is a **maintenance order**. This module owns
// only what is genuinely vehicle-specific: registration and document expiry,
// drivers and assignments, trips and odometer, fuel and fuel variance,
// incidents, and telemetry ingestion.
//
// Hardware is behind a provider adapter (`fleet_telemetry_providers`), so no OBD
// or tank-sensor vendor is hard-coded anywhere in this file.

import {
  createDomainError, domainGuards, makeId, nowIso, today, round2, round6,
} from '../kernel/domain/kit.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { createOrder as createMaintenanceOrder } from '../maintenance/maintenance.mjs';
import { getPolicyNumber } from '../control_plane/phase05.mjs';

export const FleetError = createDomainError('FleetError', 'FLEET_ERROR');
const g = domainGuards(FleetError);

export function createVehicleType(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  g.requireActor(payload);
  const code = g.requireText(payload.code, 'vehicle type code');
  const id = payload.id || makeId('fvt');
  db.prepare(`
    INSERT INTO fleet_vehicle_types (id, company_id, code, name, category, expected_consumption_per_100, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, code) DO UPDATE SET
      name = excluded.name, category = excluded.category,
      expected_consumption_per_100 = excluded.expected_consumption_per_100
  `).run(
    id, companyId, code, g.requireText(payload.name, 'vehicle type name'),
    payload.category || 'truck',
    g.nonNegative(payload.expected_consumption_per_100, 'expected_consumption_per_100'), nowIso(),
  );
  return db.prepare('SELECT * FROM fleet_vehicle_types WHERE company_id = ? AND code = ?').get(companyId, code);
}

/**
 * Create a vehicle. When `asset_id` is supplied the vehicle is bound to that
 * existing asset; otherwise the caller is expected to create the asset first —
 * a vehicle with no asset can still be tracked operationally but will not
 * depreciate, and `getVehicle` reports that explicitly rather than hiding it.
 */
export function createVehicle(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const name = g.requireText(payload.name, 'vehicle name');
  if (payload.asset_id) g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  if (payload.vehicle_type_id) g.scopedRow(db, 'fleet_vehicle_types', payload.vehicle_type_id, companyId, 'vehicle type');

  const plate = payload.plate_number ? String(payload.plate_number).trim() : null;
  if (plate) {
    const duplicate = db.prepare('SELECT id FROM fleet_vehicles WHERE company_id = ? AND plate_number = ?').get(companyId, plate);
    if (duplicate) throw new FleetError(`plate number already registered: ${plate}`, 'FLEET_DUPLICATE_PLATE', 409);
  }

  const type = payload.vehicle_type_id
    ? db.prepare('SELECT * FROM fleet_vehicle_types WHERE id = ?').get(payload.vehicle_type_id)
    : null;
  const id = payload.id || makeId('fveh');
  const now = nowIso();
  db.prepare(`
    INSERT INTO fleet_vehicles (
      id, company_id, branch_id, asset_id, vehicle_type_id, name, plate_number,
      chassis_vin, registration_number, ownership, lease_party_id, lease_start, lease_end,
      fuel_type, tank_capacity, expected_consumption_per_100, odometer, engine_hours,
      state, currency, created_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(
    id, companyId, payload.branch_id || null, payload.asset_id || null,
    payload.vehicle_type_id || null, name, plate, payload.chassis_vin || null,
    payload.registration_number || null, payload.ownership || 'owned',
    payload.lease_party_id || null, payload.lease_start || null, payload.lease_end || null,
    payload.fuel_type || 'diesel', g.nonNegative(payload.tank_capacity, 'tank_capacity'),
    g.nonNegative(payload.expected_consumption_per_100 ?? type?.expected_consumption_per_100, 'expected_consumption_per_100'),
    g.nonNegative(payload.odometer, 'odometer'), g.nonNegative(payload.engine_hours, 'engine_hours'),
    payload.currency || 'IQD', now, actor, now,
  );
  return getVehicle(db, id, companyId);
}

export function registerDriver(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  g.requireActor(payload);
  const driverRef = g.requireText(payload.driver_ref, 'driver_ref');
  const id = payload.id || makeId('fdrv');
  db.prepare(`
    INSERT INTO fleet_drivers (id, company_id, driver_ref, name, licence_number, licence_expiry, phone, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(company_id, driver_ref) DO UPDATE SET
      name = excluded.name, licence_number = excluded.licence_number,
      licence_expiry = excluded.licence_expiry, phone = excluded.phone, is_active = 1
  `).run(
    id, companyId, driverRef, g.requireText(payload.name || driverRef, 'driver name'),
    payload.licence_number || null, payload.licence_expiry || null, payload.phone || null, nowIso(),
  );
  return db.prepare('SELECT * FROM fleet_drivers WHERE company_id = ? AND driver_ref = ?').get(companyId, driverRef);
}

export function assignDriver(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const vehicle = g.scopedRow(db, 'fleet_vehicles', payload.vehicle_id, companyId, 'vehicle');
  const driver = g.scopedRow(db, 'fleet_drivers', payload.driver_id, companyId, 'driver');
  const now = nowIso();
  db.prepare('UPDATE fleet_assignments SET released_at = ? WHERE vehicle_id = ? AND released_at IS NULL')
    .run(now, vehicle.id);
  const id = payload.id || makeId('fasg');
  db.prepare(`
    INSERT INTO fleet_assignments (id, company_id, vehicle_id, driver_id, assigned_at, released_at, assigned_by)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run(id, companyId, vehicle.id, driver.id, now, actor);
  return db.prepare('SELECT * FROM fleet_assignments WHERE id = ?').get(id);
}

export function registerDocument(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const vehicle = g.scopedRow(db, 'fleet_vehicles', payload.vehicle_id, companyId, 'vehicle');
  const documentType = payload.document_type;
  if (!['registration', 'insurance', 'licence', 'inspection', 'permit', 'other'].includes(documentType)) {
    throw new FleetError(`unsupported document_type: ${documentType}`, 'INPUT_INVALID');
  }
  const expiresOn = g.requireText(payload.expires_on, 'expires_on');
  const id = payload.id || makeId('fdoc');
  db.prepare(`
    INSERT INTO fleet_documents (
      id, company_id, vehicle_id, document_type, reference, provider_party_id,
      issued_on, expires_on, alert_days_before, cost, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, vehicle.id, documentType, payload.reference || null,
    payload.provider_party_id || null, payload.issued_on || null, expiresOn,
    Number(payload.alert_days_before || 30), g.nonNegative(payload.cost, 'cost'), nowIso(), actor,
  );
  return db.prepare('SELECT * FROM fleet_documents WHERE id = ?').get(id);
}

// --------------------------------------------------------------------------
// Trips and odometer
// --------------------------------------------------------------------------

export function startTrip(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const vehicle = g.scopedRow(db, 'fleet_vehicles', payload.vehicle_id, companyId, 'vehicle');
  if (vehicle.state !== 'active') {
    throw new FleetError(`vehicle is ${vehicle.state} and cannot start a trip`, 'FLEET_VEHICLE_UNAVAILABLE');
  }
  const open = db.prepare(
    "SELECT id FROM fleet_trips WHERE company_id = ? AND vehicle_id = ? AND state = 'in_progress'",
  ).get(companyId, vehicle.id);
  if (open) throw new FleetError('this vehicle already has a trip in progress', 'FLEET_TRIP_OPEN', 409);

  if (payload.driver_id) g.scopedRow(db, 'fleet_drivers', payload.driver_id, companyId, 'driver');
  if (payload.project_id) g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');

  const id = payload.id || makeId('ftrip');
  const reference = payload.reference || g.nextReference(db, 'fleet_trips', companyId, 'TRIP');
  db.prepare(`
    INSERT INTO fleet_trips (
      id, company_id, vehicle_id, driver_id, project_id, reference, route, origin,
      destination, dispatch_note, started_at, ended_at, start_odometer, end_odometer,
      distance_km, state, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, 'in_progress', ?)
  `).run(
    id, companyId, vehicle.id, payload.driver_id || null, payload.project_id || null,
    reference, payload.route || null, payload.origin || null, payload.destination || null,
    payload.dispatch_note || null, payload.started_at || nowIso(),
    Number(payload.start_odometer ?? vehicle.odometer), actor,
  );
  return db.prepare('SELECT * FROM fleet_trips WHERE id = ?').get(id);
}

export function completeTrip(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const trip = g.scopedRow(db, 'fleet_trips', payload.trip_id, companyId, 'trip');
  g.assertState(trip.state, ['in_progress', 'planned'], 'trip', 'FLEET_STATE_INVALID');
  const endOdometer = g.nonNegative(payload.end_odometer, 'end_odometer');
  if (endOdometer < Number(trip.start_odometer)) {
    throw new FleetError(
      `end odometer ${endOdometer} is lower than the start odometer ${trip.start_odometer}`,
      'FLEET_ODOMETER_REGRESSION',
    );
  }
  const distance = round6(endOdometer - Number(trip.start_odometer));
  const now = nowIso();
  db.prepare(`
    UPDATE fleet_trips SET state = 'completed', ended_at = ?, end_odometer = ?, distance_km = ? WHERE id = ?
  `).run(payload.ended_at || now, endOdometer, distance, trip.id);
  db.prepare('UPDATE fleet_vehicles SET odometer = MAX(odometer, ?), updated_at = ? WHERE id = ?')
    .run(endOdometer, now, trip.vehicle_id);
  return { ...db.prepare('SELECT * FROM fleet_trips WHERE id = ?').get(trip.id), distance_km: distance };
}

export function recordOdometer(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const vehicle = g.scopedRow(db, 'fleet_vehicles', payload.vehicle_id, companyId, 'vehicle');
  const reading = g.nonNegative(payload.reading, 'reading');
  if (reading < Number(vehicle.odometer) && !payload.allow_rollback) {
    throw new FleetError(
      `odometer reading ${reading} is lower than the current reading ${vehicle.odometer}`,
      'FLEET_ODOMETER_REGRESSION',
    );
  }
  const now = nowIso();
  db.prepare('UPDATE fleet_vehicles SET odometer = ?, engine_hours = COALESCE(?, engine_hours), updated_at = ? WHERE id = ?')
    .run(reading, payload.engine_hours ?? null, now, vehicle.id);

  // Keep the asset meter in step, so meter-triggered preventive maintenance
  // works for vehicles without a fleet-specific trigger engine.
  if (vehicle.asset_id) {
    db.prepare(`
      INSERT INTO asset_meter_readings (
        id, asset_id, company_id, meter_type, reading, reading_at, recorded_by, source, created_at
      ) VALUES (?, ?, ?, 'kilometers', ?, ?, ?, 'fleet', ?)
    `).run(
      makeId('assetmtr'), vehicle.asset_id, companyId, reading, now,
      payload.actor || 'system', now,
    );
  }
  return { vehicle_id: vehicle.id, odometer: reading };
}

// --------------------------------------------------------------------------
// Fuel
// --------------------------------------------------------------------------

/**
 * Record a fuel transaction and compute its variance against expected
 * consumption for the distance actually covered since the previous fill.
 *
 * When the fuel comes from an internal tank that is a stock location, the
 * quantity moves through the canonical stock engine. When it comes from a
 * third-party station, the cost posts through the Phase 03 pipeline if accounts
 * are supplied. Either way, the fleet keeps no fuel ledger of its own.
 */
export function recordFuelTransaction(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const vehicle = g.scopedRow(db, 'fleet_vehicles', payload.vehicle_id, companyId, 'vehicle');
  const quantity = g.positive(payload.quantity, 'quantity');
  const unitPrice = g.nonNegative(payload.unit_price, 'unit_price');
  const amount = payload.amount !== undefined
    ? g.nonNegative(payload.amount, 'amount')
    : round2(quantity * unitPrice);

  // Duplicate protection for imported card/telemetry feeds.
  if (payload.external_reference) {
    const duplicate = db.prepare(
      'SELECT id FROM fleet_fuel_transactions WHERE company_id = ? AND external_reference = ?',
    ).get(companyId, payload.external_reference);
    if (duplicate) {
      throw new FleetError(
        `fuel transaction ${payload.external_reference} has already been recorded`,
        'FLEET_DUPLICATE_FUEL_TRANSACTION', 409,
      );
    }
  }
  if (Number(vehicle.tank_capacity) > 0 && quantity > Number(vehicle.tank_capacity) && !payload.allow_over_capacity) {
    throw new FleetError(
      `fuelled quantity ${quantity} exceeds the tank capacity ${vehicle.tank_capacity}`,
      'FLEET_FUEL_OVER_CAPACITY',
    );
  }

  const odometer = payload.odometer === undefined ? null : g.nonNegative(payload.odometer, 'odometer');
  const previous = db.prepare(`
    SELECT odometer FROM fleet_fuel_transactions
    WHERE company_id = ? AND vehicle_id = ? AND odometer IS NOT NULL
    ORDER BY recorded_at DESC LIMIT 1
  `).get(companyId, vehicle.id);

  let expected = null;
  let varianceQuantity = null;
  let variancePercent = null;
  const rate = Number(vehicle.expected_consumption_per_100 || 0);
  if (odometer !== null && previous && rate > 0) {
    const distance = round6(odometer - Number(previous.odometer));
    if (distance > 0) {
      expected = round6((distance / 100) * rate);
      varianceQuantity = round6(quantity - expected);
      variancePercent = expected > 0 ? round2((varianceQuantity / expected) * 100) : null;
    }
  }

  let stockMoveId = null;
  if (payload.tank_id) {
    const tank = g.scopedRow(db, 'fleet_fuel_tanks', payload.tank_id, companyId, 'fuel tank');
    if (tank.location_id && tank.product_id) {
      const warehouseId = db.prepare('SELECT warehouse_id FROM stock_locations WHERE id = ?').get(tank.location_id)?.warehouse_id;
      if (!warehouseId) {
        throw new FleetError('the fuel tank location is not inside a warehouse', 'FLEET_TANK_LOCATION_INVALID');
      }
      const consumption = ensureFleetConsumptionLocation(db, companyId, warehouseId);
      const uomId = db.prepare(
        'SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?',
      ).get(tank.product_id)?.uom_id;
      const move = executeStockOperation(db, {
        company_id: companyId,
        branch_id: vehicle.branch_id || null,
        actor,
        tenant_id: payload.tenant_id || null,
        reference: `${vehicle.plate_number || vehicle.name}/FUEL`,
        product_id: tank.product_id,
        uom_id: uomId,
        product_qty: quantity,
        location_id: tank.location_id,
        location_dest_id: consumption.id,
        source_document_type: 'fleet_fuel',
        source_document_id: vehicle.id,
        idempotency_key: payload.stock_idempotency_key || `fleet-fuel:${vehicle.id}:${payload.external_reference || makeId('n')}`,
      });
      stockMoveId = move.id;
      db.prepare('UPDATE fleet_fuel_tanks SET current_level = MAX(0, current_level - ?) WHERE id = ?')
        .run(quantity, tank.id);
    }
  }

  let financeDocumentId = null;
  if (!stockMoveId && amount > 0 && payload.expense_account_id && payload.credit_account_id) {
    const posted = postSourceFact(db, g.financeContext(payload), {
      fact_type: 'project_cost_posting',
      source_id: `${vehicle.id}:fuel:${payload.external_reference || nowIso()}`,
      doc_date: payload.doc_date || today(),
      currency: payload.currency || vehicle.currency || 'IQD',
      lines: [
        { account_id: payload.expense_account_id, debit: amount, credit: 0, description: `fleet_fuel:${vehicle.plate_number || vehicle.name}` },
        { account_id: payload.credit_account_id, debit: 0, credit: amount, description: `fleet_fuel:${vehicle.plate_number || vehicle.name}` },
      ],
    });
    financeDocumentId = posted.document_id;
  }

  const id = payload.id || makeId('ffuel');
  const now = nowIso();
  db.prepare(`
    INSERT INTO fleet_fuel_transactions (
      id, company_id, vehicle_id, driver_id, trip_id, tank_id, fuel_card_id, product_id,
      quantity, unit_price, amount, currency, odometer, expected_quantity,
      variance_quantity, variance_percent, source, external_reference, stock_move_id,
      finance_document_id, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, vehicle.id, payload.driver_id || null, payload.trip_id || null,
    payload.tank_id || null, payload.fuel_card_id || null, payload.product_id || null,
    quantity, unitPrice, amount, payload.currency || vehicle.currency || 'IQD',
    odometer, expected, varianceQuantity, variancePercent,
    payload.source || 'manual', payload.external_reference || null,
    stockMoveId, financeDocumentId, actor, now,
  );

  if (odometer !== null && odometer > Number(vehicle.odometer)) {
    db.prepare('UPDATE fleet_vehicles SET odometer = ?, updated_at = ? WHERE id = ?').run(odometer, now, vehicle.id);
  }

  // A variance beyond the company tolerance raises an alert rather than being
  // silently absorbed — the whole point of tracking expected consumption.
  const tolerance = getPolicyNumber(db, companyId, 'fleet_fuel_variance_tolerance_percent', 10);
  let alertId = null;
  if (variancePercent !== null && Math.abs(variancePercent) > tolerance) {
    alertId = raiseAlert(db, {
      company_id: companyId,
      vehicle_id: vehicle.id,
      alert_type: 'fuel_variance',
      severity: Math.abs(variancePercent) > tolerance * 2 ? 'high' : 'medium',
      message: `Fuel variance ${variancePercent}% exceeds the ${tolerance}% tolerance `
        + `(expected ${expected}, actual ${quantity})`,
      source_reference: id,
    }).id;
  }

  return {
    id,
    vehicle_id: vehicle.id,
    quantity,
    amount,
    expected_quantity: expected,
    variance_quantity: varianceQuantity,
    variance_percent: variancePercent,
    tolerance_percent: tolerance,
    stock_move_id: stockMoveId,
    finance_document_id: financeDocumentId,
    alert_id: alertId,
  };
}

/**
 * Fleet fuel consumption location. Same reasoning as project and maintenance
 * consumption: fuel burned by a vehicle is a fleet expense, never manufacturing
 * work in progress, so it uses the distinct `consumption` usage and posts to the
 * product category's expense account.
 */
export function ensureFleetConsumptionLocation(db, companyId, warehouseId) {
  const existing = db.prepare(`
    SELECT * FROM stock_locations
    WHERE company_id = ? AND warehouse_id = ? AND usage = 'consumption'
      AND name = 'Fleet Consumption'
    ORDER BY created_at LIMIT 1
  `).get(companyId, warehouseId);
  if (existing) return existing;
  const warehouse = g.scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');
  const id = makeId('loc_flt');
  db.prepare(`
    INSERT INTO stock_locations (
      id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at
    ) VALUES (?, ?, ?, ?, 'Fleet Consumption', ?, 'consumption', 0, ?)
  `).run(id, companyId, warehouseId, warehouse.view_location_id, `${warehouse.code}/FleetConsumption`, nowIso());
  return db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(id);
}

// --------------------------------------------------------------------------
// Incidents, alerts and telemetry
// --------------------------------------------------------------------------

export function recordIncident(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const vehicle = g.scopedRow(db, 'fleet_vehicles', payload.vehicle_id, companyId, 'vehicle');
  const incidentType = payload.incident_type;
  if (!['accident', 'violation', 'breakdown', 'theft', 'damage', 'other'].includes(incidentType)) {
    throw new FleetError(`unsupported incident_type: ${incidentType}`, 'INPUT_INVALID');
  }

  // A breakdown or accident becomes real maintenance work through the canonical
  // maintenance engine — fleet does not repair anything itself.
  let maintenanceOrderId = null;
  let workItemId = null;
  if (payload.create_maintenance_order || ['accident', 'breakdown', 'damage'].includes(incidentType)) {
    const order = createMaintenanceOrder(db, {
      company_id: companyId, actor, actor_id: actor,
      branch_id: vehicle.branch_id || null,
      asset_id: vehicle.asset_id || null,
      vehicle_id: vehicle.id,
      title: `${incidentType} — ${vehicle.plate_number || vehicle.name}`,
      description: payload.description || `Fleet ${incidentType}`,
      maintenance_type: incidentType === 'accident' ? 'emergency' : 'corrective',
      priority: incidentType === 'accident' ? 'urgent' : 'high',
      symptom: payload.description || null,
    });
    maintenanceOrderId = order.id;
    workItemId = order.work_item_id;
  }

  const id = payload.id || makeId('finc');
  db.prepare(`
    INSERT INTO fleet_incidents (
      id, company_id, vehicle_id, driver_id, incident_type, description, occurred_at,
      cost, maintenance_order_id, work_item_id, status, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id, companyId, vehicle.id, payload.driver_id || null, incidentType,
    payload.description || null, payload.occurred_at || nowIso(),
    g.nonNegative(payload.cost, 'cost'), maintenanceOrderId, workItemId, nowIso(), actor,
  );
  return {
    ...db.prepare('SELECT * FROM fleet_incidents WHERE id = ?').get(id),
    maintenance_order_id: maintenanceOrderId,
  };
}

export function raiseAlert(db, payload = {}) {
  const companyId = payload.company_id;
  const id = payload.id || makeId('falert');
  db.prepare(`
    INSERT INTO fleet_alerts (
      id, company_id, vehicle_id, alert_type, severity, message, source_reference,
      status, raised_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)
  `).run(
    id, companyId, payload.vehicle_id || null, payload.alert_type,
    payload.severity || 'medium', payload.message, payload.source_reference || null, nowIso(),
  );
  return db.prepare('SELECT * FROM fleet_alerts WHERE id = ?').get(id);
}

export function registerTelemetryProvider(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  g.requireActor(payload);
  const code = g.requireText(payload.provider_code, 'provider_code');
  const kind = payload.provider_kind;
  if (!['obd', 'gps', 'tank_sensor', 'tyre', 'camera', 'other'].includes(kind)) {
    throw new FleetError(`unsupported provider_kind: ${kind}`, 'INPUT_INVALID');
  }
  const id = payload.id || makeId('ftprov');
  db.prepare(`
    INSERT INTO fleet_telemetry_providers (id, company_id, provider_code, provider_kind, config, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(company_id, provider_code) DO UPDATE SET
      provider_kind = excluded.provider_kind, config = excluded.config, is_active = 1
  `).run(id, companyId, code, kind, JSON.stringify(payload.config || {}), nowIso());
  return db.prepare('SELECT * FROM fleet_telemetry_providers WHERE company_id = ? AND provider_code = ?').get(companyId, code);
}

/**
 * Ingest one telemetry event through a registered provider adapter.
 *
 * The provider must be registered first — an unknown provider is rejected
 * rather than accepted on trust, and no vendor's payload shape is assumed: the
 * raw payload is stored verbatim and only the fields Octagon understands
 * (odometer, hours, position, speed, fuel level) are promoted to columns.
 */
export function ingestTelemetry(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const vehicle = g.scopedRow(db, 'fleet_vehicles', payload.vehicle_id, companyId, 'vehicle');
  const providerCode = g.requireText(payload.provider || payload.provider_code, 'provider');
  const provider = db.prepare(
    'SELECT * FROM fleet_telemetry_providers WHERE company_id = ? AND provider_code = ? AND is_active = 1',
  ).get(companyId, providerCode);
  if (!provider) {
    throw new FleetError(
      `telemetry provider ${providerCode} is not registered for this company`,
      'FLEET_PROVIDER_NOT_REGISTERED',
    );
  }
  const eventType = g.requireText(payload.event_type, 'event_type');

  if (payload.external_reference) {
    const duplicate = db.prepare(`
      SELECT id FROM fleet_telemetry_events
      WHERE company_id = ? AND provider_code = ? AND external_reference = ?
    `).get(companyId, providerCode, payload.external_reference);
    if (duplicate) return { id: duplicate.id, duplicate: true };
  }

  const id = payload.id || makeId('ftel');
  const now = nowIso();
  db.prepare(`
    INSERT INTO fleet_telemetry_events (
      id, company_id, vehicle_id, provider_code, event_type, payload, odometer,
      engine_hours, latitude, longitude, speed_kph, fuel_level, occurred_at,
      external_reference, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, vehicle.id, providerCode, eventType,
    JSON.stringify(payload.payload || {}),
    payload.odometer ?? null, payload.engine_hours ?? null,
    payload.latitude ?? null, payload.longitude ?? null,
    payload.speed_kph ?? null, payload.fuel_level ?? null,
    payload.occurred_at || now, payload.external_reference || null, now,
  );

  if (payload.odometer !== undefined && payload.odometer !== null
    && Number(payload.odometer) > Number(vehicle.odometer)) {
    recordOdometer(db, {
      company_id: companyId,
      actor: payload.actor,
      actor_id: payload.actor,
      vehicle_id: vehicle.id,
      reading: payload.odometer,
      engine_hours: payload.engine_hours,
    });
  }

  const alerts = [];
  if (payload.speed_kph !== undefined && payload.speed_kph !== null) {
    const limit = db.prepare(
      'SELECT speed_limit_kph FROM fleet_geofences WHERE company_id = ? AND is_active = 1 AND speed_limit_kph IS NOT NULL ORDER BY speed_limit_kph LIMIT 1',
    ).get(companyId)?.speed_limit_kph;
    if (limit && Number(payload.speed_kph) > Number(limit)) {
      alerts.push(raiseAlert(db, {
        company_id: companyId,
        vehicle_id: vehicle.id,
        alert_type: 'speed_limit',
        severity: 'high',
        message: `Speed ${payload.speed_kph} km/h exceeds the ${limit} km/h limit`,
        source_reference: id,
      }));
    }
  }
  return { id, vehicle_id: vehicle.id, provider_code: providerCode, event_type: eventType, alerts };
}

export function getVehicle(db, id, companyId) {
  const vehicle = g.scopedRow(db, 'fleet_vehicles', id, companyId, 'vehicle');
  const asset = vehicle.asset_id
    ? db.prepare('SELECT id, asset_tag, state, capitalized_value FROM assets WHERE id = ?').get(vehicle.asset_id)
    : null;
  const documents = db.prepare('SELECT * FROM fleet_documents WHERE vehicle_id = ? ORDER BY expires_on').all(id);
  const assignment = db.prepare(`
    SELECT a.*, d.driver_ref, d.name AS driver_name FROM fleet_assignments a
    JOIN fleet_drivers d ON d.id = a.driver_id
    WHERE a.vehicle_id = ? AND a.released_at IS NULL LIMIT 1
  `).get(id) || null;
  const openMaintenance = db.prepare(`
    SELECT id, reference, state FROM maintenance_orders
    WHERE company_id = ? AND vehicle_id = ? AND state NOT IN ('closed', 'cancelled')
  `).all(companyId, id);
  return {
    ...vehicle,
    asset,
    depreciates: Boolean(asset),
    depreciation_note: asset ? null : 'no asset is linked; this vehicle is tracked operationally but does not depreciate',
    documents,
    current_assignment: assignment,
    open_maintenance_orders: openMaintenance,
  };
}

export function listVehicles(db, { company_id, state = null }) {
  let sql = 'SELECT * FROM fleet_vehicles WHERE company_id = ?';
  const params = [company_id];
  if (state) { sql += ' AND state = ?'; params.push(state); }
  sql += ' ORDER BY name';
  return db.prepare(sql).all(...params);
}

export { round2, round6 };
