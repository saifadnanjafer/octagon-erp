(function governedLookups(root) {
  'use strict';
  const cache = new Map();
  const resources = Object.freeze({ warehouses: 'warehouses', zones: 'zones', locations: 'locations', products: 'products', variants: 'product-variants', lots: 'lots', serials: 'serials', receivingSessions: 'receiving-sessions', receivingDiscrepancies: 'receiving-discrepancies', pickTasks: 'pick-tasks', waves: 'waves', countPlans: 'count-plans', countSessions: 'count-sessions', docks: 'docks', dockAppointments: 'dock-appointments', productionOrders: 'production-orders', workOrders: 'work-orders', workCenters: 'work-centers', operators: 'operators', qualityCheckpoints: 'quality-checkpoints', dispositions: 'quality-dispositions', putawayRules: 'putaway-rules', putawayQueue: 'putaway-queue', replenishmentRules: 'replenishment-rules', replenishmentProposals: 'replenishment-proposals', crossdockMatches: 'crossdock-matches', recallCases: 'recall-cases', reworkRoutes: 'rework-routes', shopfloorSessions: 'shopfloor-sessions', materialFlow: 'material-flow', downtimeEvents: 'downtime', stagingAllocations: 'staging-allocations' });
  async function search(kind, { query = '', page = 1, limit = 25 } = {}) {
    const resource = resources[kind] || kind; const normalized = String(query).trim().slice(0, 80); const key = `${resource}:${normalized}:${page}:${limit}:${root.OctagonRuntimeContext?.warehouseId || ''}`;
    if (cache.has(key)) return cache.get(key);
    const url = new URL(`/api/v1/wms/${resource}`, root.location.href); url.searchParams.set('search', normalized); url.searchParams.set('page', Math.max(1, page)); url.searchParams.set('limit', Math.min(100, Math.max(1, limit)));
    const result = await root.OctagonApiClient.get(url.pathname + url.search);
    const rows = Array.isArray(result) ? result : (result?.items || result?.rows || []);
    const normalizedRows = rows.map((row) => ({ id: row.id, label: row.name || row.code || row.reference || row.id, ...row })); cache.set(key, normalizedRows); return normalizedRows;
  }
  root.OctagonGovernedLookups = { resources, search, clear() { cache.clear(); } };
})(window);
