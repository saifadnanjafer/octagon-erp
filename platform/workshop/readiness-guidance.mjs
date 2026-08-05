'use strict';

function define(ownerRole, risk, outcome, steps, evidence, dependsOn = []) {
  return Object.freeze({
    ownerRole,
    risk,
    outcome,
    steps: Object.freeze(steps),
    evidence: Object.freeze(evidence),
    dependsOn: Object.freeze(dependsOn),
  });
}

export const READINESS_GUIDANCE = Object.freeze({
  active_company: define(
    'System Administrator',
    'critical',
    'Establish the company boundary used by every operational authority.',
    ['Open Multi-Entity Administration.', 'Confirm the company is active.', 'Select it as the session company and reload readiness.'],
    ['Active company identifier', 'Successful company-scoped readiness response'],
  ),
  branches: define(
    'System Administrator',
    'low',
    'Segment work by branch when the workshop has multiple operating sites.',
    ['Create each operating branch.', 'Assign its company.', 'Set the active branch for affected users.'],
    ['Branch code and company', 'User branch assignment'],
    ['active_company'],
  ),
  company_modules: define(
    'System Administrator',
    'high',
    'Enable the licensed modules needed for the workshop operating model.',
    ['Review company module assignments.', 'Enable only approved modules.', 'Verify enabled dependencies.'],
    ['Enabled-module list', 'Dependency validation result'],
    ['active_company'],
  ),
  identities: define(
    'Identity Administrator',
    'critical',
    'Provide active named identities for workshop personnel.',
    ['Create or reactivate identities.', 'Confirm active status.', 'Avoid shared operator accounts.'],
    ['Identity roster', 'Active status confirmation'],
    ['active_company'],
  ),
  roles: define(
    'Identity Administrator',
    'critical',
    'Define least-privilege roles for each workshop duty.',
    ['Review role definitions.', 'Separate supervisor, operator, quality, maintenance, and finance duties.', 'Approve elevated grants.'],
    ['Role-permission matrix', 'Approval record'],
    ['identities'],
  ),
  role_assignments: define(
    'Identity Administrator',
    'critical',
    'Assign every active identity an approved company-scoped role.',
    ['Open role assignments.', 'Select the company boundary.', 'Assign roles and verify effective permissions.'],
    ['Identity-to-role list', 'Effective permission check'],
    ['identities', 'roles'],
  ),
  uoms: define(
    'Product Data Steward',
    'high',
    'Define units used consistently by purchasing, production, stock, and sales.',
    ['Review base units.', 'Add required workshop units.', 'Validate conversion ratios before use.'],
    ['UoM catalogue', 'Conversion review'],
    ['active_company'],
  ),
  product_templates: define(
    'Product Data Steward',
    'critical',
    'Create governed templates for manufactured and consumed products.',
    ['Create product templates.', 'Set inventory and manufacturing behavior.', 'Review names and internal references.'],
    ['Template register', 'Product-type review'],
    ['uoms'],
  ),
  product_variants: define(
    'Product Data Steward',
    'critical',
    'Expose usable variants for operational documents and execution.',
    ['Open product variants.', 'Activate required variants.', 'Confirm sale, purchase, stock, and production applicability.'],
    ['Active variant list', 'Operational applicability review'],
    ['product_templates', 'uoms'],
  ),
  active_warehouse: define(
    'Warehouse Supervisor',
    'critical',
    'Select an active warehouse belonging to the current company.',
    ['Open Warehouse Topology.', 'Create or activate the warehouse.', 'Select it in the runtime scope.'],
    ['Warehouse code and company', 'Runtime warehouse context'],
    ['active_company'],
  ),
  stock_locations: define(
    'Warehouse Supervisor',
    'critical',
    'Provide governed source, destination, WIP, customer, and staging locations.',
    ['Create the location hierarchy.', 'Set usage for each location.', 'Confirm company and warehouse ownership.'],
    ['Location hierarchy', 'Usage and ownership review'],
    ['active_warehouse'],
  ),
  wms_profiles: define(
    'Warehouse Supervisor',
    'medium',
    'Configure scan and movement behavior for advanced WMS locations.',
    ['Open Zone and Bin Management.', 'Add profiles to execution locations.', 'Validate putaway and replenishment behavior.'],
    ['Location-profile list', 'Execution rule review'],
    ['stock_locations'],
  ),
  work_centers: define(
    'Production Manager',
    'critical',
    'Register the workshop resources that perform routing operations.',
    ['Create work centers.', 'Set capacity and calendar.', 'Assign responsible production teams.'],
    ['Work-center register', 'Capacity and calendar review'],
    ['active_company'],
  ),
  approved_boms: define(
    'Production Engineer',
    'critical',
    'Approve at least one complete material definition for production.',
    ['Create a BOM version.', 'Add components and quantities.', 'Review and approve the version.'],
    ['Approved BOM version', 'Component completeness review'],
    ['product_variants', 'uoms'],
  ),
  approved_routings: define(
    'Production Engineer',
    'critical',
    'Approve an executable operation sequence for workshop production.',
    ['Create a routing version.', 'Add sequenced work-center operations.', 'Review and approve the version.'],
    ['Approved routing version', 'Operation sequence review'],
    ['work_centers'],
  ),
  quality_plans: define(
    'Quality Manager',
    'high',
    'Approve inspection requirements for relevant products and operations.',
    ['Create a quality plan.', 'Add measurable inspection points.', 'Approve the plan for execution.'],
    ['Approved quality plan', 'Inspection-point review'],
    ['product_variants'],
  ),
  inspection_points: define(
    'Quality Manager',
    'high',
    'Define objective checks that operators can execute and evidence.',
    ['Open Quality Checkpoints.', 'Define tolerances or pass-fail rules.', 'Assign checkpoints to the correct source.'],
    ['Checkpoint definitions', 'Tolerance and source review'],
    ['quality_plans'],
  ),
  operational_checkpoints: define(
    'Quality Manager',
    'medium',
    'Confirm the runtime quality checkpoint authority is installed.',
    ['Review platform modules.', 'Confirm the quality authority is enabled.', 'Run a disposable inspection lifecycle.'],
    ['Installed authority', 'Lifecycle result'],
    ['quality_plans'],
  ),
  sales_authority: define(
    'Sales Supervisor',
    'critical',
    'Confirm canonical customer-order authority is installed for demand intake.',
    ['Review enabled modules.', 'Open Sales Orders.', 'Create a disposable draft order to confirm access.'],
    ['Sales authority status', 'Disposable draft result'],
    ['company_modules'],
  ),
  delivery_locations: define(
    'Warehouse Supervisor',
    'high',
    'Provide customer or transit destinations for controlled delivery.',
    ['Open stock locations.', 'Create customer and transit locations.', 'Verify warehouse routes resolve to them.'],
    ['Delivery-location list', 'Route resolution review'],
    ['stock_locations'],
  ),
  picking_authority: define(
    'Warehouse Supervisor',
    'medium',
    'Enable mobile picking when scanner-led delivery execution is required.',
    ['Confirm Advanced WMS is enabled.', 'Review picking strategies.', 'Run a disposable assigned-pick flow.'],
    ['Picking authority status', 'Disposable pick evidence'],
    ['active_warehouse', 'stock_locations'],
  ),
  assets: define(
    'Maintenance Manager',
    'high',
    'Register maintainable assets used by workshop operations.',
    ['Create asset records.', 'Assign company and operational location.', 'Record the responsible maintenance team.'],
    ['Asset register', 'Ownership and location review'],
    ['active_company'],
  ),
  preventive_plans: define(
    'Maintenance Manager',
    'medium',
    'Schedule preventive work for critical workshop assets.',
    ['Identify critical assets.', 'Define frequencies or meter triggers.', 'Review the next-due schedule.'],
    ['Preventive-plan list', 'Next-due schedule'],
    ['assets'],
  ),
  fleet_vehicles: define(
    'Fleet Manager',
    'low',
    'Register active vehicles when workshop delivery or field work uses fleet.',
    ['Create vehicle records.', 'Set active lifecycle status.', 'Assign responsible drivers or teams.'],
    ['Active vehicle register', 'Responsibility review'],
    ['active_company'],
  ),
  iot_devices: define(
    'IoT Administrator',
    'low',
    'Register active devices only when telemetry supports workshop execution.',
    ['Register the device identity.', 'Bind it to company and asset.', 'Validate recent telemetry without changing controls.'],
    ['Device registry entry', 'Recent telemetry evidence'],
    ['assets'],
  ),
  kiosks: define(
    'Identity Administrator',
    'low',
    'Register shared kiosks with constrained device identities.',
    ['Create a kiosk registration.', 'Bind its allowed workplace.', 'Verify constrained sign-in and timeout policy.'],
    ['Kiosk registration', 'Access-policy verification'],
    ['roles'],
  ),
  offline_clients: define(
    'System Administrator',
    'low',
    'Register offline clients when disconnected execution is approved.',
    ['Register the client.', 'Set synchronization scope.', 'Test conflict handling on disposable records.'],
    ['Client registration', 'Disposable sync evidence'],
    ['active_company'],
  ),
  migration_registry: define(
    'System Administrator',
    'critical',
    'Retain a complete immutable record of applied schema migrations.',
    ['Run migration verification.', 'Resolve missing or modified entries.', 'Archive the verification result.'],
    ['Migration registry count', 'Manifest verification output'],
  ),
  audit_authority: define(
    'Security Administrator',
    'critical',
    'Keep an append-only audit authority available for governed actions.',
    ['Verify the audit table and writer.', 'Execute a disposable governed action.', 'Confirm its correlation and actor fields.'],
    ['Audit authority status', 'Correlated disposable event'],
    ['migration_registry'],
  ),
  authorization_grants: define(
    'Security Administrator',
    'critical',
    'Maintain explicit permission grants supporting least privilege.',
    ['Review permission grants.', 'Remove obsolete elevation through the approved process.', 'Run permission regression.'],
    ['Grant register', 'Permission regression result'],
    ['roles'],
  ),
});

