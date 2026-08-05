#!/usr/bin/env node
// Review Freeze 2 — verify the disposable review environment is sane.
//
// Checks: database presence, migration tip fully applied, required review
// identities exist, required fixtures exist, no operational database path
// is active in the current environment. Exits non-zero on any failure.
//
// Usage: node scripts/review/verify.mjs   (or: npm run review:verify)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrationStatus, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { REVIEW_ROLES, REVIEW_TENANT, ISOLATION_TENANT } from './roles.mjs';
import { REVIEW_PASSWORD, REVIEW_TAG, REVIEW_URL } from './identities.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const reviewDbPath = path.join(repoRoot, '.review-data', 'octagon-review.db');
const manifestPath = path.join(repoRoot, '.review-data', 'review-credentials.json');
const summaryPath = path.join(repoRoot, '.review-data', 'fixture-summary.json');

const failures = [];
const ok = (label) => console.log(`[review:verify]   OK   ${label}`);
const fail = (label, detail) => { failures.push(label); console.error(`[review:verify]   FAIL ${label}${detail ? ` — ${detail}` : ''}`); };

async function main() {
  console.log('[review:verify] checking disposable review environment…');

  // 1. Operational paths must never be active in this process's env.
  const opDb = path.join(repoRoot, 'database.db');
  const opJson = path.join(repoRoot, 'database.json');
  const activeSqlite = process.env.OCTAGON_SQLITE_DB_FILE ? path.resolve(process.env.OCTAGON_SQLITE_DB_FILE) : null;
  const activeJson = process.env.OCTAGON_DB_FILE ? path.resolve(process.env.OCTAGON_DB_FILE) : null;
  if (activeSqlite === opDb || activeJson === opJson) {
    fail('operational database path must not be active', `OCTAGON_SQLITE_DB_FILE=${activeSqlite} OCTAGON_DB_FILE=${activeJson}`);
  } else {
    ok('no operational database path active in this process');
  }

  // 2. Database presence.
  if (!fs.existsSync(reviewDbPath)) {
    fail('review database exists', reviewDbPath);
    report();
    return;
  }
  ok(`review database exists (${reviewDbPath})`);

  // 3. Migration tip fully applied.
  const status = await migrationStatus({ dbPath: reviewDbPath });
  const pending = status.filter((m) => m.status !== 'applied');
  if (pending.length) {
    fail('all migrations applied', `${pending.length} pending: ${pending.map((m) => m.id).join(', ')}`);
  } else {
    ok(`migration tip fully applied (${status.length} migrations)`);
  }

  // 4. Required review identities exist.
  const dialect = openMigrationDatabase(reviewDbPath);
  try {
    const userCount = dialect.prepare('SELECT COUNT(*) AS n FROM platform_users').get().n;
    if (userCount < REVIEW_ROLES.length) {
      fail('required review identities exist', `expected >= ${REVIEW_ROLES.length}, found ${userCount}`);
    } else {
      ok(`review identities present (${userCount} users, ${REVIEW_ROLES.length} required)`);
    }

    const tenants = dialect.prepare('SELECT id FROM platform_tenants WHERE id IN (?, ?)').all(REVIEW_TENANT, ISOLATION_TENANT);
    if (tenants.length !== 2) {
      fail('both review tenants exist', `found ${tenants.length}/2`);
    } else {
      ok('both review tenants exist (primary + isolation)');
    }

    const assignments = dialect.prepare('SELECT COUNT(*) AS n FROM authorization_role_assignments').get().n;
    if (assignments < REVIEW_ROLES.length) {
      fail('role assignments exist for every identity', `expected >= ${REVIEW_ROLES.length}, found ${assignments}`);
    } else {
      ok(`role assignments present (${assignments})`);
    }

    // Startup-policy disposability marker (database/migration-runner/startup-policy.mjs)
    // — without it, server.js refuses to open this database at all.
    const marker = dialect.prepare(
      "SELECT is_disposable FROM cutover_staged_fixture WHERE id = 'staged'",
    ).get();
    if (!marker || marker.is_disposable !== 1) {
      fail('database carries the disposable-fixture startup marker', 'cutover_staged_fixture missing or is_disposable != 1');
    } else {
      ok('database provably disposable (cutover_staged_fixture marker present)');
    }
  } finally {
    dialect.close();
  }

  // 5. Required fixtures exist (fixture-summary.json written by review:setup).
  if (!fs.existsSync(summaryPath)) {
    fail('fixture summary exists', summaryPath);
  } else {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const domains = Object.keys(summary.summaries || {});
    const expectedDomains = ['workshop', 'warehouse', 'production', 'quality', 'commercial/SaaS', 'Al-Warsha pack', 'AI', 'people development', 'marketing', 'events'];
    const missing = expectedDomains.filter((d) => !domains.includes(d));
    if (missing.length) {
      fail('all fixture domains seeded', `missing: ${missing.join(', ')}`);
    } else {
      ok(`all ${expectedDomains.length} fixture domains seeded`);
    }
  }

  // 6. Credentials manifest exists and is git-ignored (never print the password here).
  if (!fs.existsSync(manifestPath)) {
    fail('review credentials manifest exists', manifestPath);
  } else {
    ok(`review credentials manifest exists (${manifestPath})`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.environment !== 'DISPOSABLE LOCAL REVIEW ONLY') {
      fail('credentials manifest is marked disposable', 'unexpected environment marker');
    } else if (manifest.reviewTag !== REVIEW_TAG || manifest.url !== REVIEW_URL || manifest.sharedPassword !== REVIEW_PASSWORD) {
      fail('fixed review credential manifest is current', 'tag, URL, or shared password does not match review tooling');
    } else if (!Array.isArray(manifest.accounts) || manifest.accounts.length !== REVIEW_ROLES.length) {
      fail('credentials manifest contains every review account', `expected ${REVIEW_ROLES.length}, found ${manifest.accounts?.length || 0}`);
    } else {
      ok(`fixed review credential manifest is current (${manifest.accounts.length} accounts)`);
    }
  }

  report();
}

function report() {
  console.log('');
  if (failures.length) {
    console.error(`[review:verify] FAILED — ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('[review:verify] PASSED — disposable review environment is sane.');
}

main().catch((error) => {
  console.error('[review:verify] FAILED:', error && error.stack || error);
  process.exit(1);
});
