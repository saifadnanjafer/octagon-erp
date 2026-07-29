/**
 * Checkpoint I — I2: WAL-aware staged operational clone.
 *
 * Creates a disposable, isolated copy of the operational Octagon system so the
 * legacy->canonical cutover can be rehearsed WITHOUT touching operational data.
 *
 * Safety properties:
 * - The operational database is opened READ-ONLY. No journal-mode change, no
 *   schema write, no checkpoint is performed against it.
 * - The snapshot uses the SQLite online backup API (node:sqlite `backup`), which
 *   produces a WAL-consistent point-in-time image including committed WAL frames.
 * - Credentials, sessions, tokens and secrets are redacted from the clone.
 * - The staged database is written under temp/ with a clearly disposable name and
 *   is never committed.
 *
 * Usage:
 *   node scripts/cutover/create-staged-clone.mjs [--label <name>]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';

const REPO_ROOT = path.resolve(path.join(import.meta.dirname, '..', '..'));

const OPERATIONAL = {
  db: path.join(REPO_ROOT, 'database.db'),
  wal: path.join(REPO_ROOT, 'database.db-wal'),
  shm: path.join(REPO_ROOT, 'database.db-shm'),
  json: path.join(REPO_ROOT, 'database.json'),
};

/**
 * Tables whose contents are operational secrets. They are structurally preserved
 * (so migrations and FK constraints still work) but emptied in the clone.
 */
const REDACTED_TABLES = [
  'identity_credentials',
  'identity_sessions',
  'identity_session_events',
  'identity_login_attempts',
  'identity_api_keys',
  'identity_api_key_usage',
  'identity_password_resets',
  'identity_mfa_methods',
  'identity_sso_logins',
  'identity_federated_links',
  'identity_service_accounts',
  'secret_values',
  'secret_references',
  'secret_events',
];

