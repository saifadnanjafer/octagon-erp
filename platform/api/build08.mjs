// Read-only BUILD-08 queries. All commands remain registered platform actions.
'use strict';

function denied() { return { error: 'company scope is required', status: 403 }; }
function list(data) { return { data, meta: { total: data.length } }; }
function json(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

export function handleBuild08Query({ dialect, ctx, namespace, resource, recordId, query = {} }) {
  const companyId = ctx.companyId || ctx.activeCompanyId;
  if (!companyId) return denied();

  if (namespace === 'planning') {
    if (resource === 'horizons') {
      const rows = dialect.prepare('SELECT * FROM planning_horizons WHERE company_id=? ORDER BY start_date DESC').all(companyId);
      return list(rows.map((row) => ({ id: row.id, companyId: row.company_id, name: row.name, bucketType: row.bucket_type, startDate: row.start_date, endDate: row.end_date, frozenUntil: row.frozen_until, planningFenceUntil: row.planning_fence_until, status: row.status })));
    }
    if (resource === 'forecasts') {
      const params = [companyId];
      let sql = 'SELECT * FROM forecast_versions WHERE company_id=?';
      if (query.status) { sql += ' AND status=?'; params.push(query.status); }
      if (recordId) { sql += ' AND id=?'; params.push(recordId); }
      sql += ' ORDER BY created_at DESC';
      const rows = dialect.prepare(sql).all(...params).map((row) => ({ ...row, parameters: json(row.parameters_json, {}), assumptions: json(row.assumptions_json, []) }));
      return recordId ? (rows[0] ? { data: rows[0], meta: null } : { error: 'forecast not found', status: 404 }) : list(rows);
    }
    if (resource === 'forecast-lines') {
      if (!query.version_id) return { error: 'version_id is required', status: 422 };
      const owned = dialect.prepare('SELECT 1 FROM forecast_versions WHERE id=? AND company_id=?').get(query.version_id, companyId);
      if (!owned) return { error: 'forecast not found', status: 404 };
      return list(dialect.prepare('SELECT * FROM forecast_lines WHERE version_id=? ORDER BY product_id,bucket_start').all(query.version_id));
    }
    if (resource === 'overrides') {
      return list(dialect.prepare(`SELECT o.* FROM forecast_overrides o JOIN forecast_versions v ON v.id=o.version_id WHERE v.company_id=? ORDER BY o.requested_at DESC`).all(companyId));
    }
    if (resource === 'exceptions') {
      return list(dialect.prepare('SELECT * FROM planning_exceptions WHERE company_id=? AND status=? ORDER BY created_at DESC').all(companyId, query.status || 'open'));
    }
    return { error: 'planning resource not found', status: 404 };
  }

  if (namespace === 'mps') {
    if (resource === 'runs') {
      const params = recordId ? [companyId, recordId] : [companyId];
      const rows = dialect.prepare(`SELECT * FROM mps_runs WHERE company_id=?${recordId ? ' AND id=?' : ''} ORDER BY created_at DESC`).all(...params);
      return recordId ? (rows[0] ? { data: rows[0], meta: null } : { error: 'MPS run not found', status: 404 }) : list(rows);
    }
    if (resource === 'balance') {
      if (!query.run_id) return { error: 'run_id is required', status: 422 };
      return list(dialect.prepare(`SELECT l.* FROM mps_lines l JOIN mps_runs r ON r.id=l.run_id WHERE r.company_id=? AND r.id=? ORDER BY l.product_id,l.bucket_start`).all(companyId, query.run_id));
    }
    if (resource === 'proposals') {
      return list(dialect.prepare(`SELECT p.* FROM supply_proposals p WHERE p.company_id=? AND (?='' OR p.status=?) ORDER BY p.required_date`).all(companyId, query.status || '', query.status || ''));
    }
    return { error: 'MPS resource not found', status: 404 };
  }

  if (namespace === 'sop') {
    if (resource === 'cycles') {
      const rows = dialect.prepare(`SELECT * FROM sop_cycles WHERE company_id=?${recordId ? ' AND id=?' : ''} ORDER BY created_at DESC`).all(...(recordId ? [companyId, recordId] : [companyId]));
      return recordId ? (rows[0] ? { data: rows[0], meta: null } : { error: 'S&OP cycle not found', status: 404 }) : list(rows);
    }
    if (resource === 'scenarios') {
      const rows = dialect.prepare(`SELECT s.* FROM sop_scenarios s JOIN sop_cycles c ON c.id=s.cycle_id WHERE c.company_id=?${query.cycle_id ? ' AND c.id=?' : ''} ORDER BY s.created_at`).all(...(query.cycle_id ? [companyId, query.cycle_id] : [companyId]));
      return list(rows.map((row) => ({ ...row, assumptions: json(row.assumptions_json, []), gaps: json(row.gaps_json, []), resolutions: json(row.resolutions_json, []) })));
    }
    return { error: 'S&OP resource not found', status: 404 };
  }

  if (namespace === 'treasury') {
    if (resource === 'positions') {
      const rows = dialect.prepare(`SELECT * FROM treasury_cash_positions WHERE company_id=?${recordId ? ' AND id=?' : ''} ORDER BY as_of_date DESC`).all(...(recordId ? [companyId, recordId] : [companyId]));
      return recordId ? (rows[0] ? { data: rows[0], meta: null } : { error: 'cash position not found', status: 404 }) : list(rows);
    }
    if (resource === 'liquidity-forecasts') {
      const rows = dialect.prepare(`SELECT * FROM liquidity_forecasts_v2 WHERE company_id=?${recordId ? ' AND id=?' : ''} ORDER BY created_at DESC`).all(...(recordId ? [companyId, recordId] : [companyId]));
      return recordId ? (rows[0] ? { data: rows[0], meta: null } : { error: 'liquidity forecast not found', status: 404 }) : list(rows);
    }
    if (resource === 'liquidity-buckets') {
      if (!query.forecast_id) return { error: 'forecast_id is required', status: 422 };
      return list(dialect.prepare(`SELECT b.* FROM liquidity_forecast_buckets b JOIN liquidity_forecasts_v2 f ON f.id=b.forecast_id WHERE f.company_id=? AND f.id=? ORDER BY b.bucket_start`).all(companyId, query.forecast_id));
    }
    if (resource === 'alerts') return list(dialect.prepare('SELECT * FROM treasury_alerts WHERE company_id=? AND status=? ORDER BY created_at DESC').all(companyId, query.status || 'open'));
    if (resource === 'proposals') return list(dialect.prepare(`SELECT * FROM treasury_proposals WHERE company_id=? AND (?='' OR status=?) ORDER BY created_at DESC`).all(companyId, query.status || '', query.status || ''));
    if (resource === 'facilities') return list(dialect.prepare('SELECT * FROM financing_facilities WHERE company_id=? ORDER BY end_date').all(companyId));
    if (resource === 'instruments') return list(dialect.prepare('SELECT * FROM bank_instruments WHERE company_id=? ORDER BY expiry_date').all(companyId));
    return { error: 'treasury resource not found', status: 404 };
  }

  return { error: 'BUILD-08 namespace not found', status: 404 };
}
