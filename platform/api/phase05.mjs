// Phase 05 read-side API families.
//
// Writes go through the existing governed route `POST /api/v1/action/:actionId`,
// which already enforces the permission, scope, idempotency, audit and outbox
// contract declared in `platform_actions`. This file adds only the queries, so
// there is exactly one write path and no second command surface.
//
// Every handler is scoped by `ctx.companyId`; a query with no company scope
// returns 403 rather than a cross-tenant result.

import { config, orders, execution, engineering, planning, subcontracting, completion, reports as manufacturingReports } from '../manufacturing/index.mjs';
import { quality } from '../quality/index.mjs';
import { projects, costing, billing, reports as projectReports } from '../projects/index.mjs';
import { assets, reports as assetReports } from '../assets/index.mjs';
import { maintenance, reports as maintenanceReports } from '../maintenance/index.mjs';
import { fleet, reports as fleetReports } from '../fleet/index.mjs';
import { listModuleStates, listPolicies } from '../control_plane/phase05.mjs';

export const PHASE05_NAMESPACES = Object.freeze([
  'manufacturing', 'boms', 'routings', 'work-centers', 'work-orders',
  'production-orders', 'planning', 'subcontracting', 'quality',
  'projects', 'assets', 'maintenance', 'fleet', 'phase05',
]);

function ok(data, meta = null) {
  return { data, meta };
}

function fail(error, status = 404) {
  return { error, status };
}

function limitOf(query, fallback = 100) {
  const value = Number(query.limit);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 500) : fallback;
}

/**
 * Read-side dispatcher for the Phase 05 API families.
 *
 * Returns `{ data, meta }` on success or `{ error, status }` on failure; the
 * router turns either into the standard envelope.
 */
export function handlePhase05Query({ dialect, ctx, namespace, resource, recordId, query = {} }) {
  const companyId = ctx?.companyId;
  if (!companyId) return fail('an active company scope is required', 403);

  try {
    switch (namespace) {
      case 'manufacturing':
        return manufacturingRoutes({ dialect, companyId, resource, recordId, query });
      case 'production-orders':
        return manufacturingRoutes({ dialect, companyId, resource: 'orders', recordId: resource, query });
      case 'work-orders':
        return manufacturingRoutes({ dialect, companyId, resource: 'work-orders', recordId: resource, query });
      case 'boms':
        return resource
          ? ok(engineering.getBom(dialect, resource, companyId))
          : ok(listBoms(dialect, companyId, query));
      case 'routings':
        return resource
          ? ok(engineering.getRouting(dialect, resource, companyId))
          : ok(listRoutings(dialect, companyId, query));
      case 'work-centers':
        return resource
          ? ok(config.getWorkCenter(dialect, resource, companyId))
          : ok(config.listWorkCenters(dialect, companyId));
      case 'planning':
        return planningRoutes({ dialect, companyId, resource, recordId, query });
      case 'subcontracting':
        return ok(subcontracting.getSubcontractOwnershipReport(dialect, {
          company_id: companyId, order_id: query.order_id || null,
        }));
      case 'quality':
        return qualityRoutes({ dialect, companyId, resource, recordId, query });
      case 'projects':
        return projectRoutes({ dialect, companyId, resource, recordId, query });
      case 'assets':
        return assetRoutes({ dialect, companyId, resource, recordId, query });
      case 'maintenance':
        return maintenanceRoutes({ dialect, companyId, resource, recordId, query });
      case 'fleet':
        return fleetRoutes({ dialect, companyId, resource, recordId, query });
      case 'phase05':
        return controlPlaneRoutes({ dialect, companyId, resource });
      default:
        return fail(`unknown Phase 05 resource: ${namespace}`);
    }
  } catch (error) {
    return fail(error.message, error.statusCode || 400);
  }
}

function listBoms(dialect, companyId, query) {
  let sql = 'SELECT * FROM bom_headers WHERE company_id = ?';
  const params = [companyId];
  if (query.product_id) { sql += ' AND product_id = ?'; params.push(query.product_id); }
  if (query.status) { sql += ' AND status = ?'; params.push(query.status); }
  sql += ` ORDER BY code, version DESC LIMIT ${limitOf(query)}`;
  return dialect.prepare(sql).all(...params);
}

