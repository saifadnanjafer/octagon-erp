(function governedLookups(root) {
  'use strict';
  const cache = new Map();
  const WMS_RESOURCES = Object.freeze({ warehouses: 'warehouses', zones: 'zones', locations: 'locations', lots: 'lots', serials: 'serials', receivingSessions: 'receiving-sessions', receivingDiscrepancies: 'receiving-discrepancies', pickTasks: 'pick-tasks', waves: 'waves', countPlans: 'count-plans', countSessions: 'count-sessions', docks: 'docks', dockAppointments: 'dock-appointments', qualityCheckpoints: 'quality-checkpoints', dispositions: 'quality-dispositions', putawayRules: 'putaway-rules', putawayQueue: 'putaway-queue', replenishmentRules: 'replenishment-rules', replenishmentProposals: 'replenishment-proposals', crossdockMatches: 'crossdock-matches', recallCases: 'recall-cases', reworkRoutes: 'rework-routes', shopfloorSessions: 'shopfloor-sessions', materialFlow: 'material-flow', downtimeEvents: 'downtime', stagingAllocations: 'staging-allocations' });
  // These are NOT under /api/v1/wms/ - platform/api/index.mjs routes each to its own
  // namespace instead (verified empirically; the bare single-segment form 404s "not found"
  // because the router requires 2 path segments, e.g. /api/v1/work-orders alone fails but
  // /api/v1/manufacturing/work-orders is the real route).
  const NAMESPACED_RESOURCES = Object.freeze({
    productionOrders: ['manufacturing', 'production-orders'], workOrders: ['manufacturing', 'work-orders'],
    products: ['commercial', 'products'],
  });
  const resources = Object.freeze({ ...WMS_RESOURCES, productionOrders: 'production-orders', workOrders: 'work-orders', products: 'products', operators: 'operators' });

  async function searchOperators(normalized) {
    // No dedicated "operators" query resource exists anywhere in the API - operator/assignee
    // fields are just actor/user ids. /api/auth/options (real active identity_users) is the
    // closest real, working source, so this is adapted client-side rather than left as a
    // dead lookup or downgraded to a raw-id text field.
    const result = await root.OctagonApiClient.get('/api/auth/options');
    const users = Array.isArray(result?.users) ? result.users : Array.isArray(result) ? result : [];
    const filtered = normalized ? users.filter((user) => `${user.name || ''} ${user.login || ''}`.toLowerCase().includes(normalized.toLowerCase())) : users;
    return filtered.map((user) => ({ ...user, id: user.id, label: user.displayName || user.name || user.login }));
  }

  async function search(kind, { query = '', page = 1, limit = 25 } = {}) {
    const normalized = String(query).trim().slice(0, 80);
    const key = `${kind}:${normalized}:${page}:${limit}:${root.OctagonRuntimeContext?.warehouseId || ''}`;
    if (cache.has(key)) return cache.get(key);
    if (kind === 'operators') { const rows = await searchOperators(normalized); cache.set(key, rows); return rows; }
    const namespaced = NAMESPACED_RESOURCES[kind];
    const base = namespaced ? `/api/v1/${namespaced[0]}/${namespaced[1]}` : `/api/v1/wms/${resources[kind] || kind}`;
    const url = new URL(base, root.location.href); url.searchParams.set('search', normalized); url.searchParams.set('page', Math.max(1, page)); url.searchParams.set('limit', Math.min(100, Math.max(1, limit)));
    const result = await root.OctagonApiClient.get(url.pathname + url.search);
    const rows = Array.isArray(result) ? result : (result?.items || result?.rows || []);
    const normalizedRows = rows.map((row) => ({ id: row.id, label: row.name || row.code || row.reference || row.id, ...row })); cache.set(key, normalizedRows); return normalizedRows;
  }
  root.OctagonGovernedLookups = { resources, search, clear() { cache.clear(); } };
})(window);
