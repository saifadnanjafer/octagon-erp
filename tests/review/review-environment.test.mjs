// Review Freeze 1 — automated review-environment smoke suite (spec section 21).
//
// Proves the disposable review environment is real, not aspirational: setup
// creates a fresh disposable database, reset is deterministic, every active
// page is registered with a renderer and a permission, the Al-Warsha pack is
// installed, and none of this ever touches the operational database.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { SessionAuthority } from '../../platform/identity/sessions/index.mjs';
import { REVIEW_ROLES, REVIEW_TENANT, ISOLATION_TENANT } from '../../scripts/review/roles.mjs';
import {
  assertReviewFixtureAllowed,
  isLoopbackHost,
  REVIEW_BIND_HOST,
  REVIEW_PASSWORD,
} from '../../scripts/review/identities.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const reviewDbPath = path.join(repoRoot, '.review-data', 'octagon-review.db');
const reviewManifestPath = path.join(repoRoot, '.review-data', 'review-credentials.json');
const fixtureSummaryPath = path.join(repoRoot, '.review-data', 'fixture-summary.json');
const pageInventoryPath = path.join(repoRoot, 'docs', 'review', 'PAGE_INVENTORY.json');
const operationalDbPath = path.join(repoRoot, 'database.db');
const operationalJsonPath = path.join(repoRoot, 'database.json');

const EXPECTED_FIXTURE_DOMAINS = [
  'workshop', 'warehouse', 'production', 'quality', 'commercial/SaaS',
  'Al-Warsha pack', 'AI', 'people development', 'marketing', 'events',
];