function listRoutings(dialect, companyId, query) {
  let sql = 'SELECT * FROM routings WHERE company_id = ?';
  const params = [companyId];
  if (query.status) { sql += ' AND status = ?'; params.push(query.status); }
  sql += ` ORDER BY code, version DESC LIMIT ${limitOf(query)}`;
  return dialect.prepare(sql).all(...params);
}

function manufacturingRoutes({ dialect, companyId, resource, recordId, query }) {
  switch (resource) {
    case 'orders':
      return recordId
        ? ok(orders.getProductionOrder(dialect, recordId, companyId))
        : ok(orders.listProductionOrders(dialect, {
          company_id: companyId, state: query.state || null,
          project_id: query.project_id || null, limit: limitOf(query),
        }));
    case 'work-orders':
      return recordId
        ? ok(execution.getWorkOrder(dialect, recordId, companyId))
        : ok(execution.listWorkOrders(dialect, {
          company_id: companyId, order_id: query.order_id || null,
          work_center_id: query.work_center_id || null, state: query.state || null,
        }));
    case 'cost-summary':
      if (!recordId) return fail('an order id is required');
      return ok(completion.getProductionCostSummary(dialect, companyId, recordId));
    case 'account-mapping':
      return ok(config.getAccountMapping(dialect, companyId));
    case 'plan':
      return ok(manufacturingReports.productionPlan(dialect, { company_id: companyId, limit: limitOf(query, 200) }));
    case 'shortages':
      return ok(manufacturingReports.materialShortages(dialect, { company_id: companyId }));
    case 'status-summary':
      return ok(manufacturingReports.orderStatusSummary(dialect, { company_id: companyId }));
    case 'work-center-loading':
      return ok(manufacturingReports.workCenterLoading(dialect, { company_id: companyId }));
    case 'wip':
      return ok({
        derived: manufacturingReports.wipReport(dialect, { company_id: companyId }),
        general_ledger: manufacturingReports.financeWipBalance(dialect, { company_id: companyId }),
      });
    case 'cost-variance':
      return ok(manufacturingReports.costVarianceReport(dialect, { company_id: companyId }));
    case 'scrap-rework':
      return ok(manufacturingReports.scrapAndReworkReport(dialect, { company_id: companyId }));
    case 'throughput':
      return ok(manufacturingReports.throughputReport(dialect, { company_id: companyId }));
    case 'downtime':
      return ok(manufacturingReports.downtimeReport(dialect, { company_id: companyId }));
    default:
      return fail(`unknown manufacturing resource: ${resource}`);
  }
}

function planningRoutes({ dialect, companyId, resource, query }) {
  switch (resource) {
    case 'worklist':
      return ok(planning.getPlannerWorklist(dialect, {
        company_id: companyId, run_id: query.run_id || null,
        status: query.status || 'proposed',
      }));
    case 'runs':
      return ok(dialect.prepare(
        `SELECT * FROM planning_runs WHERE company_id = ? ORDER BY started_at DESC LIMIT ${limitOf(query, 50)}`,
      ).all(companyId));
    case 'policies':
      return ok(dialect.prepare(
        'SELECT * FROM product_planning_policies WHERE company_id = ? AND is_active = 1',
      ).all(companyId));
    default:
      return fail(`unknown planning resource: ${resource}`);
  }
}

function qualityRoutes({ dialect, companyId, resource, recordId, query }) {
  switch (resource) {
    case 'plans':
      return recordId
        ? ok(quality.getQualityPlan(dialect, recordId, companyId))
        : ok(dialect.prepare('SELECT * FROM quality_plans WHERE company_id = ? AND is_active = 1 ORDER BY code').all(companyId));
    case 'inspections':
      return recordId
        ? ok(quality.getInspection(dialect, recordId, companyId))
        : ok(quality.listInspections(dialect, {
          company_id: companyId, state: query.state || null,
          subject_type: query.subject_type || null, limit: limitOf(query),
        }));
    case 'nonconformances':
      return ok(dialect.prepare(
        `SELECT * FROM quality_nonconformances WHERE company_id = ? ORDER BY opened_at DESC LIMIT ${limitOf(query)}`,
      ).all(companyId));
    case 'blocked':
      if (!query.subject_type || !query.subject_id) return fail('subject_type and subject_id are required');
      return ok(quality.isBlockedByQuality(dialect, companyId, query.subject_type, query.subject_id));
    case 'pass-rate':
      return ok(manufacturingReports.inspectionPassRate(dialect, { company_id: companyId }));
    case 'defect-trends':
      return ok(manufacturingReports.defectTrends(dialect, { company_id: companyId }));
    case 'supplier-defects':
      return ok(manufacturingReports.supplierDefects(dialect, { company_id: companyId }));
    case 'ncr-aging':
      return ok(manufacturingReports.nonconformanceAging(dialect, { company_id: companyId }));
    case 'capa-status':
      return ok(manufacturingReports.capaStatus(dialect, { company_id: companyId }));
    default:
      return fail(`unknown quality resource: ${resource}`);
  }
}

