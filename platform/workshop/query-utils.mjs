'use strict';

export const WORKSHOP_LIMIT = 200;

export function scopedContext(ctx = {}, query = {}) {
  const companyId = ctx.companyId || ctx.activeCompanyId || '';
  const warehouseId = query.warehouse_id || ctx.warehouseId || '';
  const branchId = query.branch_id || ctx.branchId || '';
  return Object.freeze({
    companyId,
    warehouseId,
    branchId,
    actorId: ctx.actorId || ctx.userId || '',
    userId: ctx.userId || ctx.actorId || '',
    locale: ctx.locale || 'ar',
    direction: ctx.direction || 'rtl',
  });
}

export function requireCompany(scope) {
  if (!scope.companyId) return { error: 'company scope is required', status: 403 };
  return null;
}

export function tableExists(dialect, table) {
  return Boolean(dialect.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(table));
}

export function tableColumns(dialect, table) {
  if (!tableExists(dialect, table)) return new Set();
  return new Set(dialect.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

export function count(dialect, sql, ...params) {
  const row = dialect.prepare(sql).get(...params);
  return Number(row?.value || row?.count || 0);
}

export function first(dialect, sql, ...params) {
  return dialect.prepare(sql).get(...params) || null;
}

export function list(dialect, sql, ...params) {
  return dialect.prepare(sql).all(...params).slice(0, WORKSHOP_LIMIT);
}

export function safeMetric(definition, context) {
  const started = Date.now();
  const base = {
    id: definition.id,
    section: definition.section,
    label: definition.label,
    labelAr: definition.labelAr,
    permission: definition.permission,
    target: definition.target,
    tone: definition.tone || 'neutral',
    generatedAt: new Date().toISOString(),
  };
  if (!context.can(definition.permission)) {
    return { ...base, state: 'permission_denied', value: null, detail: 'Permission denied', durationMs: Date.now() - started };
  }
  try {
    const result = definition.load(context);
    return { ...base, state: 'ready', ...result, durationMs: Date.now() - started };
  } catch (error) {
    return {
      ...base,
      state: 'unavailable',
      value: null,
      detail: error?.message || 'Metric unavailable',
      code: error?.code || 'WORKSHOP_METRIC_FAILED',
      durationMs: Date.now() - started,
    };
  }
}

export function validateWarehouse(dialect, scope) {
  if (!scope.warehouseId) return { valid: false, reason: 'warehouse scope is required' };
  if (!tableExists(dialect, 'warehouses')) return { valid: false, reason: 'warehouse authority is unavailable' };
  const row = dialect.prepare('SELECT id,company_id,name,code FROM warehouses WHERE id=? AND company_id=?').get(scope.warehouseId, scope.companyId);
  return row ? { valid: true, row } : { valid: false, reason: 'warehouse is outside company scope' };
}

export function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function boundedText(value, max = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