const RISK_WEIGHT = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });
const STATE_WEIGHT = Object.freeze({ BLOCKED: 0, MISSING: 1, WARNING: 2, OPTIONAL: 3, NOT_SUPPORTED: 4, PERMISSION_DENIED: 5, READY: 6 });

export function guidanceFor(check) {
  const definition = READINESS_GUIDANCE[check.id];
  if (!definition) return null;
  return {
    ...definition,
    actionable: !['READY', 'PERMISSION_DENIED', 'NOT_SUPPORTED'].includes(check.state),
    target: check.target,
    currentState: check.state,
  };
}

export function buildReadinessActionPlan(categories) {
  const checks = categories.flatMap((category) => category.checks.map((check) => ({ ...check, categoryId: category.id })));
  const states = new Map(checks.map((check) => [check.id, check.state]));
  const actions = checks.map((check) => {
    const guide = guidanceFor(check);
    if (!guide?.actionable) return null;
    const unresolvedPrerequisites = guide.dependsOn.filter((id) => states.has(id) && states.get(id) !== 'READY');
    return {
      checkId: check.id,
      categoryId: check.categoryId,
      label: check.label,
      state: check.state,
      mandatory: check.mandatory,
      target: check.target,
      ownerRole: guide.ownerRole,
      risk: guide.risk,
      outcome: guide.outcome,
      steps: guide.steps,
      evidence: guide.evidence,
      prerequisites: guide.dependsOn,
      unresolvedPrerequisites,
      executionState: unresolvedPrerequisites.length ? 'WAITING_FOR_PREREQUISITE' : 'READY_TO_CONFIGURE',
    };
  }).filter(Boolean);
  actions.sort((left, right) => {
    const mandatory = Number(right.mandatory) - Number(left.mandatory);
    if (mandatory) return mandatory;
    const state = (STATE_WEIGHT[left.state] ?? 99) - (STATE_WEIGHT[right.state] ?? 99);
    if (state) return state;
    const risk = (RISK_WEIGHT[left.risk] ?? 99) - (RISK_WEIGHT[right.risk] ?? 99);
    return risk || left.checkId.localeCompare(right.checkId);
  });
  return {
    actions,
    summary: {
      total: actions.length,
      readyToConfigure: actions.filter((action) => action.executionState === 'READY_TO_CONFIGURE').length,
      waitingForPrerequisite: actions.filter((action) => action.executionState === 'WAITING_FOR_PREREQUISITE').length,
      critical: actions.filter((action) => action.risk === 'critical').length,
      mandatory: actions.filter((action) => action.mandatory).length,
    },
    ordering: 'mandatory, state severity, operational risk, check id',
  };
}
