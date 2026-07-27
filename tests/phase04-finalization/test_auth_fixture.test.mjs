// Disposable authenticated test fixture — safety and behaviour tests.
//
// The fixture creates login-capable identities. That is exactly the kind of
// thing that must never be able to touch operational data or run in
// production, so every guard is proven independently here, and the seeding
// itself is proven to actually produce a usable authenticated session.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertFixtureAllowed,
  seedTestIdentities,
  writeFixtureManifest,
  FixtureRefused,
  TEST_ROLES,
  TEST_PASSWORD,
  TEST_TENANT,
} from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { checkCredentials } from '../../platform/identity/passwords/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const ALLOWED_ENV = { OCTAGON_TEST_FIXTURE: '1', NODE_ENV: 'test' };

let tempDir;
let dbPath;
let db;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-fixture-test-'));
  dbPath = path.join(tempDir, 'fixture.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'fixture-test' });
  db = openMigrationDatabase(dbPath);
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

// --- guards ---------------------------------------------------------------

test('guard 1: refuses without OCTAGON_TEST_FIXTURE=1', () => {
  assert.throws(
    () => assertFixtureAllowed({ dbPath: '/tmp/x.db', env: { NODE_ENV: 'test' } }),
    (e) => {
      assert.ok(e instanceof FixtureRefused);
      assert.equal(e.code, 'FIXTURE_FLAG_REQUIRED');
      return true;
    },
  );
});

test('guard 1: a truthy-but-wrong flag value is not enough', () => {
  for (const value of ['true', 'yes', '0', 'on', '']) {
    assert.throws(
      () => assertFixtureAllowed({ dbPath: '/tmp/x.db', env: { OCTAGON_TEST_FIXTURE: value, NODE_ENV: 'test' } }),
      (e) => e.code === 'FIXTURE_FLAG_REQUIRED',
      `flag value ${JSON.stringify(value)} must not enable the fixture`,
    );
  }
});

test('guard 2: production mode denies the fixture even with the flag set', () => {
  for (const value of ['production', 'PRODUCTION', 'Production']) {
    assert.throws(
      () => assertFixtureAllowed({ dbPath: '/tmp/x.db', env: { OCTAGON_TEST_FIXTURE: '1', NODE_ENV: value } }),
      (e) => {
        assert.equal(e.code, 'FIXTURE_PRODUCTION_DENIED');
        return true;
      },
      `NODE_ENV=${value} must deny the fixture`,
    );
  }
});

test('guard 3: refuses to seed the operational database', () => {
  assert.throws(
    () => assertFixtureAllowed({ dbPath: path.join(repoRoot, 'database.db'), env: ALLOWED_ENV }),
    (e) => {
      assert.equal(e.code, 'FIXTURE_OPERATIONAL_DENIED');
      return true;
    },
  );
});

test('guard 3: refuses the operational json store too', () => {
  assert.throws(
    () => assertFixtureAllowed({ dbPath: path.join(repoRoot, 'database.json'), env: ALLOWED_ENV }),
    (e) => e.code === 'FIXTURE_OPERATIONAL_DENIED',
  );
});

test('guard 3: refuses any database sitting in the product repo root', () => {
  // Defends against a future rename of database.db becoming silently seedable.
  assert.throws(
    () => assertFixtureAllowed({ dbPath: path.join(repoRoot, 'database.renamed.db'), env: ALLOWED_ENV }),
    (e) => {
      assert.equal(e.code, 'FIXTURE_REPO_ROOT_DENIED');
      return true;
    },
  );
});

test('guard: an explicit dbPath is mandatory', () => {
  assert.throws(
    () => assertFixtureAllowed({ env: ALLOWED_ENV }),
    (e) => e.code === 'FIXTURE_DBPATH_REQUIRED',
  );
});

test('a disposable temp-directory path is allowed', () => {
  assert.equal(assertFixtureAllowed({ dbPath, env: ALLOWED_ENV }), true);
});

test('there is no override or force flag', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'test-auth-fixture.mjs'), 'utf8');
  assert.ok(!/force\s*[:=]/i.test(source), 'fixture must not expose a force/override path');
  assert.ok(!/skipGuards|bypass/i.test(source), 'fixture must not expose a guard bypass');
});

