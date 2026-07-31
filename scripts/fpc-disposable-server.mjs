#!/usr/bin/env node
// scripts/fpc-disposable-server.mjs
//
// Final Page Catalog — disposable verification launcher.
//
// §2 of the wave brief: "Every launcher must resolve real paths and refuse when
// they alias operational paths." This is that launcher.
//
// It starts the Octagon server against a THROWAWAY database on a THROWAWAY
// port, and refuses to start at all if the resolved database path is — or
// resolves through a link to — the operational database. There is no flag to
// override the refusal.
//
// Usage:
//   node scripts/fpc-disposable-server.mjs [--port 8137] [--db <path>]
//
// Defaults: port 8137, database <os.tmpdir()>/octagon-fpc-verify/database.db

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Databases this launcher must never open.
 *
 * The operational database lives in the Telegram-bot worktree next to this one.
 * A relative path, a symlink, or a `..` traversal must not be able to reach it,
 * so every candidate is compared after fs.realpathSync resolution.
 */
function forbiddenPaths() {
  const siblings = ['octagon-erp', 'octagon-erp-commercial-vnext'];
  const parent = path.resolve(ROOT, '..');
  const list = siblings.map((name) => path.join(parent, name, 'database.db'));
  // Also refuse this worktree's own database.db: verification must not leave a
  // stateful artifact behind in the repository.
  list.push(path.join(ROOT, 'database.db'));
  return list;
}

/** Resolve as far as the filesystem allows; a missing file resolves its parent. */
function resolveReal(target) {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync(absolute);
  } catch (_) {
    try {
      return path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
    } catch (_2) {
      return absolute;
    }
  }
}

function assertDisposable(dbPath) {
  const resolved = resolveReal(dbPath);
  for (const forbidden of forbiddenPaths()) {
    const forbiddenResolved = resolveReal(forbidden);
    if (resolved.toLowerCase() === forbiddenResolved.toLowerCase()) {
      console.error('REFUSED: the requested database aliases an operational path.');
      console.error(`  requested : ${dbPath}`);
      console.error(`  resolves  : ${resolved}`);
      console.error(`  forbidden : ${forbiddenResolved}`);
      console.error('This launcher only starts against a disposable database.');
      process.exit(2);
    }
  }
  return resolved;
}

function arg(name, fallback) {
  const at = process.argv.indexOf(name);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const port = String(arg('--port', '8137'));
const requestedDb = arg('--db', path.join(os.tmpdir(), 'octagon-fpc-verify', 'database.db'));
const dbPath = assertDisposable(requestedDb);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Provision the disposable database.
//
// server.js only mounts /api/v1 when SQLite is live, and SQLite is only live
// when the database has actually been migrated. An empty file leaves the server
// in degraded JSON mode, every /api/v1 route 404s, and the pages then report
// backend_failure — which looks like a page defect but is really an
// unprovisioned fixture. Migrate up front so verification exercises the real
// governed API.
if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) {
  console.log('  provisioning disposable database (running migrations)…');
  const { freshInstall } = await import(
    new URL('../database/migration-runner/index.mjs', import.meta.url).href
  );
  await freshInstall({ dbPath });
  console.log('  provisioned.');
}

console.log('Octagon — Final Page Catalog disposable verification server');
console.log(`  database : ${dbPath}   (disposable, verified not operational)`);
console.log(`  port     : ${port}`);
console.log('  operational database: NOT opened');

const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port,
    OCTAGON_SQLITE_DB_FILE: dbPath,
    // No fallback ports: if the chosen port is taken, fail loudly rather than
    // silently landing on a port another process (possibly the operational
    // server) is using.
    OCTAGON_FALLBACK_PORTS: '',
    OCTAGON_REVIEW_REPORT_DIR: path.join(os.tmpdir(), 'octagon-fpc-verify', 'review-reports'),
  },
});

child.on('exit', (code) => process.exit(code === null ? 1 : code));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
