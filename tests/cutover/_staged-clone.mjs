// Shared staged-clone helper for the cutover test suite.
//
// WHY THIS EXISTS
// ---------------
// Every cutover test previously began with:
//
//     const opDb = new SqliteDialect().open('database.db');
//     opDb.backup('database.db', tmpDb);
//
// `SqliteDialect.open()` executes `PRAGMA journal_mode = WAL` and opens the file
// READ-WRITE. Running the suite therefore wrote to the OPERATIONAL database on
// every invocation: the journal-mode toggle plus the checkpoint-on-close rewrote
// the file header and changed its hash. No business data was altered, but the
// standing rule is that the operational database is strictly read-only, and a
// test suite must never be the thing that breaks it.
//
// This helper takes a WAL-consistent snapshot through a strictly read-only
// connection, using the SQLite online backup API. A read-only connection cannot
// change journal mode, cannot checkpoint, and cannot write the header.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';

const REPO_ROOT = path.resolve(path.join(import.meta.dirname, '..', '..'));
const OPERATIONAL_DB = path.join(REPO_ROOT, 'database.db');

export function operationalHash() {
  return fs.existsSync(OPERATIONAL_DB)
    ? crypto.createHash('sha256').update(fs.readFileSync(OPERATIONAL_DB)).digest('hex')
    : null;
}

/**
 * Create a disposable staged clone of the operational database.
 *
 * The source is opened READ-ONLY. Returns the clone path; the caller owns
 * cleanup. Also stamps the disposable-fixture marker so the startup migration
 * policy and the cutover safety guards recognise the clone as staged.
 */
export async function createStagedTestClone(label = 'cutover') {
  const clonePath = path.join(os.tmpdir(), `octagon-staged-${label}-${Date.now()}-${process.pid}.db`);
  if (fs.existsSync(clonePath)) fs.unlinkSync(clonePath);

  const before = operationalHash();

  const src = new DatabaseSync(OPERATIONAL_DB, { readOnly: true });
  try {
    await backup(src, clonePath);
  } finally {
    src.close();
  }

  // A read-only connection must not have altered the source. Assert it rather
  // than trust it — this is the regression that motivated the helper.
  const after = operationalHash();
  if (before !== after) {
    throw new Error(
      `Staged clone mutated the operational database (${before} -> ${after}). ` +
        'The snapshot must be strictly read-only.'
    );
  }

  const marker = new DatabaseSync(clonePath);
  try {
    marker.exec(`CREATE TABLE IF NOT EXISTS cutover_staged_fixture (
      id TEXT PRIMARY KEY, is_disposable INTEGER NOT NULL, source_label TEXT,
      created_at TEXT NOT NULL, source_db_sha256 TEXT, note TEXT);`);
    marker.prepare(
      `INSERT OR REPLACE INTO cutover_staged_fixture
         (id, is_disposable, source_label, created_at, source_db_sha256, note)
       VALUES ('staged', 1, ?, ?, ?, ?)`
    ).run(label, new Date().toISOString(), before, 'Disposable cutover test clone. Never operational.');
  } finally {
    marker.close();
  }

  return clonePath;
}

export function disposeStagedTestClone(clonePath) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = clonePath + suffix;
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // best effort
    }
  }
}