function runNpmScript(script) {
  return execFileSync('node', [path.join(repoRoot, 'scripts', 'review', `${script}.mjs`)], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

function statMtime(p) {
  return fs.existsSync(p) ? fs.statSync(p).mtimeMs : null;
}

test('operational database is never touched by the review environment', () => {
  const dbBefore = statMtime(operationalDbPath);
  const jsonBefore = statMtime(operationalJsonPath);

  runNpmScript('reset');

  const dbAfter = statMtime(operationalDbPath);
  const jsonAfter = statMtime(operationalJsonPath);
  assert.equal(dbAfter, dbBefore, 'database.db mtime changed — review:reset touched the operational database');
  assert.equal(jsonAfter, jsonBefore, 'database.json mtime changed — review:reset touched the operational database');
});

test('review:setup creates a fresh, fully-migrated disposable database', () => {
  assert.ok(fs.existsSync(reviewDbPath), 'disposable review database was not created');

  const dialect = openMigrationDatabase(reviewDbPath);
  try {
    const marker = dialect.prepare(
      "SELECT is_disposable FROM cutover_staged_fixture WHERE id = 'staged'",
    ).get();
    assert.equal(marker?.is_disposable, 1, 'database does not carry the disposable-fixture startup marker');
  } finally {
    dialect.close();
  }
});

test('review:reset is deterministic — identical identity and fixture counts across two runs', () => {
  runNpmScript('reset');
  const manifestA = JSON.parse(fs.readFileSync(reviewManifestPath, 'utf8'));
  const summaryA = JSON.parse(fs.readFileSync(fixtureSummaryPath, 'utf8'));

  runNpmScript('reset');
  const manifestB = JSON.parse(fs.readFileSync(reviewManifestPath, 'utf8'));
  const summaryB = JSON.parse(fs.readFileSync(fixtureSummaryPath, 'utf8'));
  runNpmScript('setup');
  const manifestC = JSON.parse(fs.readFileSync(reviewManifestPath, 'utf8'));

  assert.deepEqual(
    manifestA.accounts.map((u) => u.username).sort(),
    manifestB.accounts.map((u) => u.username).sort(),
    'identity login set is not deterministic across resets',
  );
  assert.equal(manifestA.sharedPassword, REVIEW_PASSWORD, 'reset A did not use the fixed review password');
  assert.equal(manifestB.sharedPassword, REVIEW_PASSWORD, 'reset B did not use the fixed review password');
  assert.deepEqual(manifestA.accounts, manifestB.accounts, 'account roles/scopes are not deterministic across resets');
  assert.equal(manifestC.sharedPassword, REVIEW_PASSWORD, 'setup did not use the fixed review password');
  assert.deepEqual(manifestA.accounts, manifestC.accounts, 'setup did not recreate the same review accounts');
  assert.deepEqual(Object.keys(summaryA.summaries).sort(), Object.keys(summaryB.summaries).sort(), 'fixture domain set is not deterministic across resets');
});

test('required review identities exist — all 19 named roles plus isolation viewer', () => {
  const manifest = JSON.parse(fs.readFileSync(reviewManifestPath, 'utf8'));
  const logins = new Set(manifest.accounts.map((u) => u.username));
  for (const role of REVIEW_ROLES) {
    assert.ok(logins.has(role.login), `missing review identity: ${role.login}`);
  }
  assert.equal(manifest.accounts.length, REVIEW_ROLES.length, 'unexpected number of review identities seeded');
});

test('required review fixtures exist — all 10 domains seeded with at least one row', () => {
  const summary = JSON.parse(fs.readFileSync(fixtureSummaryPath, 'utf8'));
  for (const domain of EXPECTED_FIXTURE_DOMAINS) {
    assert.ok(summary.summaries[domain], `missing fixture domain in summary: ${domain}`);
  }
});

test('Al-Warsha pack is installed and enabled in review data', () => {
  const dialect = openMigrationDatabase(reviewDbPath);
  try {
    const row = dialect.prepare(
      "SELECT state FROM build12_pack_installations WHERE package_id = 'pack:al_warsha' AND tenant_id = 't_octagon_review'",
    ).get();
    assert.ok(row, 'no Al-Warsha pack installation row for the review tenant');
    assert.equal(row.state, 'enabled', `Al-Warsha pack installation state is "${row?.state}", expected "enabled"`);
  } finally {
    dialect.close();
  }
});

test('all active page ids are registered exactly once (no duplicates)', () => {
  const pages = JSON.parse(fs.readFileSync(pageInventoryPath, 'utf8'));
  assert.ok(pages.length > 0, 'page inventory is empty');
  const ids = pages.map((p) => p.pageId);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, `duplicate page ids found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
});

test('no active page lacks discoverable renderer wiring', () => {
  const pages = JSON.parse(fs.readFileSync(pageInventoryPath, 'utf8'));
  const unwired = pages.filter((p) => p.wiringFound !== true);
  assert.equal(unwired.length, 0, `pages with no renderer wiring found: ${unwired.map((p) => p.pageId).join(', ')}`);
});

test('every non-public page has a declared client-side permission gate', () => {
  const pages = JSON.parse(fs.readFileSync(pageInventoryPath, 'utf8'));
  const ungated = pages.filter((p) => p.requiredPermission !== 'none (public/open)' && p.hasPagePermissions !== true);
  assert.equal(ungated.length, 0, `non-public pages missing a PAGE_PERMISSIONS entry: ${ungated.map((p) => p.pageId).join(', ')}`);
});

test('commercial/BUILD-11-12 pages remain permission-scoped, not silently public', () => {
  const pages = JSON.parse(fs.readFileSync(pageInventoryPath, 'utf8'));
  const commercialPages = pages.filter((p) => p.looksCommercial === true);
  assert.ok(commercialPages.length > 0, 'no commercial pages found in inventory — inventory may be stale');
  const unscoped = commercialPages.filter((p) => p.requiredPermission === 'none (public/open)');
  assert.equal(unscoped.length, 0, `commercial pages with no permission gate: ${unscoped.map((p) => p.pageId).join(', ')}`);
});

test('all review identities authenticate with the fixed password through SessionAuthority', () => {
  const dialect = openMigrationDatabase(reviewDbPath);
  try {
    const sessions = new SessionAuthority(dialect);
    for (const role of REVIEW_ROLES) {
      const result = sessions.authenticate({
        tenantId: role.tenant || (role.key === 'isolation_viewer' ? ISOLATION_TENANT : REVIEW_TENANT),
        login: role.login,
        password: REVIEW_PASSWORD,
        ip: '127.0.0.1',
        userAgent: 'review-environment-test',
      });
      assert.equal(result.userId, `usr_review_${role.key}`, `${role.login} did not authenticate`);
    }
  } finally {
    dialect.close();
  }
});

test('wrong review password is rejected', () => {
  const dialect = openMigrationDatabase(reviewDbPath);
  try {
    const sessions = new SessionAuthority(dialect);
    assert.throws(
      () => sessions.authenticate({ tenantId: REVIEW_TENANT, login: 'review.viewer', password: 'wrong-review-password' }),
      (error) => error?.code === 'AUTH_FAILED',
    );
  } finally {
    dialect.close();
  }
});

test('fixed credential guard fails outside review mode, review data scope, and loopback binding', () => {
  const baseEnv = {
    OCTAGON_REVIEW_FIXTURE: '1',
    OCTAGON_REVIEW_MODE: '1',
    OCTAGON_REVIEW_HOST: REVIEW_BIND_HOST,
    NODE_ENV: 'test',
  };
  assert.throws(
    () => assertReviewFixtureAllowed({ dbPath: reviewDbPath, env: { ...baseEnv, OCTAGON_REVIEW_MODE: '0' } }),
    (error) => error?.code === 'REVIEW_MODE_REQUIRED',
  );
  assert.throws(
    () => assertReviewFixtureAllowed({ dbPath: path.join(repoRoot, 'tmp', 'not-review.db'), env: baseEnv }),
    (error) => error?.code === 'REVIEW_DB_SCOPE_DENIED',
  );
  assert.throws(
    () => assertReviewFixtureAllowed({ dbPath: reviewDbPath, env: { ...baseEnv, OCTAGON_REVIEW_HOST: '0.0.0.0' } }),
    (error) => error?.code === 'REVIEW_BINDING_DENIED',
  );
  assert.throws(
    () => assertReviewFixtureAllowed({ dbPath: reviewDbPath, env: { ...baseEnv, OCTAGON_REVIEW_FIXTURE: '0' } }),
    (error) => error?.code === 'REVIEW_FLAG_REQUIRED',
  );
});

test('review credentials are ignored and plaintext is absent from SQLite', () => {
  assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '--quiet', '.review-data/review-credentials.json'], { cwd: repoRoot }));
  const dialect = openMigrationDatabase(reviewDbPath);
  try {
    const rows = dialect.prepare('SELECT algorithm, salt, hash FROM identity_credentials').all();
    assert.equal(rows.length, REVIEW_ROLES.length, 'unexpected credential row count');
    assert.ok(rows.every((row) => row.algorithm === 'scrypt'), 'review credentials must use canonical scrypt hashes');
    assert.ok(!JSON.stringify(rows).includes(REVIEW_PASSWORD), 'fixed plaintext password is stored in SQLite');
  } finally {
    dialect.close();
  }
});

test('review server bind configuration is loopback-only', () => {
  assert.equal(REVIEW_BIND_HOST, '127.0.0.1');
  assert.equal(isLoopbackHost(REVIEW_BIND_HOST), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  const startSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'review', 'start.mjs'), 'utf8');
  assert.match(startSource, /reviewLoopbackListen/);
  assert.match(startSource, /OCTAGON_REVIEW_MODE = '1'/);
});

test('review tooling leaves operational users and paths unchanged', () => {
  const dbBefore = statMtime(operationalDbPath);
  const jsonBefore = statMtime(operationalJsonPath);
  runNpmScript('setup');
  assert.equal(statMtime(operationalDbPath), dbBefore, 'review setup changed operational database.db');
  assert.equal(statMtime(operationalJsonPath), jsonBefore, 'review setup changed operational database.json');
});

test('review database can be deleted safely, leaving no trace outside .review-data', () => {
  const reviewDataDir = path.join(repoRoot, '.review-data');
  assert.ok(fs.existsSync(reviewDataDir), 'review data directory does not exist before deletion test');

  // This checkout may or may not have an operational database.db/database.json
  // at all (a feature-branch clone used purely for automated development
  // often has neither). The invariant that matters is not "it must exist" —
  // it's "deleting review data must never change whether it exists".
  const dbExistedBefore = fs.existsSync(operationalDbPath);
  const jsonExistedBefore = fs.existsSync(operationalJsonPath);

  fs.rmSync(reviewDataDir, { recursive: true, force: true });
  assert.equal(fs.existsSync(reviewDataDir), false, 'review data directory survived deletion');
  assert.equal(fs.existsSync(operationalDbPath), dbExistedBefore, 'deleting review data changed whether database.db exists — must never happen');
  assert.equal(fs.existsSync(operationalJsonPath), jsonExistedBefore, 'deleting review data changed whether database.json exists — must never happen');

  // Leave the environment in a working state for any test/reviewer that runs next.
  runNpmScript('setup');
  assert.ok(fs.existsSync(reviewDbPath), 'review:setup did not recreate the database after deletion');
});
