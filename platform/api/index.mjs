// API router — Phase 01 foundation.
//
// Source composition:
// - VNext vnext/server/modules/r3-routes.js and module-routes.js (project-owned)
//   for thin route ownership and domain separation.
// - VNext vnext/server/crud/crud-engine.js (project-owned) for /api/x/:entity
//   route shape and envelope.
// - NocoBase resourcer.ts (clean-room reference) for resource/action semantics.
// - AureusERP API V1 (MIT reference) for versioned namespace.
// - IDURAR route discovery (clean-room reference) for consistency.
//
// Responsibilities:
//   - provide versioned API namespace (v1)
//   - expose registered query resources and command actions
//   - enforce stable error envelope and correlation ID
//   - bound pagination/filtering
//   - reject body-supplied actor/company spoofing
//   - refuse generic mutation for protected documents
//   - support idempotency-key header for commands
//   - return deprecation metadata for legacy adapters

'use strict';

import { createRepository } from '../data/repositories/index.mjs';
import { createActionExecutor } from '../kernel/actions/index.mjs';
import { handleFinanceQuery } from './finance.mjs';
import { handleCommercialQuery } from './commercial.mjs';
import { handleProjectsQuery } from './projects.mjs';
import { handleEngineeringQuery } from './engineering.mjs';
import { handleManufacturingQuery } from '../manufacturing/index.mjs';
import { handleQualityQuery } from '../quality/index.mjs';
import { handleAssetsQuery } from '../assets/index.mjs';
import { handleReturnsQuery } from '../domains/returns/returns-queries.mjs';
import { handleMaintenanceQuery } from '../maintenance/index.mjs';
import { handleFleetQuery } from '../fleet/index.mjs';
import { handleControlPlaneQuery } from '../control_plane/index.mjs';
import { handleWave2Query, WAVE2_NAMESPACES, wave2ReadPermission } from './wave2.mjs';
import { handleGovernanceQuery, GOVERNANCE_NAMESPACES } from './governance.mjs';
import { governanceReadPermission } from '../domains/governance-actions.mjs';
import { handleCollaborationQuery, COLLABORATION_NAMESPACES } from './collaboration.mjs';

