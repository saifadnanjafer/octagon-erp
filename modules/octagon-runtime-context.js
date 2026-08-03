(function runtimeContext(root) {
  'use strict';
  const listeners = new Set();
  const preferenceKey = 'octagon_active_warehouse_id';
  const state = { ready: false, actorId: null, userId: null, tenantId: null, companyId: null, branchId: null, warehouseId: null, availableCompanies: [], availableBranches: [], availableWarehouses: [], permissions: [], locale: document.documentElement.lang || 'ar', direction: document.documentElement.dir || 'rtl' };
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const notify = () => listeners.forEach((listener) => { try { listener(snapshot()); } catch (_) {} });
  const snapshot = () => ({ ...state, availableCompanies: state.availableCompanies.slice(), availableBranches: state.availableBranches.slice(), availableWarehouses: state.availableWarehouses.slice() });
  async function refresh() {
    const response = await fetch('/api/v1/runtime/context', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
    const context = payload.data || payload.context || {};
    Object.assign(state, { ready: true, actorId: context.actorId, userId: context.userId, tenantId: context.tenantId, companyId: context.companyId, branchId: context.branchId, warehouseId: context.warehouseId || null, availableCompanies: context.availableCompanies || [], availableBranches: context.availableBranches || [], availableWarehouses: context.availableWarehouses || [], permissions: context.permissions || [], locale: context.locale || state.locale, direction: context.direction || state.direction });
    const saved = root.localStorage?.getItem(preferenceKey);
    if (saved && state.availableWarehouses.some((warehouse) => warehouse.id === saved)) state.warehouseId = saved;
    else if (saved) root.localStorage.removeItem(preferenceKey);
    if (!state.warehouseId && state.availableWarehouses.length === 1) state.warehouseId = state.availableWarehouses[0].id;
    sync(); readyResolve(snapshot()); notify(); return snapshot();
  }
  async function postContext(patch) {
    const response = await fetch('/api/auth/context', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: state.companyId, branchId: state.branchId, ...patch }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }
  // Warehouse selection is NOT a server session field (platform-runtime-bridge.mjs
  // handleContextSwitch only persists companyId/branchId) - it is a client preference,
  // validated here against the server-returned availableWarehouses list, and re-enforced
  // by the server on every single read/write query via its own company+warehouse scope
  // check. No /api/auth/context round-trip belongs here.
  async function setWarehouse(id) {
    await ready; const selected = state.availableWarehouses.find((warehouse) => warehouse.id === id);
    if (!selected) throw new Error('Warehouse is not available in the current scope');
    state.warehouseId = id; root.localStorage?.setItem(preferenceKey, id); sync(); notify(); return snapshot();
  }
  async function selectCompany(id) {
    await ready; const selected = state.availableCompanies.find((company) => company.id === id);
    if (!selected) throw new Error('Company is not available in the current scope');
    await postContext({ companyId: id, branchId: null });
    state.companyId = id; state.branchId = null; state.warehouseId = null; root.localStorage?.removeItem(preferenceKey); sync(); notify();
    return refresh();
  }
  async function selectBranch(id) {
    await ready; const selected = state.availableBranches.find((branch) => branch.id === id);
    if (!selected) throw new Error('Branch is not available in the current scope');
    await postContext({ branchId: id });
    state.branchId = id; state.warehouseId = null; root.localStorage?.removeItem(preferenceKey); sync(); notify();
    return refresh();
  }
  // The public object exposes live state fields directly (not just via snapshot()) because
  // every BUILD-09 consumer reads e.g. OctagonRuntimeContext.warehouseId as a plain property.
  function sync() { Object.assign(api, snapshot()); }
  const api = { ready, refresh, setWarehouse, selectCompany, selectBranch, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, snapshot };
  root.OctagonRuntimeContext = api;
  sync();
  root.OctagonRuntimeContext.refresh().catch((error) => { state.ready = true; state.error = error.message; sync(); readyResolve(snapshot()); notify(); });
})(window);
