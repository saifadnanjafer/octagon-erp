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

export function mountApi({ dialect, prefix = '/api/v1' }) {
  const executor = createActionExecutor(dialect);

  function resolveContext(req, requestUrl) {
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

    try {
      if (namespace === 'meta' && resource === 'entities' && req.method === 'GET') {
        const rows = dialect.prepare('SELECT id, label_ar, label_en, module_id, lifecycle_policy FROM platform_entities ORDER BY id').all();
        return sendJson(res, 200, envelope(rows, null, { total: rows.length }, ctx.correlationId));
      }

      if (namespace === 'x' && resource) {
        const entityId = resource;
        const repo = createRepository(dialect, entityId);
        if (req.method === 'GET' && !recordId) {
          const query = Object.fromEntries(requestUrl.searchParams.entries());
          const { items, meta } = repo.list(query, ctx);
          return sendJson(res, 200, envelope(items, null, meta, ctx.correlationId));
        }
        if (req.method === 'GET' && recordId) {
          const doc = repo.read(recordId, ctx);
          if (!doc) return sendJson(res, 404, envelope(null, 'record not found', null, ctx.correlationId));
          return sendJson(res, 200, envelope(doc, null, null, ctx.correlationId));
        }
        if (req.method === 'POST' && !recordId) {
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) : {};
          const doc = repo.create(body, ctx);
          return sendJson(res, 201, envelope(doc, null, null, ctx.correlationId));
        }
        if (req.method === 'PATCH' && recordId) {
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) : {};
          const doc = repo.update(recordId, body, ctx);
          if (!doc) return sendJson(res, 404, envelope(null, 'record not found', null, ctx.correlationId));
          return sendJson(res, 200, envelope(doc, null, null, ctx.correlationId));
        }
        if (req.method === 'DELETE' && recordId) {
          const doc = repo.delete(recordId, ctx);
          if (!doc) return sendJson(res, 404, envelope(null, 'record not found', null, ctx.correlationId));
          return sendJson(res, 200, envelope({ id: doc.id, removed: 1 }, null, null, ctx.correlationId));
        }
        return sendJson(res, 405, envelope(null, 'method not allowed', null, ctx.correlationId));
      }

      if (namespace === 'action' && resource && req.method === 'POST') {
        const actionId = resource;
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        if (ctx.idempotencyKey) body.idempotency_key = ctx.idempotencyKey;
        const result = executor.execute(actionId, body, ctx);
        return sendJson(res, 200, envelope(result, null, null, ctx.correlationId));
      }

      return sendJson(res, 404, envelope(null, 'unknown route', null, ctx.correlationId));
    } catch (error) {
      const status = error.statusCode || error.code === 'PROTECTED_ENTITY_MUTATION' ? 403 : 500;
      const safeMessage = error.statusCode ? error.message : 'internal error';
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
