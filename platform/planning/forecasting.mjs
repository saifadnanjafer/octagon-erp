// BUILD-08 demand-planning authority. Forecasts are projections only.
'use strict';

import crypto from 'node:crypto';

export class ForecastError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'ForecastError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const round = (value, precision = 4) => Number(Number(value || 0).toFixed(precision));
const parse = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

function assertCompany(recordCompany, ctx) {
  const active = ctx?.companyId || ctx?.activeCompanyId;
  if (!active || recordCompany !== active) throw new ForecastError('Company scope denied', 'COMPANY_SCOPE_DENIED', 403);
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ForecastingService {
  constructor(dialect) { this.db = dialect; }

  createHorizon(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    if (!companyId || !input.name || !input.startDate || !input.endDate) {
      throw new ForecastError('Company, name and dates are required', 'INVALID_HORIZON');
    }
    if (input.startDate > input.endDate) throw new ForecastError('Horizon dates are inverted', 'INVALID_HORIZON_RANGE');
    const record = {
      id: id('horizon'), companyId, name: input.name,
      bucketType: input.bucketType || 'week', startDate: input.startDate, endDate: input.endDate,
      frozenUntil: input.frozenUntil || null, planningFenceUntil: input.planningFenceUntil || null,
    };
    this.db.prepare(`INSERT INTO planning_horizons(id,company_id,name,bucket_type,start_date,end_date,frozen_until,planning_fence_until,status,created_at)
      VALUES(?,?,?,?,?,?,?,?, 'active',?)`).run(record.id, companyId, record.name, record.bucketType, record.startDate, record.endDate, record.frozenUntil, record.planningFenceUntil, now());
    return this.getHorizon(record.id, ctx);
  }

  getHorizon(horizonId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM planning_horizons WHERE id=?').get(horizonId);
    if (!row) return null;
    assertCompany(row.company_id, ctx);
    return { id: row.id, companyId: row.company_id, name: row.name, bucketType: row.bucket_type, startDate: row.start_date, endDate: row.end_date, frozenUntil: row.frozen_until, planningFenceUntil: row.planning_fence_until, status: row.status };
  }

  snapshotHistory(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    const horizon = input.horizonId ? this.getHorizon(input.horizonId, { ...ctx, companyId }) : null;
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!companyId || !lines.length) throw new ForecastError('Demand history lines are required', 'EMPTY_DEMAND_HISTORY');
    const normalized = lines.map((line) => ({
      productId: String(line.productId || ''), bucketStart: String(line.bucketStart || ''),
      quantity: round(line.quantity), sourceType: line.sourceType || 'sales_history', sourceReference: line.sourceReference || null,
    }));
    if (normalized.some((line) => !line.productId || !line.bucketStart || line.quantity < 0)) throw new ForecastError('Invalid demand history line', 'INVALID_DEMAND_HISTORY');
    const key = input.idempotencyKey || ctx.idempotencyKey || null;
    if (key) {
      const existing = this.db.prepare('SELECT id FROM demand_history_snapshots WHERE idempotency_key=?').get(key);
      if (existing) return this.getSnapshot(existing.id, { ...ctx, companyId });
    }
    const snapshotId = id('dhs');
    const sourceDigest = digest(normalized);
    this.db.prepare(`INSERT INTO demand_history_snapshots(id,company_id,horizon_id,source_cutoff,source_digest,status,created_by,created_at,idempotency_key)
      VALUES(?,?,?,?,?,'sealed',?,?,?)`).run(snapshotId, companyId, horizon?.id || null, input.sourceCutoff || now(), sourceDigest, ctx.userId || ctx.actorId || 'system', now(), key);
    const insert = this.db.prepare(`INSERT INTO demand_history_lines(id,snapshot_id,product_id,bucket_start,quantity,source_type,source_reference) VALUES(?,?,?,?,?,?,?)`);
    for (const line of normalized) insert.run(id('dhl'), snapshotId, line.productId, line.bucketStart, line.quantity, line.sourceType, line.sourceReference);
    return this.getSnapshot(snapshotId, { ...ctx, companyId });
  }

  getSnapshot(snapshotId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM demand_history_snapshots WHERE id=?').get(snapshotId);
    if (!row) return null;
    assertCompany(row.company_id, ctx);
    const lines = this.db.prepare('SELECT * FROM demand_history_lines WHERE snapshot_id=? ORDER BY product_id,bucket_start').all(snapshotId);
    return { id: row.id, companyId: row.company_id, horizonId: row.horizon_id, sourceCutoff: row.source_cutoff, sourceDigest: row.source_digest, status: row.status, lines: lines.map((line) => ({ id: line.id, productId: line.product_id, bucketStart: line.bucket_start, quantity: Number(line.quantity), sourceType: line.source_type, sourceReference: line.source_reference })) };
  }

  createVersion(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    const horizon = this.getHorizon(input.horizonId, { ...ctx, companyId });
    const snapshot = this.getSnapshot(input.snapshotId, { ...ctx, companyId });
    if (!horizon || !snapshot || !input.name) throw new ForecastError('Horizon, snapshot and name are required', 'INVALID_FORECAST_VERSION');
    const method = input.method || 'moving_average';
    const methods = new Set(['manual', 'moving_average', 'weighted_moving_average', 'exponential_smoothing']);
    if (!methods.has(method)) throw new ForecastError('Unsupported forecast method', 'UNSUPPORTED_FORECAST_METHOD');
    const revisionRow = this.db.prepare('SELECT MAX(revision) AS revision FROM forecast_versions WHERE company_id=? AND name=?').get(companyId, input.name);
    const revision = Number(revisionRow?.revision || 0) + 1;
    const versionId = id('fcv');
    this.db.prepare(`INSERT INTO forecast_versions(id,company_id,horizon_id,snapshot_id,name,method,parameters_json,assumptions_json,status,revision,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?, 'draft',?,?,?,?)`).run(versionId, companyId, horizon.id, snapshot.id, input.name, method, JSON.stringify(input.parameters || {}), JSON.stringify(input.assumptions || []), revision, ctx.userId || ctx.actorId || 'system', now(), now());
    return this.getVersion(versionId, { ...ctx, companyId });
  }

  getVersion(versionId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM forecast_versions WHERE id=?').get(versionId);
    if (!row) return null;
    assertCompany(row.company_id, ctx);
    const lines = this.db.prepare('SELECT * FROM forecast_lines WHERE version_id=? ORDER BY product_id,bucket_start').all(versionId);
    return { id: row.id, companyId: row.company_id, horizonId: row.horizon_id, snapshotId: row.snapshot_id, name: row.name, method: row.method, parameters: parse(row.parameters_json, {}), assumptions: parse(row.assumptions_json, []), status: row.status, revision: row.revision, publishedAt: row.published_at, immutableDigest: row.immutable_digest, lines: lines.map((line) => this.#mapLine(line)) };
  }

  listVersions({ companyId, status } = {}, ctx = {}) {
    const scope = companyId || ctx.companyId;
    if (!scope) throw new ForecastError('Company scope is required', 'COMPANY_SCOPE_REQUIRED', 403);
    let sql = 'SELECT id FROM forecast_versions WHERE company_id=?';
    const params = [scope];
    if (status) { sql += ' AND status=?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(...params).map((row) => this.getVersion(row.id, { ...ctx, companyId: scope }));
  }

  calculate(versionId, ctx = {}) {
    const version = this.getVersion(versionId, ctx);
    if (!version) throw new ForecastError('Forecast version not found', 'FORECAST_NOT_FOUND', 404);
    if (version.status === 'published') throw new ForecastError('Published forecasts are immutable', 'FORECAST_IMMUTABLE', 409);
    const snapshot = this.getSnapshot(version.snapshotId, ctx);
    const grouped = new Map();
    for (const line of snapshot.lines) {
      if (!grouped.has(line.productId)) grouped.set(line.productId, []);
      grouped.get(line.productId).push(line);
    }
    const horizon = this.getHorizon(version.horizonId, ctx);
    this.db.prepare('DELETE FROM forecast_lines WHERE version_id=?').run(versionId);
    const insert = this.db.prepare(`INSERT INTO forecast_lines(id,version_id,product_id,bucket_start,baseline_quantity,approved_quantity,actual_quantity,absolute_error,percentage_error,bias) VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (const [productId, history] of grouped) {
      history.sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
      const quantity = this.#calculateMethod(version.method, history.map((line) => line.quantity), version.parameters);
      const bucketStart = version.parameters.targetBucket || horizon.endDate;
      insert.run(id('fcl'), versionId, productId, bucketStart, quantity, quantity, null, null, null, null);
    }
    this.db.prepare("UPDATE forecast_versions SET status='calculated',updated_at=? WHERE id=?").run(now(), versionId);
    this.#detectExceptions(versionId, ctx);
    return this.getVersion(versionId, ctx);
  }

  submitOverride(input, ctx = {}) {
    const version = this.getVersion(input.versionId, ctx);
    if (!version || !['calculated', 'review'].includes(version.status)) throw new ForecastError('Forecast is not open for overrides', 'FORECAST_NOT_REVIEWABLE', 409);
    const line = version.lines.find((candidate) => candidate.id === input.lineId);
    if (!line || Number(input.quantity) < 0 || !input.reason) throw new ForecastError('Line, quantity and reason are required', 'INVALID_OVERRIDE');
    const overrideId = id('fco');
    this.db.prepare(`INSERT INTO forecast_overrides(id,version_id,line_id,requested_quantity,reason,status,requested_by,requested_at) VALUES(?,?,?,?,?,'pending',?,?)`).run(overrideId, version.id, line.id, round(input.quantity), input.reason, ctx.userId || ctx.actorId || 'system', now());
    this.db.prepare("UPDATE forecast_versions SET status='review',updated_at=? WHERE id=?").run(now(), version.id);
    return this.getOverride(overrideId, ctx);
  }

  approveOverride(overrideId, ctx = {}) {
    const override = this.getOverride(overrideId, ctx);
    if (!override) throw new ForecastError('Override not found', 'OVERRIDE_NOT_FOUND', 404);
    if (override.status !== 'pending') return override;
    this.db.prepare("UPDATE forecast_overrides SET status='approved',approved_by=?,decided_at=? WHERE id=?").run(ctx.userId || ctx.actorId || 'system', now(), overrideId);
    this.db.prepare('UPDATE forecast_lines SET approved_quantity=? WHERE id=?').run(override.requestedQuantity, override.lineId);
    return this.getOverride(overrideId, ctx);
  }

  getOverride(overrideId, ctx = {}) {
    const row = this.db.prepare(`SELECT o.*,v.company_id FROM forecast_overrides o JOIN forecast_versions v ON v.id=o.version_id WHERE o.id=?`).get(overrideId);
    if (!row) return null;
    assertCompany(row.company_id, ctx);
    return { id: row.id, versionId: row.version_id, lineId: row.line_id, requestedQuantity: Number(row.requested_quantity), reason: row.reason, status: row.status, requestedBy: row.requested_by, approvedBy: row.approved_by, requestedAt: row.requested_at, decidedAt: row.decided_at };
  }

  publish(versionId, ctx = {}) {
    const version = this.getVersion(versionId, ctx);
    if (!version) throw new ForecastError('Forecast version not found', 'FORECAST_NOT_FOUND', 404);
    if (version.status === 'published') return version;
    if (!['calculated', 'review'].includes(version.status) || !version.lines.length) throw new ForecastError('Calculate the forecast before publication', 'FORECAST_NOT_CALCULATED', 409);
    const pending = this.db.prepare("SELECT COUNT(*) AS count FROM forecast_overrides WHERE version_id=? AND status='pending'").get(versionId).count;
    if (pending) throw new ForecastError('Pending overrides must be decided', 'PENDING_OVERRIDES', 409);
    const immutableDigest = digest(version.lines.map(({ id: lineId, ...line }) => line));
    this.db.prepare("UPDATE forecast_versions SET status='published',published_at=?,published_by=?,immutable_digest=?,updated_at=? WHERE id=?").run(now(), ctx.userId || ctx.actorId || 'system', immutableDigest, now(), versionId);
    return this.getVersion(versionId, ctx);
  }

  recordActuals(versionId, actuals, ctx = {}) {
    const version = this.getVersion(versionId, ctx);
    if (!version) throw new ForecastError('Forecast version not found', 'FORECAST_NOT_FOUND', 404);
    const update = this.db.prepare('UPDATE forecast_lines SET actual_quantity=?,absolute_error=?,percentage_error=?,bias=? WHERE id=?');
    for (const actual of actuals || []) {
      const line = version.lines.find((candidate) => candidate.id === actual.lineId);
      if (!line) continue;
      const value = round(actual.quantity);
      const error = round(Math.abs(value - line.approvedQuantity));
      const percentage = value ? round((error / Math.abs(value)) * 100, 2) : null;
      update.run(value, error, percentage, round(line.approvedQuantity - value), line.id);
    }
    return this.accuracy(versionId, ctx);
  }

  accuracy(versionId, ctx = {}) {
    const version = this.getVersion(versionId, ctx);
    const measured = version.lines.filter((line) => line.actualQuantity !== null);
    const mae = measured.length ? round(measured.reduce((sum, line) => sum + line.absoluteError, 0) / measured.length, 2) : null;
    const mapeLines = measured.filter((line) => line.percentageError !== null);
    const mape = mapeLines.length ? round(mapeLines.reduce((sum, line) => sum + line.percentageError, 0) / mapeLines.length, 2) : null;
    const bias = measured.length ? round(measured.reduce((sum, line) => sum + line.bias, 0) / measured.length, 2) : null;
    return { versionId, measuredLines: measured.length, mae, mape, bias, lines: measured };
  }

  listExceptions({ companyId, status = 'open' } = {}, ctx = {}) {
    const scope = companyId || ctx.companyId;
    return this.db.prepare('SELECT * FROM planning_exceptions WHERE company_id=? AND status=? ORDER BY created_at DESC').all(scope, status).map((row) => ({ id: row.id, companyId: row.company_id, sourceType: row.source_type, sourceId: row.source_id, exceptionType: row.exception_type, severity: row.severity, message: row.message, status: row.status, createdAt: row.created_at }));
  }

  #calculateMethod(method, values, parameters) {
    if (!values.length) return 0;
    if (method === 'manual') return round(parameters.quantity ?? values.at(-1));
    if (method === 'moving_average') {
      const window = Math.max(1, Math.min(values.length, Number(parameters.window || 3)));
      return round(values.slice(-window).reduce((sum, value) => sum + value, 0) / window);
    }
    if (method === 'weighted_moving_average') {
      const weights = Array.isArray(parameters.weights) && parameters.weights.length ? parameters.weights.map(Number) : [1, 2, 3];
      const sample = values.slice(-weights.length);
      const activeWeights = weights.slice(weights.length - sample.length);
      const totalWeight = activeWeights.reduce((sum, value) => sum + value, 0);
      if (totalWeight <= 0) throw new ForecastError('Weights must have a positive sum', 'INVALID_FORECAST_WEIGHTS');
      return round(sample.reduce((sum, value, index) => sum + value * activeWeights[index], 0) / totalWeight);
    }
    const alpha = Number(parameters.alpha ?? 0.35);
    if (!(alpha > 0 && alpha <= 1)) throw new ForecastError('Alpha must be within (0,1]', 'INVALID_SMOOTHING_ALPHA');
    return round(values.slice(1).reduce((smoothed, value) => alpha * value + (1 - alpha) * smoothed, values[0]));
  }

  #detectExceptions(versionId, ctx) {
    const version = this.getVersion(versionId, ctx);
    const add = this.db.prepare(`INSERT INTO planning_exceptions(id,company_id,source_type,source_id,exception_type,severity,message,status,created_at) VALUES(?,?,?,?,?,?,?,'open',?)`);
    for (const line of version.lines) {
      if (line.baselineQuantity === 0) add.run(id('pex'), version.companyId, 'forecast_line', line.id, 'zero_forecast', 'warning', `No projected demand for ${line.productId}`, now());
    }
  }

  #mapLine(line) {
    return { id: line.id, versionId: line.version_id, productId: line.product_id, bucketStart: line.bucket_start, baselineQuantity: Number(line.baseline_quantity), approvedQuantity: Number(line.approved_quantity), actualQuantity: line.actual_quantity === null ? null : Number(line.actual_quantity), absoluteError: line.absolute_error === null ? null : Number(line.absolute_error), percentageError: line.percentage_error === null ? null : Number(line.percentage_error), bias: line.bias === null ? null : Number(line.bias) };
  }
}

export function createForecastingService(dialect) { return new ForecastingService(dialect); }
