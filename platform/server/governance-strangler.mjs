// Runtime governance strangler — Phase 02 final closure.
//
// Wired into server.js at the two legacy blob choke points:
//   - saveDbToSqlite(): BEFORE the legacy tables are written, every governed
//     path in the payload is synced into the canonical platform tables and
//     stripped from the blob — inside the same SQLite transaction.
//   - loadDbFromSqlite(): AFTER the blob is assembled, governed paths are
//     projected from the canonical tables so legacy client readers always see
//     the platform as the single source of truth.
//
// The strangler is active only when the platform authority initialized
// successfully. When it is absent (degraded non-SQLite mode), server.js
// strips governed paths from internal writes instead of letting them
// re-enter a legacy store (fail closed; see safeSaveDb).
//
// Compatibility reader contract (packet 02.32):
//   owner: platform.governance
//   callers: app.js loadData()/saveData(), services/auditService.js,
//     modules/scheduled-alerts.js, server-scheduler.js, WhatsApp ingest
//   canonical writer: platform/server/governance-collections.mjs domains
//   reconciliation: reconcileGovernance() row counts + runtime-strangler
//     test suite; legacy_blob_governed_rows must stay 0
//   rollback: migration 013 down() re-exports canonical rows into the legacy
//     blob tables; pre-cutover server builds resume unchanged
//   removal criterion: per-domain criteria in GOVERNED_DOMAINS

'use strict';

import {
  GOVERNED_DOMAINS,
  GOVERNED_PATHS,
  isGovernedPath,
  ensureGovernanceDefinitions,
  syncGovernanceBlob,
  projectGovernanceReads,
  stripGovernancePaths,
  reconcileGovernance,
} from './governance-collections.mjs';

export function createGovernanceStrangler(authority) {
  if (!authority || !authority.dialect) {
    throw new Error('governance strangler requires the platform authority dialect');
  }
  const dialect = authority.dialect;
  ensureGovernanceDefinitions(dialect, 'platform_bridge');

  const actorContext = (ctx) => ({
    actorId: ctx?.actorId || ctx?.userId || 'system',
    activeCompanyId: ctx?.activeCompanyId || ctx?.companyId || 'default',
    tenantId: ctx?.tenantId || 'default',
  });

  return {
    governedPaths: GOVERNED_PATHS,
    domains: GOVERNED_DOMAINS,
    isGovernedPath,

    /**
     * Called by saveDbToSqlite() INSIDE its transaction, before the legacy
     * tables are written. Syncs governed paths to the canonical tables and
     * removes them from the blob object. Returns the synced domain ids.
     */
    syncWrites(db, ctx) {
      return syncGovernanceBlob(dialect, db, actorContext(ctx));
    },

    /**
     * Called by loadDbFromSqlite() after blob assembly. Overlays canonical
     * state onto the blob so legacy readers see platform truth.
     */
    projectReads(db) {
      return projectGovernanceReads(dialect, db);
    },

    /** Degraded-mode fallback: never let governed facts re-enter a legacy store. */
    stripGoverned(db) {
      return stripGovernancePaths(db);
    },

    /** Reconciliation snapshot for diagnostics, evidence, and tests. */
    reconcile() {
      return reconcileGovernance(dialect);
    },
  };
}
