// 063_cutover_lineage_quarantine_and_mapping.mjs — Checkpoint I5A.
//
// Governance persistence for the legacy -> canonical cutover.
//
// These tables are NOT a second business authority. They record how a legacy
// record became a canonical record: which batch moved it, what it hashed to at
// the time, where it landed, why it was rejected, and whether the domain
// reconciled. Business facts continue to live in their canonical tables and are
// written only through canonical actions.
//
// Why lineage has to be persistent rather than a run report: a cutover that
// cannot answer "where did this canonical row come from, and what did the source
// look like when we read it" cannot be audited after the fact, and cannot prove
// idempotency on rerun. A rerun must recognise work it already did, which
// requires durable (source_collection, source_id, batch) identity.
//
// Migrations 001-062 are historical and are not edited. This is additive.
//
// Dialect: written for SQLite and PostgreSQL. No SQLite-only pragma, no
// AUTOINCREMENT, no partial index. Timestamps are TEXT ISO-8601, matching the
// convention used by every table this schema already carries.

const MODULE_ID = 'platform.kernel';
const migrationIdSelf = '063_cutover_lineage_quarantine_and_mapping';

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.42.0',
  parent: '062_warehouse_code_uniqueness',
  dependsOn: ['062_warehouse_code_uniqueness'],
  dialect: ['sqlite', 'postgres'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance:
    'Checkpoint I5A — governed legacy-to-canonical cutover requires durable batch, lineage, mapping, quarantine and reconciliation facts so a staged migration can be audited, reconciled and rerun idempotently.',

  up(db) {
    // --- Batches -----------------------------------------------------------
    // One batch per cutover attempt. `is_staged` is the flag every migrator
    // asserts before writing: a batch that is not staged cannot be executed by
    // the engine, which keeps a disposable rehearsal from being replayed
    // against an operational store by accident.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_batches (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        branch_id TEXT,
        label TEXT NOT NULL,
        source_system TEXT NOT NULL DEFAULT 'octagon_legacy_json',
        source_snapshot_hash TEXT,
        source_snapshot_manifest TEXT,
        repository_commit TEXT,
        migration_tip TEXT,
        is_staged INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'draft',
        executing_model TEXT,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        notes TEXT
      );
    `);

    // Per-domain progress inside a batch, so a partially completed cutover can
    // resume at domain granularity rather than restarting.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_batch_domains (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES cutover_batches(id),
        domain TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        source_count INTEGER NOT NULL DEFAULT 0,
        migrated_count INTEGER NOT NULL DEFAULT 0,
        merged_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        quarantined_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_batch_domain
        ON cutover_batch_domains(batch_id, domain);
    `);

    // --- Source records ----------------------------------------------------
    // What the inventory saw, with the hash it had at read time. Keeping the
    // hash lets a rerun detect that a legacy record changed underneath a
    // completed migration instead of silently re-migrating a different fact.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_source_records (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES cutover_batches(id),
        source_system TEXT NOT NULL,
        source_collection TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        source_payload TEXT,
        classification TEXT NOT NULL DEFAULT 'candidate',
        domain TEXT,
        discovered_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_source_identity
        ON cutover_source_records(batch_id, source_collection, source_id);
    `);

    // --- Lineage -----------------------------------------------------------
    // The audit answer to "where did this canonical row come from". The unique
    // index is what makes rerun idempotent: a second attempt to migrate the same
    // source record within the same batch collides instead of duplicating.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_lineage (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES cutover_batches(id),
        company_id TEXT,
        branch_id TEXT,
        source_system TEXT NOT NULL,
        source_collection TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        destination_authority TEXT NOT NULL,
        destination_table TEXT NOT NULL,
        destination_id TEXT NOT NULL,
        migration_status TEXT NOT NULL DEFAULT 'migrated',
        reconciliation_status TEXT NOT NULL DEFAULT 'pending',
        executing_model TEXT,
        actor TEXT NOT NULL,
        migrated_at TEXT NOT NULL,
        reconciled_at TEXT,
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_lineage_source
        ON cutover_lineage(batch_id, source_collection, source_id);
      CREATE INDEX IF NOT EXISTS idx_cutover_lineage_destination
        ON cutover_lineage(destination_table, destination_id);
    `);

    // --- Mapping rules -----------------------------------------------------
    // Explicit, owner-fixed translation decisions (UOM strings, location
    // authority, account/journal keys). Deliberately data rather than code: an
    // unmapped value must be quarantined, never guessed, and the registry is the
    // record of what was decided and by whom.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_mapping_rules (
        id TEXT PRIMARY KEY,
        rule_domain TEXT NOT NULL,
        source_key TEXT NOT NULL,
        source_label TEXT,
        destination_kind TEXT NOT NULL,
        destination_key TEXT NOT NULL,
        destination_label_ar TEXT,
        destination_label_en TEXT,
        factor TEXT,
        decision_reason TEXT,
        decided_by TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_mapping_identity
        ON cutover_mapping_rules(rule_domain, source_key);
    `);

    // --- Quarantine --------------------------------------------------------
    // Records deliberately NOT migrated, with the full source payload retained.
    // Quarantine is not deletion and not a silent skip: an unresolved record has
    // to remain inspectable, or reconciliation cannot explain its own counts.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_quarantine (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES cutover_batches(id),
        company_id TEXT,
        source_system TEXT NOT NULL,
        source_collection TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_hash TEXT,
        source_payload TEXT NOT NULL,
        domain TEXT,
        reason_code TEXT NOT NULL,
        reason_detail TEXT,
        severity TEXT NOT NULL DEFAULT 'blocking',
        proposed_resolution TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT,
        resolved_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_quarantine_identity
        ON cutover_quarantine(batch_id, source_collection, source_id, reason_code);
      CREATE INDEX IF NOT EXISTS idx_cutover_quarantine_reason
        ON cutover_quarantine(reason_code);
    `);

    // --- Reconciliation ----------------------------------------------------
    // Expected vs actual per domain metric. `is_blocking` with a non-zero
    // difference is what stops staged activation.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_reconciliation_results (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES cutover_batches(id),
        domain TEXT NOT NULL,
        metric TEXT NOT NULL,
        expected_value TEXT,
        actual_value TEXT,
        difference TEXT,
        status TEXT NOT NULL,
        is_blocking INTEGER NOT NULL DEFAULT 1,
        explanation TEXT,
        evaluated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_reconciliation_identity
        ON cutover_reconciliation_results(batch_id, domain, metric);
    `);

    // --- Approval gates ----------------------------------------------------
    // Owner decisions the engine must not make for itself. The opening-inventory
    // accounting date is the live example: quantities reconcile without it, but
    // no accounting entry may post until the owner supplies it.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_approval_gates (
        id TEXT PRIMARY KEY,
        batch_id TEXT REFERENCES cutover_batches(id),
        gate_key TEXT NOT NULL,
        gate_title_ar TEXT,
        gate_title_en TEXT,
        description TEXT,
        state TEXT NOT NULL DEFAULT 'pending',
        blocks TEXT,
        decided_by TEXT,
        decided_at TEXT,
        decision_value TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_gate_identity
        ON cutover_approval_gates(batch_id, gate_key);
    `);

    // --- Attempts ----------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS cutover_attempts (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES cutover_batches(id),
        action TEXT NOT NULL,
        domain TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        error_detail TEXT,
        records_affected INTEGER NOT NULL DEFAULT 0,
        executing_model TEXT,
        actor TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cutover_attempts_batch
        ON cutover_attempts(batch_id, action);
    `);

    registerModuleFacts(db);
  },

  down(db) {
    // Child-before-parent. Every table is created by this migration, so nothing
    // pre-existing is destroyed.
    db.exec(`
      DROP TABLE IF EXISTS cutover_attempts;
      DROP TABLE IF EXISTS cutover_approval_gates;
      DROP TABLE IF EXISTS cutover_reconciliation_results;
      DROP TABLE IF EXISTS cutover_quarantine;
      DROP TABLE IF EXISTS cutover_mapping_rules;
      DROP TABLE IF EXISTS cutover_lineage;
      DROP TABLE IF EXISTS cutover_source_records;
      DROP TABLE IF EXISTS cutover_batch_domains;
      DROP TABLE IF EXISTS cutover_batches;
    `);
    db.prepare('DELETE FROM platform_entities WHERE module_id = ?').run('cutover_governance');
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run('cutover_governance');
  },
};

function registerModuleFacts(db) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      version = excluded.version,
      status = excluded.status,
      capabilities = excluded.capabilities,
      migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `).run(
    'cutover_governance',
    'Cutover Governance',
    '1.0.0',
    'enabled',
    'core',
    'platform',
    JSON.stringify(['platform_kernel']),
    JSON.stringify([]),
    JSON.stringify(['CG-BATCH', 'CG-LINEAGE', 'CG-MAPPING', 'CG-QUARANTINE', 'CG-RECONCILE']),
    JSON.stringify([migrationIdSelf]),
    JSON.stringify([]),
    now,
    now
  );
}
