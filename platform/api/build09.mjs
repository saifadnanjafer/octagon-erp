// Read-only BUILD-09 WMS query surface. Mutations remain registered actions.
'use strict';

import * as topology from '../wms/topology.mjs';
import * as putaway from '../wms/putaway.mjs';
import * as replenishment from '../wms/replenishment.mjs';
import * as receiving from '../wms/receiving.mjs';
import * as picking from '../wms/picking.mjs';
import * as waves from '../wms/waves.mjs';
import * as cycleCounting from '../wms/cycle-counting.mjs';
import * as docks from '../wms/docks.mjs';
import * as crossdock from '../wms/crossdock.mjs';
import * as traceability from '../wms/traceability-ops.mjs';
import * as shopfloor from '../manufacturing/shopfloor.mjs';
import * as materialFlow from '../manufacturing/material-flow.mjs';
import * as performance from '../manufacturing/downtime-performance.mjs';
import * as qualityOperations from '../quality/operations.mjs';

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
    if (resource === 'receiving-sessions') return list(receiving.listReceivingSessions(dialect, input));
    if (resource === 'receiving-discrepancies') {
      const rows = dialect.prepare(`SELECT d.* FROM wms_receiving_discrepancies d JOIN wms_receiving_sessions s ON s.id=d.session_id
        WHERE s.company_id=? AND s.warehouse_id=? AND (?='' OR d.status=?) ORDER BY d.requested_at DESC`).all(companyId, warehouseId, query.status || '', query.status || '');
      return list(rows);
    }
    if (resource === 'pick-tasks') return list(picking.listPickTasks(dialect, input));
    if (resource === 'waves') return list(waves.listWaves(dialect, input));
    if (resource === 'count-plans') return list(cycleCounting.listCountPlans(dialect, input));
    if (resource === 'count-sessions') return list(cycleCounting.listCountSessions(dialect, input));
    if (resource === 'docks') return list(docks.listDocks(dialect, input));
    if (resource === 'dock-appointments') return list(docks.listDockAppointments(dialect, input));
    if (resource === 'staging-allocations') return list(docks.listStagingAllocations(dialect, input));
    if (resource === 'crossdock-matches') return list(crossdock.listCrossDockMatches(dialect, input));
    if (resource === 'trace') {
      const lotId = query.lot_id || (query.identity_type === 'lot' ? recordId : null);
      const serialId = query.serial_id || (query.identity_type === 'serial' ? recordId : null);
      if (!lotId && !serialId) return { error: 'lot_id or serial_id is required', status: 422 };
      return { data: traceability.queryTrace(dialect, { ...input, lot_id: lotId, serial_id: serialId }), meta: null };
    }
    if (resource === 'expiration-queue') return list(traceability.expirationQueue(dialect, input));
    if (resource === 'recall-candidates') return list(traceability.recallCandidates(dialect, input));
    if (resource === 'recall-cases') return list(traceability.listRecallCases(dialect, input));
    if (resource === 'shopfloor-sessions') return list(shopfloor.listShopfloorSessions(dialect, input));
    if (resource === 'shopfloor-board') return { data: shopfloor.shopfloorStatusBoard(dialect, input), meta: null };
    if (resource === 'shopfloor-timeline') {
      const sessionId = recordId || query.session_id; if (!sessionId) return { error: 'session id is required', status: 422 };
      return list(shopfloor.sessionTimeline(dialect, { ...input, session_id: sessionId }));
    }
    if (resource === 'material-flow') return list(materialFlow.listMaterialFlowRequests(dialect, input));
    if (resource === 'material-shortages') return list(materialFlow.materialShortageBoard(dialect, input));
    if (resource === 'downtime') return list(performance.listDowntimeEvents(dialect, input));
    if (resource === 'session-performance') {
      const sessionId = recordId || query.session_id; if (!sessionId) return { error: 'session id is required', status: 422 };
      return { data: performance.sessionPerformance(dialect, { ...input, session_id: sessionId }), meta: null };
    }
    if (resource === 'work-center-performance') return { data: performance.workCenterPerformance(dialect, input), meta: null };
    if (resource === 'quality-checkpoints') return list(qualityOperations.listOperationalCheckpoints(dialect, input));
    if (resource === 'quality-dispositions') return list(qualityOperations.listDispositions(dialect, input));
    if (resource === 'rework-routes') return list(qualityOperations.listReworkRoutes(dialect, input));
    return { error: 'BUILD-09 WMS resource not found', status: 404 };
  } catch (error) {
    return { error: error.message, status: error.statusCode || 422, code: error.code };
  }
}
