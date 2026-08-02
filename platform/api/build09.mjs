// Read-only BUILD-09 WMS query surface. Mutations remain registered actions.
'use strict';

import * as topology from '../wms/topology.mjs';
import * as putaway from '../wms/putaway.mjs';
import * as replenishment from '../wms/replenishment.mjs';

function denied(message = 'company scope is required') { return { error: message, status: 403 }; }
function list(data) { return { data, meta: { total: data.length } }; }

export function handleBuild09Query({ dialect, ctx, resource, recordId, query = {} }) {
  const companyId = ctx.companyId || ctx.activeCompanyId;
  if (!companyId) return denied();
  const warehouseId = query.warehouse_id || ctx.warehouseId;
  if (!warehouseId) return { error: 'warehouse_id is required', status: 422 };
  const input = { ...query, company_id: companyId, warehouse_id: warehouseId };

  try {
    if (resource === 'hierarchy') return { data: topology.hierarchy(dialect, input), meta: null };
    if (resource === 'zones') return list(topology.listZones(dialect, input));
    if (resource === 'locations') return list(topology.listLocations(dialect, input));
    if (resource === 'capacity') return list(topology.capacityUtilization(dialect, input));
    if (resource === 'restricted-locations') return list(topology.listLocations(dialect, { ...input, restricted_only: true }));
    if (resource === 'blocked-locations') return list(topology.listLocations(dialect, { ...input, blocked_only: true }));
    if (resource === 'empty-locations') {
      const rows = topology.capacityUtilization(dialect, input).filter((row) => Number(row.usedUnits) === 0);
      return list(rows);
    }
    if (resource === 'location-stock') {
      if (!recordId && !query.location_id) return { error: 'location id is required', status: 422 };
      const locationId = recordId || query.location_id;
      const owned = dialect.prepare(`SELECT 1 FROM wms_location_profiles WHERE location_id=? AND company_id=? AND warehouse_id=?`).get(locationId, companyId, warehouseId);
      if (!owned) return denied('location is outside warehouse scope');
      return list(dialect.prepare(`SELECT product_id,quantity,reserved_quantity,(quantity-reserved_quantity) available_quantity,updated_at
        FROM stock_quants WHERE company_id=? AND location_id=? ORDER BY product_id`).all(companyId, locationId));
    }
    if (resource === 'location-history') {
      if (!recordId && !query.location_id) return { error: 'location id is required', status: 422 };
      const locationId = recordId || query.location_id;
      const owned = dialect.prepare(`SELECT 1 FROM wms_location_profiles WHERE location_id=? AND company_id=? AND warehouse_id=?`).get(locationId, companyId, warehouseId);
      if (!owned) return denied('location is outside warehouse scope');
      return list(dialect.prepare(`SELECT * FROM stock_moves WHERE company_id=? AND (location_id=? OR location_dest_id=?) ORDER BY move_date DESC LIMIT 250`).all(companyId, locationId, locationId));
    }
    if (resource === 'putaway-rules') return list(putaway.listPutawayRules(dialect, input));
    if (resource === 'putaway-queue') return list(putaway.listPutawayQueue(dialect, input));
    if (resource === 'tasks') return list(putaway.listWarehouseTasks(dialect, input));
    if (resource === 'replenishment-rules') return list(replenishment.listReplenishmentRules(dialect, input));
    if (resource === 'replenishment-proposals') return list(replenishment.listReplenishmentProposals(dialect, input));
    return { error: 'BUILD-09 WMS resource not found', status: 404 };
  } catch (error) {
    return { error: error.message, status: error.statusCode || 422, code: error.code };
  }
}