export class ApiError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL') {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function envelope(data, error, meta, correlationId) {
  return { success: !error, data: error ? null : data, error: error ? String(error) : null, meta: meta || null, correlationId };
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function mountApi({ dialect, prefix = '/api/v1', resolveContext: resolveContextOption = null, authorize = null, actionExecutor = null, governanceDeps = {} }) {
  // The runtime authority passes its own executor (with finance handlers
  // registered); standalone mounts fall back to a bare kernel executor.
  const executor = actionExecutor || createActionExecutor(dialect);

  function resolveContext(req, requestUrl) {
    if (resolveContextOption) return resolveContextOption(req, requestUrl);
    const headers = req.headers || {};
    const headerUser = headers['x-user'];
    const headerCompany = headers['x-company'];
    const headerBranch = headers['x-branch'];
    const headerIdempotency = headers['x-idempotency-key'];
    const correlationId = headers['x-correlation-id'] || requestUrl.searchParams.get('correlation_id') || `corr_${Math.random().toString(36).slice(2)}`;
    return {
      userId: headerUser ? String(headerUser).slice(0, 120) : 'anonymous',
      actorType: headerUser ? 'user' : 'system',
      companyId: headerCompany ? String(headerCompany).slice(0, 120) : null,
      branchId: headerBranch ? String(headerBranch).slice(0, 120) : null,
      correlationId,
      idempotencyKey: headerIdempotency ? String(headerIdempotency).slice(0, 120) : null,
      sourceChannel: 'api',
    };
  }

  async function handleCommand(req, res, requestUrl) {
    const pathname = requestUrl.pathname;
    const segments = pathname.slice(prefix.length).split('/').filter(Boolean);
    if (segments.length < 2) {
      return sendJson(res, 404, envelope(null, 'not found', null, null));
    }
    const namespace = segments[0];
    const resource = segments[1];
    const recordId = segments[2];
    const ctx = resolveContext(req, requestUrl);
    if (!ctx) return sendJson(res, 401, envelope(null, 'Login session required', null, null));

    const requirePermission = (permission) => {
      if (!authorize) return true;
      const decision = authorize({ permission, ctx, req, requestUrl });
      if (decision === true || decision?.allowed) return true;
      sendJson(res, decision?.statusCode || 403, envelope(null, decision?.message || 'Permission denied', null, ctx.correlationId));
      return false;
    };

    try {
      if (namespace === 'meta' && resource === 'entities' && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const rows = dialect.prepare('SELECT id, label_ar, label_en, module_id, lifecycle_policy FROM platform_entities ORDER BY id').all();
        return sendJson(res, 200, envelope(rows, null, { total: rows.length }, ctx.correlationId));
      }

      if (namespace === 'x' && resource) {
        const entityId = resource;
        const repo = createRepository(dialect, entityId);
        if (req.method === 'GET' && !recordId) {
          if (!requirePermission('platform:db:read')) return;
          const query = Object.fromEntries(requestUrl.searchParams.entries());
          const { items, meta } = repo.list(query, ctx);
          return sendJson(res, 200, envelope(items, null, meta, ctx.correlationId));
        }
        if (req.method === 'GET' && recordId) {
          if (!requirePermission('platform:db:read')) return;
          const doc = repo.read(recordId, ctx);
          if (!doc) return sendJson(res, 404, envelope(null, 'record not found', null, ctx.correlationId));
          return sendJson(res, 200, envelope(doc, null, null, ctx.correlationId));
        }
        if (req.method === 'POST' && !recordId) {
          if (!requirePermission('platform:db:write')) return;
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) : {};
          const doc = repo.create(body, ctx);
          return sendJson(res, 201, envelope(doc, null, null, ctx.correlationId));
        }
        if (req.method === 'PATCH' && recordId) {
          if (!requirePermission('platform:db:write')) return;
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) : {};
          const doc = repo.update(recordId, body, ctx);
          if (!doc) return sendJson(res, 404, envelope(null, 'record not found', null, ctx.correlationId));
          return sendJson(res, 200, envelope(doc, null, null, ctx.correlationId));
        }
        if (req.method === 'DELETE' && recordId) {
          if (!requirePermission('platform:db:write')) return;
          const doc = repo.delete(recordId, ctx);
          if (!doc) return sendJson(res, 404, envelope(null, 'record not found', null, ctx.correlationId));
          return sendJson(res, 200, envelope({ id: doc.id, removed: 1 }, null, null, ctx.correlationId));
        }
        return sendJson(res, 405, envelope(null, 'method not allowed', null, ctx.correlationId));
      }

      if (namespace === 'finance' && resource && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const financeResult = handleFinanceQuery({ dialect, ctx, resource, recordId, query });
        if (financeResult.error) return sendJson(res, financeResult.status || 404, envelope(null, financeResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(financeResult.data, null, financeResult.meta, ctx.correlationId));
      }

      if (namespace === 'projects' && resource && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const projectsResult = handleProjectsQuery({ dialect, ctx, resource, recordId, query });
        if (projectsResult.error) return sendJson(res, projectsResult.status || 404, envelope(null, projectsResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(projectsResult.data, null, projectsResult.meta, ctx.correlationId));
      }

      if (['engineering', 'boms', 'routings', 'work-centers', 'mrp'].includes(namespace) && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const engResult = handleEngineeringQuery({ dialect, ctx, namespace, resource, recordId, query });
        if (engResult.error) return sendJson(res, engResult.status || 404, envelope(null, engResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(engResult.data, null, engResult.meta, ctx.correlationId));
      }

      if (['manufacturing', 'production-orders', 'work-orders', 'shop-floor'].includes(namespace) && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const mfgResult = handleManufacturingQuery({ dialect, ctx, resource: resource || namespace, recordId, query });
        if (mfgResult.error) return sendJson(res, mfgResult.status || 404, envelope(null, mfgResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(mfgResult.data, null, mfgResult.meta, ctx.correlationId));
      }

      if (namespace === 'quality' && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const qResult = handleQualityQuery({ dialect, ctx, resource, recordId, query });
        if (qResult.error) return sendJson(res, qResult.status || 404, envelope(null, qResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(qResult.data, null, qResult.meta, ctx.correlationId));
      }

      if (namespace === 'assets' && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const astResult = handleAssetsQuery({ dialect, ctx, resource, recordId, query });
        if (astResult.error) return sendJson(res, astResult.status || 404, envelope(null, astResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(astResult.data, null, astResult.meta, ctx.correlationId));
      }

      if (namespace === 'returns' && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const retResult = handleReturnsQuery({ dialect, ctx, resource, recordId, query });
        if (retResult.error) return sendJson(res, retResult.status || 404, envelope(null, retResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(retResult.data, null, retResult.meta, ctx.correlationId));
      }

      if (namespace === 'maintenance' && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const mntResult = handleMaintenanceQuery({ dialect, ctx, resource, recordId, query });
        if (mntResult.error) return sendJson(res, mntResult.status || 404, envelope(null, mntResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(mntResult.data, null, mntResult.meta, ctx.correlationId));
      }

      if (namespace === 'fleet' && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const fltResult = handleFleetQuery({ dialect, ctx, resource, recordId, query });
        if (fltResult.error) return sendJson(res, fltResult.status || 404, envelope(null, fltResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(fltResult.data, null, fltResult.meta, ctx.correlationId));
      }

      if (namespace === 'control-plane' && resource && req.method === 'GET') {
        if (!requirePermission('control:admin')) return;
        const controlResult = handleControlPlaneQuery({ dialect, ctx, resource, recordId });
        if (controlResult.error) return sendJson(res, controlResult.status || 404, envelope(null, controlResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(controlResult.data, null, { total: Array.isArray(controlResult.data) ? controlResult.data.length : 1 }, ctx.correlationId));
      }

      if (['crm', 'commercial', 'inventory', 'sales', 'procurement', 'pos', 'work-items', 'work_items', 'parties', 'products', 'uoms', 'warehouses', 'locations', 'quants', 'balances', 'sales-orders', 'purchase-orders'].includes(namespace) && req.method === 'GET') {
        if (!requirePermission(namespace === 'crm' ? 'perm_crm_read' : 'platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const commercialResult = handleCommercialQuery({ dialect, ctx, namespace, resource, recordId, query });
        if (commercialResult.error) return sendJson(res, commercialResult.status || 404, envelope(null, commercialResult.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(commercialResult.data, null, commercialResult.meta, ctx.correlationId));
      }

      // FP-2 Control Plane — governed reads for workflow/approvals/automation/
      // policy/permissions. Same whitelist discipline as Wave 2 below: table,
      // filters and scope come from the handler, never the request.
      if (GOVERNANCE_NAMESPACES.includes(namespace) && req.method === 'GET') {
        const readPermission = governanceReadPermission(namespace);
        if (!requirePermission('platform:db:read')) return;
        if (readPermission && !requirePermission(readPermission)) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const gov = handleGovernanceQuery({ dialect, ctx, deps: governanceDeps, namespace, resource, recordId, query });
        if (gov.error) return sendJson(res, gov.status || 404, envelope(null, gov.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(gov.data, null, gov.meta, ctx.correlationId));
      }

      // Final Page Catalog — governed reads for the 16 Wave 2 domains.
      // Table, columns, filters and ORDER BY all come from the static registry
      // in platform/domains/wave2-registry.mjs; the caller supplies only values.
      // Company scope is ctx.companyId, never a request field.
      if (WAVE2_NAMESPACES.includes(namespace) && req.method === 'GET') {
        const readPermission = wave2ReadPermission(namespace);
        // Both gates apply: the platform read grant AND the module's own view
        // permission. A user with generic read access still cannot read a
        // module they are not entitled to.
        if (!requirePermission('platform:db:read')) return;
        if (readPermission && !requirePermission(readPermission)) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const w2 = handleWave2Query({ dialect, ctx, namespace, resource, recordId, query });
        if (w2.error) return sendJson(res, w2.status || 404, envelope(null, w2.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(w2.data, null, w2.meta, ctx.correlationId));
      }

      if (COLLABORATION_NAMESPACES.includes(namespace) && req.method === 'GET') {
        if (!requirePermission('platform:db:read')) return;
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const result = handleCollaborationQuery({ dialect, ctx, deps: governanceDeps, namespace, resource, recordId, query });
        if (result.error) return sendJson(res, result.status || 404, envelope(null, result.error, null, ctx.correlationId));
        return sendJson(res, 200, envelope(result.data, null, result.meta, ctx.correlationId));
      }

      if (namespace === 'action' && resource && req.method === 'POST') {
        if (!requirePermission('platform:db:write')) return;
        // Governed actions declare their own required permission in
        // platform_actions; evaluate it so HTTP dispatch honors the same
        // contract as the runtime authority. No-op when authorize is unset.
        const actionPermission = dialect.prepare('SELECT required_permission FROM platform_actions WHERE id = ?').get(resource);
        if (actionPermission?.required_permission && !requirePermission(actionPermission.required_permission)) return;
        const actionId = resource;
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        if (ctx.idempotencyKey) body.idempotency_key = ctx.idempotencyKey;
        try {
          const result = executor.execute(actionId, body, ctx);
          return sendJson(res, 200, envelope(result, null, null, ctx.correlationId));
        } catch (actionError) {
          // Governed business-rule denials (FinanceError with a machine code)
          // must surface as 4xx with the code intact, not a masked 500, so
          // denial evidence (period locks, authority limits, cashbox caps) is
          // distinguishable from server faults.
          if (actionError && typeof actionError.code === "string" && actionError.code) {
            const denial = /AUTHORITY|PERMISSION|NO_GRANT|DENIED|MODULE_NOT_ENABLED|MODULE_UNLICENSED/.test(actionError.code);
            return sendJson(
              res,
              actionError.statusCode || (denial ? 403 : 422),
              envelope(null, actionError.code + ": " + actionError.message, null, ctx.correlationId),
            );
          }
          throw actionError;
        }
      }

      return sendJson(res, 404, envelope(null, 'unknown route', null, ctx.correlationId));
    } catch (error) {
      const status = error.statusCode || (error.code === 'PROTECTED_ENTITY_MUTATION' ? 403 : 500);
      const safeMessage = error.statusCode || error.code === 'PROTECTED_ENTITY_MUTATION' ? error.message : 'internal error';
      return sendJson(res, status, envelope(null, safeMessage, null, ctx.correlationId));
    }
  }

  return {
    handle(req, res, requestUrl) {
      const pathname = requestUrl.pathname;
      if (!pathname.startsWith(prefix + '/')) return false;
      handleCommand(req, res, requestUrl).catch((error) => {
        sendJson(res, 500, envelope(null, 'internal error', null, null));
      });
      return true;
    },
  };
}

export function createApiHandler(options) {
  return mountApi(options).handle;
}
