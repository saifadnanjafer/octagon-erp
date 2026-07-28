// Projects query surface — Checkpoint D1.
//
// Read side only. Every mutation stays on POST /api/v1/action/:actionId so
// governed facts are never reachable through unrestricted generic CRUD.
//
// Reads inherit server-derived company scope from ctx; authorization
// (platform:db:read) is enforced by platform/api/index.mjs before dispatch.
// Results are plain { data, meta } / { error, status } objects so the
// router's error envelope stays accurate.

'use strict';

import { listProjects, readProject, listProjectTasks } from '../projects/projects.mjs';
import { listBillingRequests } from '../projects/billing.mjs';
import { listEffort } from '../projects/effort.mjs';
import {
  projectCostBreakdown, projectBudgetVsActual, projectProfitability, projectReport,
} from '../projects/costing.mjs';

function rows(data) {
  return { data, meta: { total: Array.isArray(data) ? data.length : 1 } };
}

function scopedList(dialect, ctx, table, query, orderBy = 'created_at DESC') {
  const filters = ['company_id = ?'];
  const params = [ctx.companyId];
  if (query.project_id) { filters.push('project_id = ?'); params.push(String(query.project_id)); }
  if (query.state) { filters.push('state = ?'); params.push(String(query.state)); }
  const limit = Math.min(Number(query.limit || 200), 500);
  return dialect.prepare(
    `SELECT * FROM ${table} WHERE ${filters.join(' AND ')} ORDER BY ${orderBy} LIMIT ?`,
  ).all(...params, limit);
}

export function handleProjectsQuery({ dialect, ctx, resource, recordId = null, query = {} }) {
  try {
    switch (resource) {
      case 'projects':
        if (recordId) return { data: readProject(dialect, recordId, ctx.companyId), meta: null };
        return rows(listProjects(dialect, ctx, query));

      case 'templates':
        return rows(dialect.prepare(
          "SELECT * FROM project_templates WHERE company_id IN (?, '*') AND is_active = 1 ORDER BY name",
        ).all(ctx.companyId));

      case 'phases':
        return rows(scopedList(dialect, ctx, 'project_phases', query, 'sequence, created_at'));

      case 'milestones':
        return rows(scopedList(dialect, ctx, 'project_milestones', query, 'due_date IS NULL, due_date'));

      case 'cost-codes':
        return rows(scopedList(dialect, ctx, 'project_cost_codes', query, 'code'));

      case 'budget':
        if (!query.project_id) return { error: 'project_id is required', status: 400 };
        return { data: projectBudgetVsActual(dialect, ctx, query.project_id), meta: null };

      case 'commitments':
        return rows(scopedList(dialect, ctx, 'project_commitments', query));

      case 'change-orders':
        return rows(scopedList(dialect, ctx, 'project_change_orders', query));

      case 'risks':
        return rows(scopedList(dialect, ctx, 'project_risks', query, 'severity DESC'));

      case 'issues':
        return rows(scopedList(dialect, ctx, 'project_issues', query));

      case 'tasks':
        if (!query.project_id) return { error: 'project_id is required', status: 400 };
        return rows(listProjectTasks(dialect, query.project_id, ctx.companyId));

      case 'effort':
        return rows(listEffort(dialect, ctx, query));

      case 'billing':
        return rows(listBillingRequests(dialect, ctx, query));

      case 'costing':
        if (!query.project_id) return { error: 'project_id is required', status: 400 };
        return { data: projectCostBreakdown(dialect, ctx, query.project_id), meta: null };

      case 'profitability':
        if (query.project_id) {
          return { data: projectProfitability(dialect, ctx, query.project_id), meta: null };
        }
        return rows(projectReport(dialect, ctx, 'profitability'));

      case 'resources':
        // Resource view: effort hours per assignee across active projects.
        return rows(dialect.prepare(`
          SELECT e.employee_ref, e.role_key, e.entry_type,
                 COUNT(*) AS entries,
                 COALESCE(SUM(e.hours), 0) AS hours,
                 COALESCE(SUM(e.total_cost), 0) AS cost
          FROM project_effort_entries e
          JOIN projects p ON p.id = e.project_id
          WHERE e.company_id = ? AND p.status = 'active'
          GROUP BY e.employee_ref, e.role_key, e.entry_type
          ORDER BY hours DESC LIMIT 200
        `).all(ctx.companyId));

      case 'reports':
        return rows(projectReport(dialect, ctx, String(query.report || 'profitability'), query));

      case 'cost-rates':
        return rows(dialect.prepare(
          "SELECT * FROM project_cost_rates WHERE company_id IN (?, '*') AND is_active = 1 ORDER BY rate_scope, rate_key",
        ).all(ctx.companyId));

      default:
        return { error: `unknown projects resource: ${resource}`, status: 404 };
    }
  } catch (error) {
    if (error && typeof error.code === 'string') {
      return { error: `${error.code}: ${error.message}`, status: error.statusCode || 422 };
    }
    throw error;
  }
}
