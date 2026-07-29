/**
 * Disposable server launcher for proving health-only mode in a browser.
 *
 * Boots the REAL Octagon server against an isolated, behind-tip fixture on an
 * isolated port. The database paths are set here rather than in launch.json so
 * they cannot be silently dropped — if the environment were ignored the server
 * would attach to the live database, which is the dual-server hazard this file
 * exists to avoid.
 *
 * Refuses to run unless the target fixture exists and is NOT the operational
 * database.
 *
 * Usage: node scripts/health-only-proof-server.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO_ROOT = path.resolve(path.join(import.meta.dirname, '..'));
const FIXTURE_DIR = path.join(REPO_ROOT, 'temp', 'health-only-proof');
const FIXTURE_DB = path.join(FIXTURE_DIR, 'database.db');
const FIXTURE_JSON = path.join(FIXTURE_DIR, 'database.json');

const OPERATIONAL_DB = path.join(REPO_ROOT, 'database.db');

if (path.resolve(FIXTURE_DB) === path.resolve(OPERATIONAL_DB)) {
  console.error('REFUSED: fixture path resolves to the operational database.');
  process.exit(1);
}
if (!fs.existsSync(FIXTURE_DB)) {
  console.error(`REFUSED: fixture not found at ${FIXTURE_DB}. Build it first.`);
  process.exit(1);
}

process.env.OCTAGON_SQLITE_DB_FILE = FIXTURE_DB;
process.env.OCTAGON_DB_FILE = FIXTURE_JSON;
process.env.PORT = process.env.PORT || '8099';
process.env.OCTAGON_FALLBACK_PORTS = '8099';

console.log('=== HEALTH-ONLY PROOF SERVER (disposable fixture) ===');
console.log('sqlite :', process.env.OCTAGON_SQLITE_DB_FILE);
console.log('json   :', process.env.OCTAGON_DB_FILE);
console.log('port   :', process.env.PORT);

createRequire(import.meta.url)(path.join(REPO_ROOT, 'server.js'));
