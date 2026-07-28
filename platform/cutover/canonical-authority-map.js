// Canonical authority map — single source of truth for which legacy
// collection paths are owned by a canonical backend authority.
//
// Checkpoint F extraction. This table previously lived inline inside the
// server.js request handler, which meant:
//   - it could not be imported by a test, so its *coverage* was never asserted;
//   - a domain shipped without an entry here silently kept a live competing
//     legacy writer via POST /api/collection and POST /api/record.
//
// Extracting it changes no runtime behaviour: the same array, the same
// matchers, the same lookup. What it adds is testability — see
// tests/checkpoint-f/canonical_authority_coverage.test.mjs, which asserts that
// every canonical business module registered in platform_modules has an entry
// here.
//
// IMPORTANT — presence in this table is NOT enforcement. A domain listed here
// is only refused on the legacy routes when canonicalAuthorityEnforced() says
// so (FINANCE unconditionally; every other domain behind the
// phase04.canonical_cutover flag AND a RETIRED authority_retirement_locks row).
// Adding a domain here is therefore inert until the owner runs the cutover.
// That is deliberate: it makes the domain *lockable* and visible to release
// health without changing behaviour for the running workshop.

'use strict';

const CANONICAL_AUTHORITY_COLLECTIONS = [
  {
    domain: 'FINANCE',
    paths: [
      'finance.accounts', 'finance.transactions', 'finance.journals', 'finance.documents',
      'finance.document_lines', 'finance.journal_entries', 'finance.journal_lines',
      'finance.locks', 'finance.periods', 'finance.taxes', 'finance.currencies',
      'finance.exchange_rates', 'finance.payments', 'finance.allocations',
      'finance.bank_statements', 'finance.cashboxes', 'finance.budgets', 'finance.expenses',
      'account_moves', 'accounts', 'omni.finance_accounts', 'omni.account_moves',
    ],
    matches: (lower) => (
      lower === 'finance'
      || (lower.startsWith('finance.') && lower !== 'finance.customers')
      || lower.startsWith('finance_')
      || lower.startsWith('omni.finance_')
      || ['account_moves', 'accounts', 'omni.account_moves'].includes(lower)
    ),
  },
  {
    domain: 'COMMERCIAL',
    paths: [
      'finance.customers', 'customers', 'suppliers', 'contacts',
      'omni.materials', 'materials', 'omni.suppliers',
    ],
    matches: (lower) => [
      'finance.customers', 'customers', 'suppliers', 'contacts',
      'omni.materials', 'materials', 'omni.suppliers',
    ].includes(lower),
  },
  {
    domain: 'INVENTORY',
    paths: [
      'stock_moves', 'quants', 'transfers', 'locations', 'warehouses',
      'omni.lots', 'omni.serials', 'omni.packages',
    ],
    matches: (lower) => [
      'stock_moves', 'quants', 'transfers', 'locations', 'warehouses',
      'omni.lots', 'omni.serials', 'omni.packages',
    ].includes(lower),
  },
  {
    domain: 'SALES',
    paths: ['salesOrders', 'omni.salesOrders', 'omni.crm', 'leads'],
    matches: (lower) => ['salesorders', 'omni.salesorders', 'omni.crm', 'leads'].includes(lower),
  },
  {
    domain: 'PROCUREMENT',
    paths: ['purchaseOrders', 'omni.purchaseOrders'],
    matches: (lower) => ['purchaseorders', 'omni.purchaseorders'].includes(lower),
  },
  {
    domain: 'POS',
    paths: ['posOrders', 'omni.posOrders', 'pos'],
    matches: (lower) => ['posorders', 'omni.posorders', 'pos'].includes(lower),
  },
  {
    domain: 'WORK_ITEM',
    paths: ['tasks', 'omni.kanban.cards', 'omni.taskManager'],
    matches: (lower) => (
      lower === 'tasks'
      || lower === 'omni.kanban.cards'
      || lower === 'omni.taskmanager'
      || lower.startsWith('omni.taskmanager.')
    ),
  },

  // ---------------------------------------------------------------------
  // Checkpoint F additions — the Checkpoint D/E domains.
  //
  // These shipped with a canonical backend (330 registered actions across
  // operations_projects, operations_engineering, operations_manufacturing,
  // operations_quality, assets_management, operations_maintenance and
  // fleet_telematics) but with NO entry in this table, so their legacy
  // collections were writable through POST /api/collection and POST
  // /api/record with no canonical-authority refusal available at all —
  // not even behind a flag. Registering them here makes them lockable.
  //
  // omni.jobOrders is deliberately NOT claimed by MANUFACTURING: that path is
  // the workshop execution chain (see HARD_PROTECTED_COLLECTIONS in
  // server.js), which is a different authority from MRP work orders.
  // ---------------------------------------------------------------------
  {
    domain: 'PROJECT',
    paths: ['projects', 'omni.projects', 'omni.projectTasks', 'omni.projectPhases'],
    matches: (lower) => [
      'projects', 'omni.projects', 'omni.projecttasks', 'omni.projectphases',
    ].includes(lower),
  },
  {
    domain: 'ENGINEERING',
    paths: ['boms', 'omni.boms', 'routings', 'omni.routings', 'omni.workCenters'],
    matches: (lower) => [
      'boms', 'omni.boms', 'routings', 'omni.routings', 'omni.workcenters',
    ].includes(lower),
  },
  {
    domain: 'MANUFACTURING',
    paths: [
      'productionOrders', 'omni.productionOrders', 'workOrders', 'omni.workOrders',
    ],
    matches: (lower) => [
      'productionorders', 'omni.productionorders', 'workorders', 'omni.workorders',
    ].includes(lower),
  },
  {
    domain: 'QUALITY',
    paths: ['qualityChecks', 'omni.quality', 'omni.qualityChecks', 'omni.ncrs'],
    matches: (lower) => [
      'qualitychecks', 'omni.quality', 'omni.qualitychecks', 'omni.ncrs',
    ].includes(lower),
  },
  {
    domain: 'ASSET',
    paths: ['assets', 'omni.assets', 'omni.assetCategories', 'omni.depreciation'],
    matches: (lower) => [
      'assets', 'omni.assets', 'omni.assetcategories', 'omni.depreciation',
    ].includes(lower),
  },
  {
    domain: 'MAINTENANCE',
    paths: ['maintenance', 'omni.maintenance', 'omni.maintenanceOrders', 'omni.maintenanceRequests'],
    matches: (lower) => [
      'maintenance', 'omni.maintenance', 'omni.maintenanceorders', 'omni.maintenancerequests',
    ].includes(lower),
  },
  {
    domain: 'FLEET',
    paths: ['fleet', 'omni.fleet', 'vehicles', 'omni.vehicles', 'omni.trips'],
    matches: (lower) => [
      'fleet', 'omni.fleet', 'vehicles', 'omni.vehicles', 'omni.trips',
    ].includes(lower),
  },
];

function canonicalAuthorityForCollection(colName) {
  if (!colName) return null;
  const lower = String(colName).toLowerCase();
  return CANONICAL_AUTHORITY_COLLECTIONS.find(({ matches }) => matches(lower)) || null;
}

function canonicalAuthorityError(authority) {
  return {
    ok: false,
    code: `${authority.domain}_CANONICAL_AUTHORITY_REQUIRED`,
    error: `Governed ${authority.domain.toLowerCase()} facts cannot be mutated via legacy write routes. Use POST /api/v1/action/:actionId`,
  };
}

module.exports = {
  CANONICAL_AUTHORITY_COLLECTIONS,
  canonicalAuthorityForCollection,
  canonicalAuthorityError,
};
