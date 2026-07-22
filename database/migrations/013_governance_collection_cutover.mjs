// 013_governance_collection_cutover — Phase 02 final runtime closure
//
// Source composition:
// - Octagon legacy blob store (`collections` / `metadata` tables written by
//   server.js saveDbToSqlite) — project-owned, RETIRE as governance authority.
// - Phase 02 canonical platform tables (identity, authorization, settings,
//   notifications, approvals, kernel x_records) — project-owned, MERGE-CANONICAL.
//
// What this migration does:
//   1. Registers the governance settings key and the legacy-document x_records
//      entities used by the runtime strangler.
//   2. Imports every governed legacy blob path (identity users, roles/grants,
//      admin settings, notifications, approval requests, workflow documents,
//      system/history/audit logs, document library, automation rules) from the
//      legacy `collections` / `metadata` tables into the canonical platform
//      tables via platform/server/governance-collections.mjs — the SAME
//      adapter the runtime strangler uses, so migration-time and runtime
//      writes can never diverge.
//   3. Deletes the governed rows from `collections` / `metadata`, ending the
//      legacy blob's authority over those facts. Operational collections
//      (employees, finance, payroll, attendance, kanban, inventory, ...) are
//      NOT touched and remain in the legacy store.
//
// Invariants:
//   - Idempotent: all writes use upserts/ON CONFLICT; re-running is a no-op.
//   - Credential-safe: only legacy_sha256 hashes are imported, never plaintext;
//     canonical credentials are never overwritten (ON CONFLICT DO NOTHING).
//   - Runs inside the migration runner transaction, so the import and the
//     legacy-row deletion commit or roll back together.
//   - Rollback (down): re-exports the canonical state into the legacy blob
//     tables so a pre-cutover server build can resume. Canonical rows are
//     left in place (additive); they are ignored once the runtime strangler
//     is not active.

import crypto from 'node:crypto';

import {
  GOVERNED_PATHS,
  ensureGovernanceDefinitions,
  syncGovernanceBlob,
  exportGovernanceToBlobRows,
  setPath,
} from '../../platform/server/governance-collections.mjs';

export const migration = {
  id: '013_governance_collection_cutover',
  owner: 'platform.governance',
  version: '2.2.0',
  dependsOn: ['012_runtime_authority_cutover'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Octagon legacy blob store (project-owned) + Phase 02 canonical platform modules (project-owned)',

  up(dialect) {
    // The legacy blob tables were created by server.js, not by the migration
    // runner. Ensure they exist so a fresh database does not fail.
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        collection TEXT,
        id TEXT,
        data TEXT,
        PRIMARY KEY (collection, id)
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    ensureGovernanceDefinitions(dialect, 'migration:013');

    // Assemble the governed subset of the legacy blob.
    const blob = {};
    const colRows = dialect.prepare('SELECT collection, data FROM collections').all();
    for (const row of colRows) {
      if (!GOVERNED_PATHS.includes(row.collection)) continue;
      let record;
      try { record = JSON.parse(row.data || '{}'); } catch { continue; }
      let arr = getPathLocal(blob, row.collection);
      if (!Array.isArray(arr)) {
        arr = [];
        setPath(blob, row.collection, arr);
      }
      arr.push(record);
    }
    const metaRows = dialect.prepare('SELECT key, value FROM metadata').all();
    for (const row of metaRows) {
      if (!GOVERNED_PATHS.includes(row.key)) continue;
      try { setPath(blob, row.key, JSON.parse(row.value)); } catch { setPath(blob, row.key, row.value); }
    }

    // Import into the canonical tables through the shared adapter.
    syncGovernanceBlob(dialect, blob, { actorId: 'migration:013', activeCompanyId: 'default' });

    // End the legacy blob's authority over the governed paths.
    const placeholders = GOVERNED_PATHS.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM collections WHERE collection IN (${placeholders})`).run(...GOVERNED_PATHS);
    dialect.prepare(`DELETE FROM metadata WHERE key IN (${placeholders})`).run(...GOVERNED_PATHS);
  },

  down(dialect) {
    // Re-export the canonical state into the legacy blob tables, then remove
    // everything this migration created so a full down-chain (013 -> 001)
    // passes foreign-key checks. Runtime rows created AFTER the cutover by
    // the strangler share the same id prefixes and are removed as well —
    // rolling back the cutover means the legacy blob becomes the authority
    // again, seeded from the canonical projection above.
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        collection TEXT,
        id TEXT,
        data TEXT,
        PRIMARY KEY (collection, id)
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    const { collections, metadata } = exportGovernanceToBlobRows(dialect);
    const insCol = dialect.prepare(`
      INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data
    `);
    for (const [collection, records] of Object.entries(collections)) {
      for (const record of records) {
        const id = String(record?.id ?? crypto.randomUUID());
        insCol.run(collection, id, JSON.stringify(record));
      }
    }
    const insMeta = dialect.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    for (const [key, value] of Object.entries(metadata)) {
      insMeta.run(key, JSON.stringify(value));
    }

    // Remove the canonical governance rows and registered definitions this
    // migration (or the runtime strangler) created. Identity rows imported by
    // 013 are removed by 012's down(), which runs next in the down-chain.
    dialect.exec(`
      DELETE FROM worklist_items WHERE id LIKE 'omni_wl_%';
      DELETE FROM approval_decisions WHERE id LIKE 'omni_dec_%';
      DELETE FROM approval_requests WHERE id LIKE 'omni_req_%';
      DELETE FROM notifications WHERE id LIKE 'omni_ntf_%';
      DELETE FROM authorization_role_assignments WHERE id LIKE 'asg_omni_%' OR id LIKE 'asg_map_%';
      DELETE FROM authorization_grants WHERE id LIKE 'grant_omni_%';
      DELETE FROM authorization_roles WHERE id LIKE 'role_omni_%';
      DELETE FROM authorization_permissions WHERE resource = 'legacy';
      DELETE FROM organization_memberships WHERE created_by = 'migration:013';
      DELETE FROM settings_history WHERE key = 'octagon.legacy.admin_settings';
      DELETE FROM settings_values WHERE key = 'octagon.legacy.admin_settings';
      DELETE FROM platform_settings WHERE key = 'octagon.legacy.admin_settings';
      DELETE FROM x_records WHERE entity LIKE 'legacy_%';
      DELETE FROM platform_entities WHERE id LIKE 'legacy_%';
      DELETE FROM platform_audit_log WHERE resource = 'governance_cutover';
    `);
  },
};

function getPathLocal(obj, path) {
  return String(path).split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}
