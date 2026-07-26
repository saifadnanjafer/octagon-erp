// Fleet reporting: utilisation, fuel, cost per kilometre, expiries, incidents.

import { round2, round6 } from '../kernel/domain/kit.mjs';

export function vehicleUtilisation(db, { company_id, from_date = null, to_date = null }) {
  let sql = `
    SELECT v.id AS vehicle_id, v.name, v.plate_number, v.state,
      COUNT(t.id) AS trips,
      COALESCE(SUM(t.distance_km), 0) AS distance_km,
      COALESCE(SUM(CASE WHEN t.ended_at IS NOT NULL AND t.started_at IS NOT NULL
        THEN (julianday(t.ended_at) - julianday(t.started_at)) * 24 ELSE 0 END), 0) AS trip_hours
    FROM fleet_vehicles v
    LEFT JOIN fleet_trips t ON t.vehicle_id = v.id AND t.state = 'completed'
  `;
  const params = [];
  const conditions = ['v.company_id = ?'];
  params.push(company_id);
  if (from_date) { conditions.push('(t.started_at IS NULL OR t.started_at >= ?)'); params.push(from_date); }
  if (to_date) { conditions.push('(t.started_at IS NULL OR t.started_at <= ?)'); params.push(to_date); }
  sql += ` WHERE ${conditions.join(' AND ')} GROUP BY v.id ORDER BY distance_km DESC`;

  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    distance_km: round2(row.distance_km),
    trip_hours: round2(row.trip_hours),
  }));
}

export function fuelConsumption(db, { company_id, vehicle_id = null }) {
  let sql = `
    SELECT f.vehicle_id, v.name, v.plate_number,
      COUNT(*) AS transactions,
      COALESCE(SUM(f.quantity), 0) AS quantity,
      COALESCE(SUM(f.amount), 0) AS amount,
      COALESCE(SUM(f.expected_quantity), 0) AS expected_quantity,
      COALESCE(SUM(f.variance_quantity), 0) AS variance_quantity
    FROM fleet_fuel_transactions f JOIN fleet_vehicles v ON v.id = f.vehicle_id
    WHERE f.company_id = ?
  `;
  const params = [company_id];
  if (vehicle_id) { sql += ' AND f.vehicle_id = ?'; params.push(vehicle_id); }
  sql += ' GROUP BY f.vehicle_id ORDER BY quantity DESC';

  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    quantity: round2(row.quantity),
    amount: round2(row.amount),
    expected_quantity: round2(row.expected_quantity),
    variance_quantity: round2(row.variance_quantity),
    variance_percent: Number(row.expected_quantity) > 0
      ? round2((Number(row.variance_quantity) / Number(row.expected_quantity)) * 100)
      : null,
  }));
}

export function fuelVarianceAlerts(db, { company_id, tolerance_percent = 10 }) {
  return db.prepare(`
    SELECT f.*, v.name, v.plate_number FROM fleet_fuel_transactions f
    JOIN fleet_vehicles v ON v.id = f.vehicle_id
    WHERE f.company_id = ? AND f.variance_percent IS NOT NULL
      AND ABS(f.variance_percent) > ?
    ORDER BY ABS(f.variance_percent) DESC
  `).all(company_id, Number(tolerance_percent));
}

/**
 * Cost per kilometre: maintenance + fuel + document cost, over distance
 * actually covered. Vehicles with no measured distance report `null` rather
 * than dividing by zero into a meaningless number.
 */
export function costPerKilometre(db, { company_id }) {
  const vehicles = db.prepare('SELECT id, name, plate_number, currency FROM fleet_vehicles WHERE company_id = ?').all(company_id);
  return vehicles.map((vehicle) => {
    const distance = round6(db.prepare(
      "SELECT COALESCE(SUM(distance_km), 0) AS d FROM fleet_trips WHERE company_id = ? AND vehicle_id = ? AND state = 'completed'",
    ).get(company_id, vehicle.id).d);
    const fuel = round2(db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS a FROM fleet_fuel_transactions WHERE company_id = ? AND vehicle_id = ?',
    ).get(company_id, vehicle.id).a);
    const maintenance = round2(db.prepare(`
      SELECT COALESCE(SUM(parts_cost + labor_cost + external_cost), 0) AS a
      FROM maintenance_orders WHERE company_id = ? AND vehicle_id = ?
    `).get(company_id, vehicle.id).a);
    const documents = round2(db.prepare(
      'SELECT COALESCE(SUM(cost), 0) AS a FROM fleet_documents WHERE company_id = ? AND vehicle_id = ?',
    ).get(company_id, vehicle.id).a);
    const total = round2(fuel + maintenance + documents);
    return {
      vehicle_id: vehicle.id,
      name: vehicle.name,
      plate_number: vehicle.plate_number,
      currency: vehicle.currency,
      distance_km: distance,
      fuel_cost: fuel,
      maintenance_cost: maintenance,
      document_cost: documents,
      total_cost: total,
      cost_per_km: distance > 0 ? round2(total / distance) : null,
      cost_per_km_basis: distance > 0 ? 'measured trips' : 'no completed trip distance recorded',
    };
  });
}

export function expiryAlerts(db, { company_id, within_days = 60 }) {
  const horizon = new Date(Date.now() + Number(within_days) * 86_400_000).toISOString().slice(0, 10);
  const documents = db.prepare(`
    SELECT d.*, v.name, v.plate_number FROM fleet_documents d
    JOIN fleet_vehicles v ON v.id = d.vehicle_id
    WHERE d.company_id = ? AND d.expires_on <= ?
    ORDER BY d.expires_on
  `).all(company_id, horizon);
  const licences = db.prepare(`
    SELECT id, driver_ref, name, licence_number, licence_expiry FROM fleet_drivers
    WHERE company_id = ? AND licence_expiry IS NOT NULL AND licence_expiry <= ?
    ORDER BY licence_expiry
  `).all(company_id, horizon);
  return { documents, driver_licences: licences, horizon };
}

export function incidentReport(db, { company_id }) {
  return db.prepare(`
    SELECT i.incident_type, i.status, COUNT(*) AS occurrences, COALESCE(SUM(i.cost), 0) AS cost
    FROM fleet_incidents i WHERE i.company_id = ?
    GROUP BY i.incident_type, i.status ORDER BY occurrences DESC
  `).all(company_id).map((row) => ({ ...row, cost: round2(row.cost) }));
}

export function fleetDowntime(db, { company_id }) {
  return db.prepare(`
    SELECT o.vehicle_id, v.name, v.plate_number, COUNT(*) AS orders,
           COALESCE(SUM(o.downtime_minutes), 0) AS downtime_minutes
    FROM maintenance_orders o JOIN fleet_vehicles v ON v.id = o.vehicle_id
    WHERE o.company_id = ? AND o.vehicle_id IS NOT NULL
    GROUP BY o.vehicle_id ORDER BY downtime_minutes DESC
  `).all(company_id);
}

export function openAlerts(db, { company_id }) {
  return db.prepare(`
    SELECT a.*, v.name, v.plate_number FROM fleet_alerts a
    LEFT JOIN fleet_vehicles v ON v.id = a.vehicle_id
    WHERE a.company_id = ? AND a.status = 'open'
    ORDER BY a.raised_at DESC
  `).all(company_id);
}
