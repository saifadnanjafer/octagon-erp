// Historical migration immutability gate.
//
// Migrations 001–062 are accepted history. Checkpoint I1A/I1B established that a
// historical migration was edited in-place to fix an unsafe down(); the fix was
// correct but the location was not. This test makes that class of change
// impossible to land unnoticed.
//
// If this test fails, do NOT update the manifest to match the code. Either revert
// the migration edit, or add a new forward migration and accept it through the
// governed manifest process.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert';

const REPO_ROOT = path.resolve('.');
const MANIFEST_PATH = path.join(REPO_ROOT, 'database/migration-manifests/historical-001-062.json');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database/migrations');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

async function testManifestIsWellFormed() {
  const m = loadManifest();
  assert.strictEqual(m.manifestVersion, 1);
  assert.match(m.acceptedSourceCommit, /^[0-9a-f]{40}$/, 'manifest must bind to an exact source commit');
  assert.ok(m.acceptanceReason && m.acceptanceReason.length > 20, 'manifest must record why the set was accepted');
  assert.strictEqual(m.migrations.length, m.migrationCount);

  for (const e of m.migrations) {
    assert.match(e.checksum, /^[0-9a-f]{64}$/, `${e.migrationId} checksum must be sha256 hex`);
    assert.strictEqual(e.algorithm, 'sha256');
    assert.ok(!path.isAbsolute(e.relativePath), `${e.migrationId} path must be relative, not machine-specific`);
    assert.ok(e.relativePath.startsWith('database/migrations/'), `${e.migrationId} path must be repo-relative`);
  }

  // No duplicate migration IDs.
  const ids = m.migrations.map((e) => e.migrationId);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate migration IDs in manifest');

  console.log(`PASS: manifestIsWellFormed (${m.migrationCount} entries, commit ${m.acceptedSourceCommit.slice(0, 8)})`);
}

async function testHistoricalMigrationsMatchAcceptedHashes() {
  const m = loadManifest();
  const drifted = [];

  for (const entry of m.migrations) {
    const abs = path.join(REPO_ROOT, entry.relativePath);
    if (!fs.existsSync(abs)) {
      drifted.push({ id: entry.migrationId, problem: 'MISSING SOURCE FILE' });
      continue;
    }
    const actual = sha256(abs);
    if (actual !== entry.checksum) {
      drifted.push({ id: entry.migrationId, problem: 'CHECKSUM MISMATCH', expected: entry.checksum, actual });
    }
  }

  assert.deepStrictEqual(
    drifted,
    [],
    `historical migrations were modified:\n${drifted
      .map((d) => `  ${d.id}: ${d.problem}${d.expected ? `\n    expected ${d.expected}\n    actual   ${d.actual}` : ''}`)
      .join('\n')}\n` +
      'Historical migrations are immutable. Revert the edit, or add a forward migration ' +
      'and accept it through the governed manifest process.'
  );

  console.log(`PASS: historicalMigrationsMatchAcceptedHashes (${m.migrationCount} verified)`);
}

async function testMigration014RemainsHistorical() {
  // 014 is called out explicitly: it is the migration that was edited and then
  // restored, and the one whose down() is unsafe without the compatibility layer.
  const m = loadManifest();
  const entry = m.migrations.find((e) => e.migrationId === '014_finance_canonical_schema_and_coa');
  assert.ok(entry, 'migration 014 must be present in the accepted manifest');

  const abs = path.join(REPO_ROOT, entry.relativePath);
  assert.strictEqual(sha256(abs), entry.checksum, 'migration 014 must remain byte-identical to its accepted source');

  const source = fs.readFileSync(abs, 'utf8');

  // The compatibility behaviour must NOT have crept back into the migration.
  assert.ok(
    !/UPDATE finance_accounts SET parent_id = NULL/.test(source),
    'self-reference cleanup must live in rollback-compatibility.mjs, not in migration 014'
  );
  assert.ok(
    !/DELETE FROM settings_values/.test(source),
    'settings cleanup must live in rollback-compatibility.mjs, not in migration 014'
  );

  console.log('PASS: migration014RemainsHistorical');
}

async function testCompatibilityBehaviourLivesOutsideMigrations() {
  const compatPath = path.join(REPO_ROOT, 'database/migration-runner/rollback-compatibility.mjs');
  assert.ok(fs.existsSync(compatPath), 'runner-owned rollback compatibility module must exist');

  const compat = fs.readFileSync(compatPath, 'utf8');
  assert.ok(
    /014_finance_canonical_schema_and_coa/.test(compat),
    'the 014 compatibility step must be registered in the runner-owned module'
  );
  assert.ok(/finance_accounts/.test(compat) && /settings_values/.test(compat));

  console.log('PASS: compatibilityBehaviourLivesOutsideMigrations');
}

async function testEveryMigrationOnDiskIsAccountedFor() {
  const m = loadManifest();
  const accepted = new Set(m.migrations.map((e) => e.migrationId));
  const onDisk = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.mjs$/.test(f))
    .map((f) => f.replace(/\.mjs$/, ''));

  // Files present but not accepted are new forward migrations (063+). They are
  // allowed, but must be numbered above the accepted range so history is additive.
  const unaccepted = onDisk.filter((id) => !accepted.has(id));
  for (const id of unaccepted) {
    const number = Number(id.slice(0, 3));
    assert.ok(
      Number.isInteger(number) && number > 62,
      `migration "${id}" is not in the accepted manifest and is not a forward migration above 062`
    );
  }

  // Accepted migrations must not have been deleted.
  const missing = [...accepted].filter((id) => !onDisk.includes(id));
  assert.deepStrictEqual(missing, [], `accepted historical migrations are missing from disk: ${missing.join(', ')}`);

  console.log(`PASS: everyMigrationOnDiskIsAccountedFor (${onDisk.length} on disk, ${unaccepted.length} forward)`);
}

async function testForwardMigrationsAreAcceptedNotSilent() {
  // Forward migrations (063+) are allowed, but must be accepted through their own
  // manifest rather than simply appearing on disk. The historical manifest is
  // never edited to absorb them.
  const dir = path.join(REPO_ROOT, 'database/migration-manifests');
  const forward = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'historical-001-062.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

  const accepted = new Map();
  for (const m of forward) {
    assert.match(m.acceptedSourceCommit, /^[0-9a-f]{40}$/, 'forward manifest must bind to a commit');
    assert.ok(m.acceptanceReason && m.acceptanceReason.length > 20, 'forward manifest must record why');
    for (const e of m.migrations) accepted.set(e.migrationId, e);
  }

  const onDisk = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.mjs$/.test(f))
    .map((f) => f.replace(/\.mjs$/, ''))
    .filter((id) => Number(id.slice(0, 3)) > 62);

  for (const id of onDisk) {
    const entry = accepted.get(id);
    assert.ok(entry, `forward migration "${id}" is on disk but not accepted in any manifest`);
    const abs = path.join(REPO_ROOT, entry.relativePath);
    assert.strictEqual(sha256(abs), entry.checksum, `forward migration "${id}" does not match its accepted checksum`);
  }

  console.log(`PASS: forwardMigrationsAreAcceptedNotSilent (${onDisk.length} forward, all accepted)`);
}

async function main() {
  await testManifestIsWellFormed();
  await testForwardMigrationsAreAcceptedNotSilent();
  await testHistoricalMigrationsMatchAcceptedHashes();
  await testMigration014RemainsHistorical();
  await testCompatibilityBehaviourLivesOutsideMigrations();
  await testEveryMigrationOnDiskIsAccountedFor();
  console.log('\nAll historical immutability tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