// --- seeding behaviour ----------------------------------------------------

test('seeding creates all eight disposable roles', () => {
  const seeded = seedTestIdentities(db, { dbPath, env: ALLOWED_ENV });
  assert.equal(seeded.users.length, 8);
  const keys = seeded.users.map((u) => u.key).sort();
  assert.deepStrictEqual(keys, [
    'finance', 'inventory', 'pos', 'procurement', 'sales', 'sysadmin', 'viewer', 'workshop',
  ]);
});

test('seeded users can actually authenticate with the fixture password', () => {
  for (const role of TEST_ROLES) {
    const result = checkCredentials(db, `usr_test_${role.key}`, TEST_PASSWORD);
    assert.ok(result && result.ok !== false,
      `${role.key} must be able to authenticate with the fixture password`);
  }
});

test('a wrong password is still rejected — the fixture does not weaken auth', () => {
  const result = checkCredentials(db, 'usr_test_sysadmin', 'definitely-not-the-password');
  assert.ok(!result || result.ok === false, 'wrong credentials must not authenticate');
});

test('the restricted viewer gets read only, so denial can be proven', () => {
  const viewer = TEST_ROLES.find((r) => r.key === 'viewer');
  assert.deepStrictEqual([...viewer.permissions], ['platform:db:read']);
  assert.ok(!viewer.permissions.includes('platform:db:write'),
    'the viewer must not be able to write, otherwise permission denial cannot be demonstrated');
});

test('write-capable roles really hold the write permission', () => {
  for (const role of TEST_ROLES.filter((r) => r.key !== 'viewer')) {
    assert.ok(role.permissions.includes('platform:db:write'),
      `${role.key} needs write to exercise canonical commands`);
  }
});

test('grants are persisted and resolvable for each seeded role', () => {
  for (const role of TEST_ROLES) {
    const rows = db.prepare(
      'SELECT permission FROM authorization_grants WHERE role_id = ? ORDER BY permission',
    ).all(role.roleId).map((r) => r.permission);
    assert.deepStrictEqual(rows, [...role.permissions].sort(),
      `${role.key} grants not persisted as declared`);
  }
});

test('every seeded user has an active role assignment', () => {
  for (const role of TEST_ROLES) {
    const row = db.prepare(
      "SELECT status FROM authorization_role_assignments WHERE user_id = ? AND role_id = ? AND status = 'active'",
    ).get(`usr_test_${role.key}`, role.roleId);
    assert.ok(row, `${role.key} has no active role assignment`);
  }
});

test('seeding is idempotent', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM identity_users').get().n;
  seedTestIdentities(db, { dbPath, env: ALLOWED_ENV });
  const after = db.prepare('SELECT COUNT(*) AS n FROM identity_users').get().n;
  assert.equal(after, before, 're-running the fixture must not duplicate users');
});

test('seeded identities live in an isolated test tenant', () => {
  const rows = db.prepare('SELECT DISTINCT tenant_id FROM identity_users WHERE id LIKE ?').all('usr_test_%');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenant_id, TEST_TENANT);
});

test('seeding refuses through the same guards as assertFixtureAllowed', () => {
  assert.throws(
    () => seedTestIdentities(db, { dbPath, env: { OCTAGON_TEST_FIXTURE: '1', NODE_ENV: 'production' } }),
    (e) => e.code === 'FIXTURE_PRODUCTION_DENIED',
  );
  assert.throws(
    () => seedTestIdentities(db, { dbPath: path.join(repoRoot, 'database.db'), env: ALLOWED_ENV }),
    (e) => e.code === 'FIXTURE_OPERATIONAL_DENIED',
  );
});

test('the manifest is written outside the repository and carries a warning', () => {
  const target = path.join(tempDir, 'fixture-users.json');
  const seeded = seedTestIdentities(db, { dbPath, env: ALLOWED_ENV });
  writeFixtureManifest(target, seeded);
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.match(parsed.warning, /DISPOSABLE/);
  assert.equal(parsed.users.length, 8);
  assert.ok(!path.resolve(target).startsWith(path.join(repoRoot, 'docs')),
    'credentials must never be written into committed docs');
});
