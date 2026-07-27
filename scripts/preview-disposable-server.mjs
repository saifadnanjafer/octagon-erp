// Preview launcher on a DISPOSABLE database copy.
//
// Why this exists: server.js opens database.db directly, and server.js:2573
// records that ANY second process touching that file can produce SQLITE_BUSY
// failures that surface to users as failed saves during payroll posting. A
// preview or verification server must therefore never open the operational
// database.
//
// This launcher stages a byte copy of the operational database (including its
// WAL and SHM sidecars, so no committed transaction is lost or half-applied),
// points the server at the copy via the OCTAGON_SQLITE_DB_FILE /
// OCTAGON_DB_FILE overrides, and starts the normal server unchanged.
//
// The preview therefore shows real data and is fully interactive, but nothing
// it writes can reach the operational store.
//
// Usage:
//   node scripts/preview-disposable-server.mjs
//   PORT=8090 node scripts/preview-disposable-server.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const SOURCES = {
  sqlite: path.join(repoRoot, 'database.db'),
  wal: path.join(repoRoot, 'database.db-wal'),
  shm: path.join(repoRoot, 'database.db-shm'),
  json: path.join(repoRoot, 'database.json'),
};

function sha256(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Hashes of the operational files, so drift is detectable after the run. */
function operationalFingerprint() {
  return Object.fromEntries(
    Object.entries(SOURCES).map(([key, file]) => [key, sha256(file)]),
  );
}

const before = operationalFingerprint();

const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-preview-'));
const staged = {
  sqlite: path.join(stageDir, 'database.db'),
  wal: path.join(stageDir, 'database.db-wal'),
  shm: path.join(stageDir, 'database.db-shm'),
  json: path.join(stageDir, 'database.json'),
};

// Copy the SQLite triplet together. The WAL must travel with its database or
// committed-but-not-checkpointed transactions are lost.
let copied = 0;
for (const key of ['sqlite', 'wal', 'shm', 'json']) {
  if (fs.existsSync(SOURCES[key])) {
    fs.copyFileSync(SOURCES[key], staged[key]);
    copied += 1;
  }
}

// Verify the staged SQLite copy is byte-identical to its source, so the
// preview is a faithful snapshot rather than a torn read.
const sourceHash = sha256(SOURCES.sqlite);
const stagedHash = sha256(staged.sqlite);
if (sourceHash && sourceHash !== stagedHash) {
  console.error('[preview] FATAL: staged database copy does not match source. Aborting.');
  process.exit(1);
}

// Confirm reading did not disturb the operational files.
const after = operationalFingerprint();
const drifted = Object.keys(before).filter((k) => before[k] !== after[k]);
if (drifted.length) {
  console.error(`[preview] FATAL: operational files changed while staging: ${drifted.join(', ')}. Aborting.`);
  process.exit(1);
}

process.env.OCTAGON_SQLITE_DB_FILE = staged.sqlite;
process.env.OCTAGON_DB_FILE = staged.json;
process.env.PORT = process.env.PORT || '8080';

// Optional disposable test identities, for authenticated browser acceptance.
// Only ever runs against the staged copy above — scripts/test-auth-fixture.mjs
// independently refuses any path in the repository root, so this cannot reach
// operational data even if this launcher were misused.
let fixtureManifestPath = null;
if (process.env.OCTAGON_TEST_FIXTURE === '1') {
  try {
    const { openMigrationDatabase, runMigrations } = await import('../database/migration-runner/index.mjs');
    const { seedTestIdentities, writeFixtureManifest } = await import('./test-auth-fixture.mjs');
    // The staged copy may predate the current migration set; bring it up first
    // so the identity/authorization tables the fixture writes to exist.
    await runMigrations({ dbPath: staged.sqlite, direction: 'up', actor: 'preview-fixture' });
    const seedDb = openMigrationDatabase(staged.sqlite);
    try {
      const seeded = seedTestIdentities(seedDb, { dbPath: staged.sqlite });
      fixtureManifestPath = writeFixtureManifest(path.join(stageDir, 'fixture-users.json'), seeded);
    } finally {
      seedDb.close();
    }
  } catch (error) {
    console.error(`[preview] FATAL: test fixture seeding failed: ${error && error.message}`);
    process.exit(1);
  }
}

function cleanup() {
  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
  } catch (_) {
    // Best effort: a leftover temp directory is harmless.
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

console.log('[preview] DISPOSABLE DATABASE MODE');
console.log(`[preview]   staged ${copied} file(s) -> ${stageDir}`);
console.log(`[preview]   sqlite sha256 ${String(stagedHash).slice(0, 16)}… (matches operational source)`);
console.log('[preview]   operational database.db is NOT open and cannot be written by this process');
console.log(`[preview]   port ${process.env.PORT}`);
if (fixtureManifestPath) {
  console.log('[preview]   DISPOSABLE TEST IDENTITIES SEEDED (8 roles) — throwaway, temp db only');
  console.log(`[preview]   manifest ${fixtureManifestPath}`);
}

// Start the real server unchanged. Requiring it keeps everything in one
// process so the port is owned by this PID.
createRequire(import.meta.url)(path.join(repoRoot, 'server.js'));