function sha256(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileFacts(file) {
  if (!fs.existsSync(file)) return { present: false };
  const st = fs.statSync(file);
  return {
    present: true,
    path: file,
    sha256: sha256(file),
    bytes: st.size,
    mtime: st.mtime.toISOString(),
  };
}

function readOnly(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

function tableNames(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);
}

function countRows(db, tables) {
  const out = {};
  for (const t of tables) {
    try {
      out[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    } catch {
      out[t] = null;
    }
  }
  return out;
}

function migrationTip(db) {
  try {
    const rows = db.prepare('SELECT migration_id FROM schema_migrations').all();
    const ids = rows.map((r) => String(r.migration_id)).sort();
    return { count: ids.length, tip: ids[ids.length - 1] ?? null, applied: ids };
  } catch {
    return { count: 0, tip: null, applied: [] };
  }
}

function legacyCollectionCounts(db) {
  try {
    return db
      .prepare('SELECT collection AS k, COUNT(*) AS n FROM collections GROUP BY collection ORDER BY n DESC')
      .all()
      .reduce((acc, r) => ((acc[r.k] = r.n), acc), {});
  } catch {
    return {};
  }
}

async function main() {
  const labelIdx = process.argv.indexOf('--label');
  const label = labelIdx > -1 ? process.argv[labelIdx + 1] : 'checkpoint-i';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const stagedDir = path.join(REPO_ROOT, 'temp', 'checkpoint-i-staged', `${label}_${stamp}`);
  fs.mkdirSync(stagedDir, { recursive: true });

  const stagedDb = path.join(stagedDir, 'staged-disposable.db');
  const stagedJson = path.join(stagedDir, 'staged-database.json');

  console.log('=== CHECKPOINT I — WAL-AWARE STAGED OPERATIONAL CLONE ===');
  console.log(`staged dir: ${stagedDir}`);

  // ---- 1. Pre-snapshot operational facts (read-only) --------------------------
  console.log('\n[1] Recording operational baseline (read-only)...');
  const before = {
    db: fileFacts(OPERATIONAL.db),
    wal: fileFacts(OPERATIONAL.wal),
    shm: fileFacts(OPERATIONAL.shm),
    json: fileFacts(OPERATIONAL.json),
  };
  for (const [k, v] of Object.entries(before)) {
    console.log(`    ${k.padEnd(5)} ${v.present ? `${v.sha256.slice(0, 16)}… ${v.bytes} bytes` : 'ABSENT'}`);
  }

  const src = readOnly(OPERATIONAL.db);
  const srcTables = tableNames(src);
  const srcMig = migrationTip(src);
  const srcCounts = countRows(src, srcTables);
  const srcLegacy = legacyCollectionCounts(src);
  console.log(`    tables=${srcTables.length} migration_tip=${srcMig.tip} legacy_collections=${Object.keys(srcLegacy).length}`);

  // ---- 2. WAL-consistent snapshot via SQLite online backup API ---------------
  console.log('\n[2] Taking WAL-consistent snapshot (SQLite online backup API)...');
  await backup(src, stagedDb);
  src.close();
  console.log(`    -> ${stagedDb}`);

  // ---- 3. Verify operational store is byte-identical after snapshot ----------
  console.log('\n[3] Verifying operational store unchanged by snapshot...');
  const after = {
    db: fileFacts(OPERATIONAL.db),
    wal: fileFacts(OPERATIONAL.wal),
    shm: fileFacts(OPERATIONAL.shm),
    json: fileFacts(OPERATIONAL.json),
  };
  const drift = [];
  for (const k of Object.keys(before)) {
    if (before[k].sha256 !== after[k].sha256) drift.push(k);
  }
  if (drift.length) {
    console.log(`    !! DRIFT DETECTED in: ${drift.join(', ')}`);
  } else {
    console.log('    OK — database.db / -wal / -shm / database.json all byte-identical');
  }

  // ---- 4. Copy legacy JSON store --------------------------------------------
  console.log('\n[4] Copying legacy JSON store...');
  if (fs.existsSync(OPERATIONAL.json)) {
    fs.copyFileSync(OPERATIONAL.json, stagedJson);
    console.log(`    -> ${stagedJson}`);
  } else {
    console.log('    (database.json absent — skipped)');
  }

  // ---- 5. Redact secrets from the clone --------------------------------------
  console.log('\n[5] Redacting credentials/sessions/secrets from clone...');
  const staged = new DatabaseSync(stagedDb);
  staged.exec('PRAGMA foreign_keys = OFF;');
  const redactionReport = {};
  const stagedTables = new Set(tableNames(staged));
  for (const t of REDACTED_TABLES) {
    if (!stagedTables.has(t)) {
      redactionReport[t] = 'absent';
      continue;
    }
    const n = staged.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    staged.exec(`DELETE FROM "${t}"`);
    redactionReport[t] = `cleared ${n}`;
    if (n > 0) console.log(`    ${t}: cleared ${n} row(s)`);
  }

  // ---- 6. Mark clone as disposable / non-production ---------------------------
  console.log('\n[6] Marking clone as disposable...');
  staged.exec(`
    CREATE TABLE IF NOT EXISTS cutover_staged_fixture (
      id TEXT PRIMARY KEY,
      is_disposable INTEGER NOT NULL,
      source_label TEXT,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT,
      note TEXT
    );
  `);
  staged.prepare(`
    INSERT OR REPLACE INTO cutover_staged_fixture
      (id, is_disposable, source_label, created_at, source_db_sha256, note)
    VALUES ('staged', 1, ?, ?, ?, ?)
  `).run(
    label,
    new Date().toISOString(),
    before.db.sha256,
    'Checkpoint I disposable cutover rehearsal clone. NEVER operational. NEVER committed.'
  );

  const stagedMig = migrationTip(staged);
  const stagedTableList = tableNames(staged);
  const stagedCounts = countRows(staged, stagedTableList);
  const stagedLegacy = legacyCollectionCounts(staged);
  staged.close();

  // ---- 7. Fidelity check ------------------------------------------------------
  console.log('\n[7] Clone fidelity check...');
  const mismatches = [];
  for (const t of srcTables) {
    const expected = REDACTED_TABLES.includes(t) ? 0 : srcCounts[t];
    if (stagedCounts[t] !== expected) {
      mismatches.push({ table: t, source: srcCounts[t], staged: stagedCounts[t], expected });
    }
  }
  console.log(`    source tables : ${srcTables.length}`);
  console.log(`    staged tables : ${stagedTableList.length} (incl. cutover_staged_fixture)`);
  console.log(`    migration tip : source=${srcMig.tip} staged=${stagedMig.tip}`);
  console.log(`    unexpected row-count mismatches: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 10)) {
    console.log(`      ${m.table}: source=${m.source} staged=${m.staged} expected=${m.expected}`);
  }

  // ---- 8. Manifest ------------------------------------------------------------
  const manifest = {
    checkpoint: 'I',
    purpose: 'WAL-aware staged operational clone for legacy->canonical cutover rehearsal',
    label,
    snapshot_timestamp: new Date().toISOString(),
    mechanism: 'node:sqlite online backup API (WAL-consistent); source opened readOnly',
    operational_source: {
      before,
      after,
      unchanged: drift.length === 0,
      drift_files: drift,
    },
    staged_target: {
      dir: stagedDir,
      db: stagedDb,
      db_sha256: sha256(stagedDb),
      db_bytes: fs.statSync(stagedDb).size,
      json: fs.existsSync(stagedJson) ? stagedJson : null,
      json_sha256: fs.existsSync(stagedJson) ? sha256(stagedJson) : null,
      disposable: true,
      committed: false,
    },
    migration: {
      source_tip: srcMig.tip,
      source_count: srcMig.count,
      staged_tip: stagedMig.tip,
      staged_count: stagedMig.count,
    },
    tables: {
      source_count: srcTables.length,
      staged_count: stagedTableList.length,
      unexpected_mismatches: mismatches,
    },
    redaction: redactionReport,
    legacy_collections: {
      source: srcLegacy,
      staged: stagedLegacy,
      distinct: Object.keys(srcLegacy).length,
      total_rows: Object.values(srcLegacy).reduce((a, b) => a + b, 0),
    },
    canonical_table_counts: stagedCounts,
  };

  const manifestPath = path.join(stagedDir, 'snapshot-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n[8] Manifest -> ${manifestPath}`);

  const ok = drift.length === 0 && mismatches.length === 0 && srcMig.tip === stagedMig.tip;
  console.log(`\n=== RESULT: ${ok ? 'STAGED CLONE VERIFIED' : 'STAGED CLONE INCOMPLETE'} ===`);
  if (!ok) process.exitCode = 1;
  return manifest;
}

main().catch((err) => {
  console.error('STAGED CLONE FAILED:', err);
  process.exitCode = 1;
});
