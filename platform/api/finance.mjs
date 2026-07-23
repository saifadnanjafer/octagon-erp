// Finance query surface — Phase 03 closure repair.
//
// The closure audit (docs/evidence/phase-03/closure-claim-diff-audit.md, finding 6)
// found that docs cited this module and its routes but no canonical finance read
// surface existed over HTTP. This module provides the minimal read side of the
// governed finance runtime; all mutations stay on POST /api/v1/action/:actionId.
//
// Reads are thin projections over platform/finance/engine.mjs and inherit the
// engine's server-derived company scoping (context(ctx) requires companyId).
// Authorization (platform:db:read, same as other v1 reads) is enforced by the
// caller in platform/api/index.mjs before dispatch reaches this module.
//
// Results are plain { data, meta } / { error, status } objects (no thrown
// statusCode errors) so the router's error envelope stays accurate.

'use strict';

import { listAccounts, listDocuments, getDocument, getTrialBalance } from '../finance/engine.mjs';

/**
 * Dispatch a GET /api/v1/finance/:resource[/:id] query.
 * Returns { data, meta } on success or { error, status } for unknown resources
 * and missing records.
 */
export function handleFinanceQuery({ dialect, ctx, resource, recordId = null, query = {} }) {
  if (resource === 'accounts' && !recordId) {
    const rows = listAccounts(dialect, ctx);
    return { data: rows, meta: { total: rows.length } };
  }
  if (resource === 'documents' && !recordId) {
    const rows = listDocuments(dialect, ctx, { limit: query.limit });
    return { data: rows, meta: { total: rows.length } };
  }
  if (resource === 'documents' && recordId) {
    const doc = getDocument(dialect, ctx.companyId, recordId);
    if (!doc) return { error: 'document not found', status: 404 };
    return { data: doc, meta: null };
  }
  if (resource === 'trial-balance' && !recordId) {
    const rows = getTrialBalance(dialect, ctx, { start_date: query.start_date, end_date: query.end_date });
    return { data: rows, meta: { total: rows.length } };
  }
  return { error: 'unknown finance resource', status: 404 };
}
