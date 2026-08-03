(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function getContext() {
    if (root.OctagonRuntimeContext && typeof root.OctagonRuntimeContext.getContext === 'function') {
      return root.OctagonRuntimeContext.getContext();
    }
    const bootstrap = root.__octagonBootstrap || {};
    const companyId = bootstrap.actor?.activeCompanyId || bootstrap.activeCompanyId || 'default';
    const warehouseId = root.localStorage?.getItem('octagon_active_warehouse_id') || bootstrap.warehouseId || 'wh-main';
    const branchId = bootstrap.branchId || 'branch-a';
    const userId = bootstrap.actor?.id || 'browser-manager';
    return { companyId, warehouseId, branchId, userId };
  }

  async function fetchPageData(pageKey, searchFilter = '') {
    const registry = root.Build10Registry;
    const pageMeta = registry ? registry.getPage(pageKey) : null;
    if (!pageMeta || !pageMeta.api) return { status: 200, data: [] };

    const ctx = getContext();
    const headers = {
      'content-type': 'application/json',
      'x-company': ctx.companyId,
      'x-warehouse': ctx.warehouseId,
      'x-branch': ctx.branchId,
      'x-user': ctx.userId
    };

    let url = pageMeta.api;
    if (searchFilter) {
      url += (url.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(searchFilter);
    }

    try {
      if (root.OctagonApiClient && typeof root.OctagonApiClient.query === 'function') {
        const result = await root.OctagonApiClient.query(pageMeta.api, { q: searchFilter });
        if (result && Array.isArray(result.data)) {
          return { status: 200, data: result.data };
        }
      }

      const response = await fetch(url, { headers });
      if (response.status === 403) {
        return { status: 403, error: 'Permission denied', data: [] };
      }
      if (!response.ok) {
        return { status: response.status, error: `HTTP ${response.status}`, data: [] };
      }
      const payload = await response.json();
      const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
      return { status: 200, data: list };
    } catch (err) {
      return { status: 500, error: err.message, data: [] };
    }
  }

  root.Build10Api = {
    getContext,
    fetchPageData
  };
})();
