// 062_warehouse_code_uniqueness.mjs — Checkpoint G.
//
// DEFECT FOUND BY THE MULTI-PROCESS CONCURRENCY SUITE.
//
// Four concurrent processes each created a warehouse with code 'RACEWH' and all
// four succeeded. The follow-up probe showed this is NOT a race: creating two
// warehouses with the same code *sequentially* also succeeds. `warehouses`
// carried only its primary-key autoindex — there was no uniqueness constraint
// on the business identifier at all.
//
// This matters beyond tidiness. Warehouse code is the human-facing identifier
// used in lookups, transfers and reporting; duplicates silently split a
// location's stock across two records that look identical to an operator.
// Product SKU is already protected (a duplicate SKU is rejected), so this was a
// targeted gap rather than a systemic one.
//
// FAIL-CLOSED ON EXISTING DUPLICATES. If an installation already contains
// duplicate warehouse codes this migration throws with an actionable message
// rather than silently skipping the constraint or picking a winner and deleting
// data. A fresh install has no duplicates and applies cleanly. Resolving real
// duplicates is an owner decision about real stock, not something a migration
// may decide.
//
// Migrations 001-060 are NOT edited. Written dialect-neutral: a partial-free
// UNIQUE INDEX over two columns is valid in both SQLite and PostgreSQL.

const MODULE_ID = 'platform.kernel';
const migrationIdSelf = '062_warehouse_code_uniqueness';

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.41.0',
  parent: '061_canonical_cutover_controller',
  dependsOn: ['061_canonical_cutover_controller'],
  dialect: ['sqlite', 'postgres'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Checkpoint G — duplicate warehouse codes observed under multi-process contention and reproduced sequentially; warehouses had no uniqueness constraint on (company_id, code).',

  up(db) {
    const duplicates = db.prepare(`
      SELECT company_id, code, COUNT(*) AS n
      FROM warehouses
      WHERE code IS NOT NULL AND code != ''
      GROUP BY company_id, code
      HAVING COUNT(*) > 1
    `).all();

    if (duplicates.length > 0) {
      const detail = duplicates
        .map((d) => `company=${d.company_id} code=${d.code} (${d.n} rows)`)
        .join('; ');
      throw new Error(
        `062_warehouse_code_uniqueness: cannot add the unique constraint because duplicate warehouse codes already exist: ${detail}. ` +
        'Resolve these duplicates (merge or re-code the warehouses, moving stock deliberately) and re-run the migration. ' +
        'This migration will not choose a winner or delete stock-bearing records.',
      );
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_company_code
        ON warehouses(company_id, code);
    `);
  },

  down(db) {
    db.exec('DROP INDEX IF EXISTS idx_warehouses_company_code;');
  },
};
