// 061_canonical_cutover_controller.mjs — Checkpoint G.
//
// Adds the persistent state the canonical cutover controller needs:
//
//   - canonical_cutover_attempts   every status/dry-run/activate/rollback
//                                  attempt, including REFUSED ones, so a
//                                  refused activation is auditable evidence
//                                  rather than a silent no-op;
//   - canonical_cutover_approvals  the server-side approval fact required
//                                  before any *production* activation. It is
//                                  deliberately created empty: this checkpoint
//                                  activates on disposable databases only, and
//                                  an empty approvals table is what keeps
//                                  production activation fail-closed.
//
// PORTABILITY (Checkpoint G): unlike migrations 001-060 these tables are
// declared WITHOUT the SQLite-only STRICT modifier and without AUTOINCREMENT,
// using only types that carry the same meaning in PostgreSQL. New migrations
// from 061 onward are written dialect-neutral so the portability debt does not
// keep growing while the adapter is built out. See
// docs/evidence/checkpoint-g-release-closure/postgresql-adapter-and-runtime.md
//
// Migrations 001-060 are NOT edited.

const MODULE_ID = 'platform.kernel';
const migrationIdSelf = '061_canonical_cutover_controller';

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.40.0',
  parent: '060_subcontract_and_cross_domain_closure',
  dependsOn: ['060_subcontract_and_cross_domain_closure'],
  dialect: ['sqlite', 'postgres'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Checkpoint G — governed canonical cutover controller state. Closes Checkpoint F blocker C1 (no mechanism to rehearse or activate canonical cutover safely).',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_cutover_attempts (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        action TEXT NOT NULL,
        result TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        actor TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'disposable',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cutover_attempts_domain
        ON canonical_cutover_attempts(domain, created_at);

      CREATE TABLE IF NOT EXISTS canonical_cutover_approvals (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        approval_token_hash TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        rehearsal_attempt_id TEXT,
        revoked_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_cutover_approvals_domain
        ON canonical_cutover_approvals(domain);
    `);
  },

  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_cutover_approvals_domain;
      DROP TABLE IF EXISTS canonical_cutover_approvals;
      DROP INDEX IF EXISTS idx_cutover_attempts_domain;
      DROP TABLE IF EXISTS canonical_cutover_attempts;
    `);
  },
};
