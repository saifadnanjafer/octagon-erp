(function apiClient(root) {
  'use strict';
  const active = new Map(); const submitted = new Set();
  class ApiError extends Error { constructor(message, status, code, correlationId) { super(message); this.name = 'OctagonApiError'; this.status = status; this.code = code; this.correlationId = correlationId; } }
  async function request(path, options = {}) {
    const context = root.OctagonRuntimeContext; if (context) await context.ready;
    const method = String(options.method || 'GET').toUpperCase(); const key = `${method}:${path}:${options.idempotencyKey || ''}`;
    if (active.has(key)) return active.get(key);
    if (method !== 'GET' && submitted.has(key)) throw new ApiError('Duplicate submission prevented', 409, 'DUPLICATE_SUBMISSION');
    const controller = options.signal ? null : new AbortController(); const signal = options.signal || controller.signal;
    const url = new URL(path, root.location.href); if (method === 'GET' && context?.warehouseId && !url.searchParams.has('warehouse_id')) url.searchParams.set('warehouse_id', context.warehouseId);
    const promise = fetch(url, { ...options, method, signal, credentials: 'same-origin', headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } }).then(async (response) => { const body = await response.json().catch(() => null); const correlationId = body?.correlationId || response.headers.get('x-correlation-id'); if (!response.ok || body?.success === false) throw new ApiError(body?.error || `HTTP ${response.status}`, response.status, body?.code, correlationId); return body?.data === undefined ? body : body.data; }).finally(() => active.delete(key));
    active.set(key, promise); if (method !== 'GET') submitted.add(key); return promise;
  }
  root.OctagonApiClient = { request, get: (path, options) => request(path, { ...options, method: 'GET' }), post: (path, body, options) => request(path, { ...options, method: 'POST', body: JSON.stringify(body || {}), idempotencyKey: options?.idempotencyKey || `${path}:${Date.now()}` }), ApiError };
})(window);