function projectRoutes({ dialect, companyId, resource, recordId, query }) {
  // `/projects` and `/projects/:id` — the resource segment is the id here.
  if (!resource) {
    return ok(projects.listProjects(dialect, {
      company_id: companyId, state: query.state || null,
      customer_party_id: query.customer_party_id || null, limit: limitOf(query),
    }));
  }
  const namedReports = {
    portfolio: () => ok(projectReports.portfolioSummary(dialect, { company_id: companyId })),
    commitments: () => ok(projectReports.commitmentReport(dialect, {
      company_id: companyId, project_id: query.project_id || null,
    })),
    milestones: () => ok(projectReports.milestoneStatus(dialect, {
      company_id: companyId, project_id: query.project_id || null,
    })),
    'overdue-work': () => ok(projectReports.overdueWorkItems(dialect, {
      company_id: companyId, project_id: query.project_id || null,
    })),
  };
  if (namedReports[resource]) return namedReports[resource]();

  const projectId = resource;
  switch (recordId) {
    case undefined:
    case null:
      return ok(projects.getProject(dialect, projectId, companyId));
    case 'budget':
      return ok(costing.approvedBudget(dialect, companyId, projectId));
    case 'budget-control':
      return ok(costing.budgetControl(dialect, companyId, projectId));
    case 'budget-vs-actual':
      return ok(projectReports.budgetVersusActual(dialect, { company_id: companyId, project_id: projectId }));
    case 'cost-breakdown':
      return ok(projectReports.costBreakdown(dialect, { company_id: companyId, project_id: projectId }));
    case 'profitability':
      return ok(projectReports.profitability(dialect, { company_id: companyId, project_id: projectId }));
    case 'billing':
      return ok({
        summary: projectReports.billedVersusUnbilled(dialect, { company_id: companyId, project_id: projectId }),
        billings: billing.listBillings(dialect, { company_id: companyId, project_id: projectId }),
      });
    case 'cash-flow':
      return ok(projectReports.projectCashFlow(dialect, { company_id: companyId, project_id: projectId }));
    default:
      return fail(`unknown project sub-resource: ${recordId}`);
  }
}

function assetRoutes({ dialect, companyId, resource, recordId, query }) {
  if (!resource) {
    return ok(assets.listAssets(dialect, {
      company_id: companyId, state: query.state || null,
      category_id: query.category_id || null, limit: limitOf(query, 200),
    }));
  }
  const namedReports = {
    categories: () => ok(dialect.prepare(
      'SELECT * FROM asset_categories WHERE company_id = ? AND is_active = 1 ORDER BY code',
    ).all(companyId)),
    register: () => ok(assetReports.assetRegister(dialect, { company_id: companyId, state: query.state || null })),
    depreciation: () => ok(assetReports.depreciationReport(dialect, {
      company_id: companyId, from_date: query.from_date || null, to_date: query.to_date || null,
    })),
    reconciliation: () => ok(assetReports.assetAccountingReconciliation(dialect, { company_id: companyId })),
    warranties: () => ok(assetReports.warrantyExpiryAlerts(dialect, {
      company_id: companyId, within_days: Number(query.within_days || 60),
    })),
    custodians: () => ok(assetReports.assetsByCustodian(dialect, { company_id: companyId })),
  };
  if (namedReports[resource]) return namedReports[resource]();

  if (!recordId) return ok(assets.getAsset(dialect, resource, companyId));
  if (recordId === 'valuation') return ok(assets.netBookValue(dialect, resource));
  return fail(`unknown asset sub-resource: ${recordId}`);
}

