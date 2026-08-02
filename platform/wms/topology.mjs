// BUILD-09 canonical warehouse-topology extension.
'use strict';

import crypto from 'node:crypto';
import { createStockLocation, updateStockLocation } from '../inventory/warehouses.mjs';

export class WmsTopologyError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'WmsTopologyError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const timestamp = () => new Date().toISOString();
const numberOrNull = (value) => value === '' || value == null ? null : Number(value);
const parseJson = (value, fallback = {}) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};

function requiredScope(input) {
  if (!input.company_id) throw new WmsTopologyError('Active company scope is required', 'COMPANY_SCOPE_REQUIRED', 403);
  if (!input.warehouse_id) throw new WmsTopologyError('Warehouse scope is required', 'WAREHOUSE_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, warehouseId: input.warehouse_id };
}

function warehouseInScope(db, companyId, warehouseId) {
  const row = db.prepare('SELECT * FROM warehouses WHERE id=? AND company_id=?').get(warehouseId, companyId);
  if (!row) throw new WmsTopologyError('Warehouse is outside active company scope', 'WAREHOUSE_SCOPE_DENIED', 403);
  return row;
}

function zoneInScope(db, id, scope) {
  const row = db.prepare('SELECT * FROM wms_zones WHERE id=? AND company_id=? AND warehouse_id=?').get(id, scope.companyId, scope.warehouseId);
  if (!row) throw new WmsTopologyError('Zone is outside warehouse scope', 'ZONE_SCOPE_DENIED', 403);
  return mapZone(row);
}

function profileInScope(db, locationId, scope) {
  const row = db.prepare(`SELECT p.*,l.name,l.complete_name,l.parent_id,l.usage,l.is_active
    FROM wms_location_profiles p JOIN stock_locations l ON l.id=p.location_id
    WHERE p.location_id=? AND p.company_id=? AND p.warehouse_id=?`).get(locationId, scope.companyId, scope.warehouseId);
  if (!row) throw new WmsTopologyError('Location is outside warehouse scope', 'LOCATION_SCOPE_DENIED', 403);
  return mapProfile(row);
}

function mapZone(row) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, warehouseId: row.warehouse_id,
    parentZoneId: row.parent_zone_id, code: row.code, name: row.name,
    zoneType: row.zone_type, pickingPriority: row.picking_priority,
    putawayPriority: row.putaway_priority, temperatureMin: row.temperature_min,
    temperatureMax: row.temperature_max, hazardous: !!row.hazardous,
    restricted: !!row.restricted, active: !!row.is_active,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapProfile(row) {
  if (!row) return null;
  return {
    locationId: row.location_id, companyId: row.company_id, warehouseId: row.warehouse_id,
    zoneId: row.zone_id, locationType: row.location_type, locationCode: row.location_code,
    barcode: row.barcode, capacityUnits: row.capacity_units, weightLimit: row.weight_limit,
    volumeLimit: row.volume_limit, temperatureMin: row.temperature_min,
    temperatureMax: row.temperature_max, hazardous: !!row.hazardous,
    restricted: !!row.restricted, restrictions: parseJson(row.restrictions_json),
    replenishmentSourceLocationId: row.replenishment_source_location_id,
    pickingPriority: row.picking_priority, putawayPriority: row.putaway_priority,
    fixedProductId: row.fixed_product_id, blocked: !!row.is_blocked,
    blockReason: row.block_reason, retiredAt: row.retired_at,
    name: row.name, completeName: row.complete_name, parentId: row.parent_id,
    usage: row.usage, active: !!row.is_active, createdBy: row.created_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createZone(db, input) {
  const scope = requiredScope(input);
  warehouseInScope(db, scope.companyId, scope.warehouseId);
  if (!input.code || !input.name) throw new WmsTopologyError('Zone code and name are required', 'INVALID_ZONE');
  if (input.parent_zone_id) zoneInScope(db, input.parent_zone_id, scope);
  const id = uid('wzone');
  const now = timestamp();
  try {
    db.prepare(`INSERT INTO wms_zones(
      id,company_id,warehouse_id,parent_zone_id,code,name,zone_type,picking_priority,
      putaway_priority,temperature_min,temperature_max,hazardous,restricted,is_active,
      created_by,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(
      id, scope.companyId, scope.warehouseId, input.parent_zone_id || null,
      String(input.code).trim().toUpperCase(), String(input.name).trim(),
      input.zone_type || 'storage', Number(input.picking_priority || 100),
      Number(input.putaway_priority || 100), numberOrNull(input.temperature_min),
      numberOrNull(input.temperature_max), input.hazardous ? 1 : 0,
      input.restricted ? 1 : 0, input.actor, now, now,
    );
  } catch (error) {
    if (/UNIQUE/.test(error.message)) throw new WmsTopologyError('Zone code already exists in this warehouse', 'ZONE_CODE_DUPLICATE', 409);
    throw error;
  }
  return zoneInScope(db, id, scope);
}

export function updateZone(db, input) {
  const scope = requiredScope(input);
  const current = zoneInScope(db, input.zone_id || input.id, scope);
  if (input.parent_zone_id) {
    if (input.parent_zone_id === current.id) throw new WmsTopologyError('Zone cannot be its own parent', 'ZONE_HIERARCHY_CYCLE');
    zoneInScope(db, input.parent_zone_id, scope);
  }
  const now = timestamp();
  db.prepare(`UPDATE wms_zones SET parent_zone_id=?,code=?,name=?,zone_type=?,
    picking_priority=?,putaway_priority=?,temperature_min=?,temperature_max=?,
    hazardous=?,restricted=?,updated_at=? WHERE id=?`).run(
    input.parent_zone_id !== undefined ? input.parent_zone_id : current.parentZoneId,
    String(input.code || current.code).trim().toUpperCase(),
    String(input.name || current.name).trim(), input.zone_type || current.zoneType,
    Number(input.picking_priority ?? current.pickingPriority),
    Number(input.putaway_priority ?? current.putawayPriority),
    numberOrNull(input.temperature_min ?? current.temperatureMin),
    numberOrNull(input.temperature_max ?? current.temperatureMax),
    input.hazardous === undefined ? Number(current.hazardous) : Number(!!input.hazardous),
    input.restricted === undefined ? Number(current.restricted) : Number(!!input.restricted),
    now, current.id,
  );
  return zoneInScope(db, current.id, scope);
}

export function setZoneActive(db, input) {
  const scope = requiredScope(input);
  const current = zoneInScope(db, input.zone_id || input.id, scope);
  const active = input.active === undefined ? true : !!input.active;
  if (!active) {
    const open = db.prepare(`SELECT COUNT(*) count FROM wms_warehouse_tasks t
      JOIN wms_location_profiles p ON p.location_id IN(t.source_location_id,t.destination_location_id)
      WHERE p.zone_id=? AND t.status NOT IN('completed','cancelled','failed')`).get(current.id).count;
    if (open) throw new WmsTopologyError('Zone has unresolved warehouse tasks', 'ZONE_HAS_OPEN_TASKS', 409);
  }
  db.prepare('UPDATE wms_zones SET is_active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, timestamp(), current.id);
  return zoneInScope(db, current.id, scope);
}

export function createLocation(db, input) {
  const scope = requiredScope(input);
  warehouseInScope(db, scope.companyId, scope.warehouseId);
  if (!input.name || !input.location_code) throw new WmsTopologyError('Location name and code are required', 'INVALID_LOCATION');
  if (input.zone_id) zoneInScope(db, input.zone_id, scope);
  if (input.parent_id) {
    const parent = db.prepare('SELECT id FROM stock_locations WHERE id=? AND company_id=? AND warehouse_id=?').get(input.parent_id, scope.companyId, scope.warehouseId);
    if (!parent) throw new WmsTopologyError('Parent location is outside warehouse scope', 'PARENT_LOCATION_SCOPE_DENIED', 403);
  }
  const canonical = createStockLocation(db, {
    company_id: scope.companyId, warehouse_id: scope.warehouseId,
    parent_id: input.parent_id || null, name: input.name,
    usage: input.usage || 'internal', capacity: String(input.capacity_units || ''),
    is_scrap: input.location_type === 'scrap' ? 1 : 0,
  });
  const now = timestamp();
  try {
    db.prepare(`INSERT INTO wms_location_profiles(
      location_id,company_id,warehouse_id,zone_id,location_type,location_code,
      barcode,capacity_units,weight_limit,volume_limit,temperature_min,temperature_max,
      hazardous,restricted,restrictions_json,replenishment_source_location_id,
      picking_priority,putaway_priority,fixed_product_id,is_blocked,created_by,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`).run(
      canonical.id, scope.companyId, scope.warehouseId, input.zone_id || null,
      input.location_type || 'bin', String(input.location_code).trim().toUpperCase(),
      input.barcode || null, numberOrNull(input.capacity_units), numberOrNull(input.weight_limit),
      numberOrNull(input.volume_limit), numberOrNull(input.temperature_min),
      numberOrNull(input.temperature_max), input.hazardous ? 1 : 0,
      input.restricted ? 1 : 0, JSON.stringify(input.restrictions || {}),
      input.replenishment_source_location_id || null, Number(input.picking_priority || 100),
      Number(input.putaway_priority || 100), input.fixed_product_id || null,
      input.actor, now, now,
    );
  } catch (error) {
    throw new WmsTopologyError(`Location profile rejected: ${error.message}`, 'LOCATION_PROFILE_REJECTED', 409);
  }
  return profileInScope(db, canonical.id, scope);
}

export function updateLocation(db, input) {
  const scope = requiredScope(input);
  const current = profileInScope(db, input.location_id || input.id, scope);
  if (input.zone_id) zoneInScope(db, input.zone_id, scope);
  updateStockLocation(db, {
    id: current.locationId,
    name: input.name === undefined ? current.name : input.name,
    usage: input.usage === undefined ? current.usage : input.usage,
    is_active: input.active === undefined ? current.active : !!input.active,
  });
  db.prepare(`UPDATE wms_location_profiles SET zone_id=?,location_type=?,location_code=?,
    replenishment_source_location_id=?,picking_priority=?,putaway_priority=?,
    fixed_product_id=?,is_blocked=?,block_reason=?,updated_at=? WHERE location_id=?`).run(
    input.zone_id === undefined ? current.zoneId : input.zone_id,
    input.location_type || current.locationType,
    String(input.location_code || current.locationCode).trim().toUpperCase(),
    input.replenishment_source_location_id === undefined ? current.replenishmentSourceLocationId : input.replenishment_source_location_id,
    Number(input.picking_priority ?? current.pickingPriority),
    Number(input.putaway_priority ?? current.putawayPriority),
    input.fixed_product_id === undefined ? current.fixedProductId : input.fixed_product_id,
    input.blocked === undefined ? Number(current.blocked) : Number(!!input.blocked),
    input.block_reason === undefined ? current.blockReason : input.block_reason,
    timestamp(), current.locationId,
  );
  return profileInScope(db, current.locationId, scope);
}

function descendants(db, locationId) {
  return db.prepare(`WITH RECURSIVE tree(id) AS (
    SELECT id FROM stock_locations WHERE parent_id=?
    UNION ALL SELECT l.id FROM stock_locations l JOIN tree t ON l.parent_id=t.id
  ) SELECT id FROM tree`).all(locationId).map((row) => row.id);
}

export function moveLocation(db, input) {
  const scope = requiredScope(input);
  const current = profileInScope(db, input.location_id || input.id, scope);
  if (!input.parent_id) throw new WmsTopologyError('New parent location is required', 'PARENT_LOCATION_REQUIRED');
  const parent = db.prepare('SELECT id FROM stock_locations WHERE id=? AND company_id=? AND warehouse_id=?').get(input.parent_id, scope.companyId, scope.warehouseId);
  if (!parent) throw new WmsTopologyError('Parent location is outside warehouse scope', 'PARENT_LOCATION_SCOPE_DENIED', 403);
  if (input.parent_id === current.locationId || descendants(db, current.locationId).includes(input.parent_id)) {
    throw new WmsTopologyError('Location hierarchy cycle is not allowed', 'LOCATION_HIERARCHY_CYCLE', 409);
  }
  updateStockLocation(db, { id: current.locationId, parent_id: input.parent_id });
  return profileInScope(db, current.locationId, scope);
}

export function setLocationCapacity(db, input) {
  const scope = requiredScope(input);
  const current = profileInScope(db, input.location_id || input.id, scope);
  const values = [input.capacity_units, input.weight_limit, input.volume_limit];
  if (values.some((value) => value != null && Number(value) < 0)) throw new WmsTopologyError('Capacity values cannot be negative', 'INVALID_CAPACITY');
  db.prepare(`UPDATE wms_location_profiles SET capacity_units=?,weight_limit=?,volume_limit=?,
    temperature_min=?,temperature_max=?,updated_at=? WHERE location_id=?`).run(
    numberOrNull(input.capacity_units), numberOrNull(input.weight_limit),
    numberOrNull(input.volume_limit), numberOrNull(input.temperature_min),
    numberOrNull(input.temperature_max), timestamp(), current.locationId,
  );
  updateStockLocation(db, { id: current.locationId, capacity: String(input.capacity_units ?? '') });
  return profileInScope(db, current.locationId, scope);
}

export function setLocationRestrictions(db, input) {
  const scope = requiredScope(input);
  const current = profileInScope(db, input.location_id || input.id, scope);
  const restrictions = input.restrictions && typeof input.restrictions === 'object' ? input.restrictions : {};
  db.prepare(`UPDATE wms_location_profiles SET hazardous=?,restricted=?,restrictions_json=?,
    is_blocked=?,block_reason=?,updated_at=? WHERE location_id=?`).run(
    input.hazardous ? 1 : 0, input.restricted ? 1 : 0, JSON.stringify(restrictions),
    input.blocked ? 1 : 0, input.block_reason || null, timestamp(), current.locationId,
  );
  return profileInScope(db, current.locationId, scope);
}

export function generateLocationBarcode(db, input) {
  const scope = requiredScope(input);
  const current = profileInScope(db, input.location_id || input.id, scope);
  const barcode = input.barcode || `LOC-${scope.warehouseId.slice(-8).toUpperCase()}-${current.locationCode}`;
  try {
    db.prepare('UPDATE wms_location_profiles SET barcode=?,updated_at=? WHERE location_id=?').run(barcode, timestamp(), current.locationId);
  } catch {
    throw new WmsTopologyError('Barcode already belongs to another location', 'LOCATION_BARCODE_DUPLICATE', 409);
  }
  return profileInScope(db, current.locationId, scope);
}

export function retireLocation(db, input) {
  const scope = requiredScope(input);
  const current = profileInScope(db, input.location_id || input.id, scope);
  const balance = db.prepare('SELECT COALESCE(SUM(ABS(quantity)+ABS(reserved_quantity)),0) total FROM stock_quants WHERE company_id=? AND location_id=?').get(scope.companyId, current.locationId).total;
  if (Number(balance) > 0) throw new WmsTopologyError('Location has unresolved canonical stock', 'LOCATION_NOT_EMPTY', 409);
  const openTasks = db.prepare(`SELECT COUNT(*) count FROM wms_warehouse_tasks
    WHERE (source_location_id=? OR destination_location_id=?) AND status NOT IN('completed','cancelled','failed')`).get(current.locationId, current.locationId).count;
  if (openTasks) throw new WmsTopologyError('Location has unresolved warehouse tasks', 'LOCATION_HAS_OPEN_TASKS', 409);
  if (descendants(db, current.locationId).length) throw new WmsTopologyError('Location has child locations', 'LOCATION_HAS_CHILDREN', 409);
  db.prepare('UPDATE wms_location_profiles SET retired_at=?,updated_at=? WHERE location_id=?').run(timestamp(), timestamp(), current.locationId);
  updateStockLocation(db, { id: current.locationId, is_active: 0 });
  return profileInScope(db, current.locationId, scope);
}

export function listZones(db, input) {
  const scope = requiredScope(input);
  warehouseInScope(db, scope.companyId, scope.warehouseId);
  let sql = 'SELECT * FROM wms_zones WHERE company_id=? AND warehouse_id=?';
  const params = [scope.companyId, scope.warehouseId];
  if (!input.include_inactive) sql += ' AND is_active=1';
  sql += ' ORDER BY putaway_priority,picking_priority,code';
  return db.prepare(sql).all(...params).map(mapZone);
}

export function listLocations(db, input) {
  const scope = requiredScope(input);
  warehouseInScope(db, scope.companyId, scope.warehouseId);
  let sql = `SELECT p.*,l.name,l.complete_name,l.parent_id,l.usage,l.is_active
    FROM wms_location_profiles p JOIN stock_locations l ON l.id=p.location_id
    WHERE p.company_id=? AND p.warehouse_id=?`;
  const params = [scope.companyId, scope.warehouseId];
  if (input.zone_id) { sql += ' AND p.zone_id=?'; params.push(input.zone_id); }
  if (input.restricted_only) sql += ' AND p.restricted=1';
  if (input.blocked_only) sql += ' AND p.is_blocked=1';
  if (!input.include_retired) sql += ' AND p.retired_at IS NULL AND l.is_active=1';
  sql += ' ORDER BY p.picking_priority,p.location_code';
  return db.prepare(sql).all(...params).map(mapProfile);
}

export function capacityUtilization(db, input) {
  const rows = listLocations(db, { ...input, include_retired: false });
  const balance = db.prepare('SELECT COALESCE(SUM(ABS(quantity)),0) used FROM stock_quants WHERE company_id=? AND location_id=?');
  return rows.map((location) => {
    const usedUnits = Number(balance.get(location.companyId, location.locationId).used || 0);
    const capacity = Number(location.capacityUnits || 0);
    return {
      ...location, usedUnits, availableUnits: capacity ? Math.max(0, capacity - usedUnits) : null,
      utilizationPercent: capacity ? Number((usedUnits / capacity * 100).toFixed(2)) : null,
      capacityKnown: capacity > 0,
    };
  });
}

export function hierarchy(db, input) {
  const zones = listZones(db, { ...input, include_inactive: true });
  const locations = listLocations(db, { ...input, include_retired: true });
  const byParent = new Map();
  for (const location of locations) {
    const key = location.parentId || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(location);
  }
  const build = (parentId) => (byParent.get(parentId || '') || []).map((location) => ({ ...location, children: build(location.locationId) }));
  return zones.map((zone) => ({ ...zone, locations: locations.filter((location) => location.zoneId === zone.id && !location.parentId).map((location) => ({ ...location, children: build(location.locationId) })) }));
}
