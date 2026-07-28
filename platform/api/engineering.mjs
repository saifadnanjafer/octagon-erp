// Engineering / BOM / Routing / Work Center / MRP query surface — Checkpoint D2.
//
// Read side only. Every mutation stays on POST /api/v1/action/:actionId so
// governed engineering facts are never reachable through generic CRUD.

'use strict';

import { readBom, listBoms, effectiveBomVersion } from '../engineering/bom.mjs';
import { readRouting, effectiveRoutingVersion } from '../engineering/routing.mjs';
import { mrpReport } from '../engineering/mrp.mjs';

function rows(data) {
  return { data, meta: { total: Array.isArray(data) ? data.length : 1 } };
}

function scoped(dialect, ctx, table, query, orderBy = 'created_at DESC', extra = {}) {
  const filters = ['company_id = ?'];
  const params = [ctx.companyId];
  for (const [column, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') {
      filters.push(`${column} = ?`);
      params.push(String(value));
    }
  }
  if (query.state) { filters.push('state = ?'); params.push(String(query.state)); }
  const limit = Math.min(Number(query.limit || 200), 500);
  return dialect.prepare(
    `SELECT * FROM ${table} WHERE ${filters.join(' AND ')} ORDER BY ${orderBy} LIMIT ?`,
  ).all(...params, limit);
}

export function handleEngineeringQuery({ dialect, ctx, namespace, resource, recordId = null, query = {} }) {
  try {
    // ---- /api/v1/boms/*
    if (namespace === 'boms') {
      if (resource === 'list' || !resource) return rows(listBoms(dialect, ctx, query));
      if (resource === 'detail' && recordId) return { data: readBom(dialect, recordId, ctx.companyId), meta: null };
      if (resource === 'versions') {
        return rows(scoped(dialect, ctx, 'bom_versions', query, 'revision DESC', { bom_id: query.bom_id }));
      }
      if (resource === 'lines' && query.bom_version_id) {
        return rows(dialect.prepare(
          'SELECT * FROM bom_lines WHERE company_id = ? AND bom_version_id = ? ORDER BY sequence',
        ).all(ctx.companyId, String(query.bom_version_id)));
      }
      if (resource === 'effective' && query.bom_id) {
        return { data: effectiveBomVersion(dialect, ctx.companyId, String(query.bom_id)), meta: null };
      }
      return rows(listBoms(dialect, ctx, query));
    }

    // ---- /api/v1/routings/*
    if (namespace === 'routings') {
      if (resource === 'detail' && recordId) return { data: readRouting(dialect, recordId, ctx.companyId), meta: null };
      if (resource === 'versions') {
        return rows(scoped(dialect, ctx, 'routing_versions', query, 'revision DESC', { routing_id: query.routing_id }));
      }
      if (resource === 'operations' && query.routing_version_id) {
        return rows(dialect.prepare(
          'SELECT * FROM routing_operations WHERE company_id = ? AND routing_version_id = ? ORDER BY sequence',
        ).all(ctx.companyId, String(query.routing_version_id)));
      }
      if (resource === 'effective' && query.routing_id) {
        return { data: effectiveRoutingVersion(dialect, ctx.companyId, String(query.routing_id)), meta: null };
      }
      return rows(dialect.prepare(`
        SELECT r.*, v.id AS effective_version_id, v.revision AS effective_revision
        FROM routings r
        LEFT JOIN routing_versions v ON v.routing_id = r.id AND v.state = 'approved'
        WHERE r.company_id = ? ORDER BY r.created_at DESC LIMIT 200
      `).all(ctx.companyId));
    }

    // ---- /api/v1/work-centers/*
    if (namespace === 'work-centers') {
      if (resource === 'resources') {
        return rows(scoped(dialect, ctx, 'work_center_resources', query, 'name', { work_center_id: query.work_center_id }));
      }
      return rows(dialect.prepare(
        'SELECT * FROM work_centers WHERE company_id = ? ORDER BY code LIMIT 300',
      ).all(ctx.companyId));
    }

    // ---- /api/v1/engineering/*
    if (namespace === 'engineering') {
      if (resource === 'change-orders') return rows(scoped(dialect, ctx, 'engineering_change_orders', query));
      if (resource === 'dashboard') {
        return {
          data: {
            bom_count: dialect.prepare('SELECT COUNT(*) AS c FROM boms WHERE company_id = ?').get(ctx.companyId).c,
            approved_boms: dialect.prepare("SELECT COUNT(*) AS c FROM bom_versions WHERE company_id = ? AND state = 'approved'").get(ctx.companyId).c,
            draft_boms: dialect.prepare("SELECT COUNT(*) AS c FROM bom_versions WHERE company_id = ? AND state IN ('draft','review')").get(ctx.companyId).c,
            routing_count: dialect.prepare('SELECT COUNT(*) AS c FROM routings WHERE company_id = ?').get(ctx.companyId).c,
            work_center_count: dialect.prepare('SELECT COUNT(*) AS c FROM work_centers WHERE company_id = ? AND is_active = 1').get(ctx.companyId).c,
            open_ecos: dialect.prepare("SELECT COUNT(*) AS c FROM engineering_change_orders WHERE company_id = ? AND state IN ('draft','submitted')").get(ctx.companyId).c,
          },
          meta: null,
        };
      }
      return { error: `unknown engineering resource: ${resource}`, status: 404 };
    }

    // ---- /api/v1/mrp/*
    if (namespace === 'mrp') {
      if (resource === 'policies') {
        return rows(dialect.prepare(`
          SELECT p.*, v.sku, v.name AS product_name
          FROM mrp_item_policies p JOIN product_variants v ON v.id = p.product_id
          WHERE p.company_id = ? ORDER BY v.sku LIMIT 300
        `).all(ctx.companyId));
      }
      if (resource === 'demand') return rows(mrpReport(dialect, ctx, 'demand'));
      if (resource === 'runs') return rows(mrpReport(dialect, ctx, 'runs'));
      if (resource === 'requirements') {
        const filters = ['r.company_id = ?'];
        const params = [ctx.companyId];
        if (query.mrp_run_id) { filters.push('r.mrp_run_id = ?'); params.push(String(query.mrp_run_id)); }
        return rows(dialect.prepare(`
          SELECT r.*, v.sku, v.name AS product_name
          FROM mrp_requirements r JOIN product_variants v ON v.id = r.product_id
          WHERE ${filters.join(' AND ')} ORDER BY r.level, r.created_at LIMIT 500
        `).all(...params));
      }
      if (resource === 'proposals') return rows(mrpReport(dialect, ctx, 'proposals'));
      if (resource === 'shortages') return rows(mrpReport(dialect, ctx, 'shortages'));
      if (resource === 'worklist') return rows(mrpReport(dialect, ctx, 'planner_worklist'));
      if (resource === 'reports') return rows(mrpReport(dialect, ctx, String(query.report || 'shortages'), query));
      return { error: `unknown mrp resource: ${resource}`, status: 404 };
    }

    return { error: `unknown namespace: ${namespace}`, status: 404 };
  } catch (error) {
    if (error && typeof error.code === 'string') {
      return { error: `${error.code}: ${error.message}`, status: error.statusCode || 422 };
    }
    throw error;
  }
}