function maintenanceRoutes({ dialect, companyId, resource, recordId, query }) {
  switch (resource) {
    case undefined:
    case null:
    case 'orders':
      return recordId
        ? ok(maintenance.getOrder(dialect, recordId, companyId))
        : ok(maintenance.listOrders(dialect, {
          company_id: companyId, state: query.state || null,
          asset_id: query.asset_id || null, vehicle_id: query.vehicle_id || null,
          limit: limitOf(query, 200),
        }));
    case 'requests':
      return ok(dialect.prepare(
        `SELECT * FROM maintenance_requests WHERE company_id = ? ORDER BY requested_at DESC LIMIT ${limitOf(query)}`,
      ).all(companyId));
    case 'plans':
      return ok(dialect.prepare(
        'SELECT * FROM maintenance_plans WHERE company_id = ? AND is_active = 1 ORDER BY code',
      ).all(companyId));
    case 'due':
      return ok(maintenanceReports.maintenanceDue(dialect, {
        company_id: companyId, within_days: Number(query.within_days || 30),
      }));
    case 'cost':
      return ok(maintenanceReports.maintenanceCost(dialect, {
        company_id: companyId, from_date: query.from_date || null, to_date: query.to_date || null,
      }));
    case 'downtime':
      return ok(maintenanceReports.downtimeReport(dialect, { company_id: companyId }));
    case 'reliability':
      return ok(maintenanceReports.reliabilityReport(dialect, { company_id: companyId }));
    case 'spare-parts':
      return ok(maintenanceReports.sparePartsUsage(dialect, { company_id: companyId }));
    default:
      return fail(`unknown maintenance resource: ${resource}`);
  }
}

function fleetRoutes({ dialect, companyId, resource, recordId, query }) {
  switch (resource) {
    case undefined:
    case null:
    case 'vehicles':
      return recordId
        ? ok(fleet.getVehicle(dialect, recordId, companyId))
        : ok(fleet.listVehicles(dialect, { company_id: companyId, state: query.state || null }));
    case 'drivers':
      return ok(dialect.prepare(
        'SELECT * FROM fleet_drivers WHERE company_id = ? AND is_active = 1 ORDER BY name',
      ).all(companyId));
    case 'trips':
      return ok(dialect.prepare(
        `SELECT * FROM fleet_trips WHERE company_id = ? ORDER BY started_at DESC LIMIT ${limitOf(query)}`,
      ).all(companyId));
    case 'fuel':
      return ok(fleetReports.fuelConsumption(dialect, {
        company_id: companyId, vehicle_id: query.vehicle_id || null,
      }));
    case 'fuel-variance':
      return ok(fleetReports.fuelVarianceAlerts(dialect, {
        company_id: companyId, tolerance_percent: Number(query.tolerance_percent || 10),
      }));
    case 'utilisation':
      return ok(fleetReports.vehicleUtilisation(dialect, {
        company_id: companyId, from_date: query.from_date || null, to_date: query.to_date || null,
      }));
    case 'cost-per-km':
      return ok(fleetReports.costPerKilometre(dialect, { company_id: companyId }));
    case 'expiries':
      return ok(fleetReports.expiryAlerts(dialect, {
        company_id: companyId, within_days: Number(query.within_days || 60),
      }));
    case 'incidents':
      return ok(fleetReports.incidentReport(dialect, { company_id: companyId }));
    case 'downtime':
      return ok(fleetReports.fleetDowntime(dialect, { company_id: companyId }));
    case 'alerts':
      return ok(fleetReports.openAlerts(dialect, { company_id: companyId }));
    default:
      return fail(`unknown fleet resource: ${resource}`);
  }
}

function controlPlaneRoutes({ dialect, companyId, resource }) {
  switch (resource) {
    case 'modules':
      return ok(listModuleStates(dialect));
    case 'policies':
      return ok(listPolicies(dialect, companyId));
    case 'status':
      return ok({
        modules: listModuleStates(dialect),
        policies: listPolicies(dialect, companyId),
        manufacturing_account_mapping: config.getAccountMapping(dialect, companyId),
      });
    default:
      return fail(`unknown control plane resource: ${resource}`);
  }
}
