import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { nextSeq, peekSeq, resetSeq, formatSequence, currentPeriod } from '../../platform/records/sequences/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-seq-test-${Date.now()}.db`);
}

async function setup() {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  return { dialect, dbPath };
}

async function cleanup(dialect, dbPath) {
  dialect.close();
  fs.unlinkSync(dbPath);
}

async function testBasicSequence() {
  const { dialect, dbPath } = await setup();
  dialect.exec('BEGIN IMMEDIATE;');
  const s1 = nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{YYYY}-{####}', companyId: 'c1' });
  const s2 = nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{YYYY}-{####}', companyId: 'c1' });
  dialect.exec('COMMIT;');
  assert.ok(s1.formatted.startsWith('INV-'));
  assert.strictEqual(s2.number, s1.number + 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: basicSequence');
}

async function testCompanyIsolation() {
  const { dialect, dbPath } = await setup();
  dialect.exec('BEGIN IMMEDIATE;');
  const a = nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{#####}', companyId: 'c1' });
  const b = nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{#####}', companyId: 'c2' });
  dialect.exec('COMMIT;');
  assert.strictEqual(a.number, 1);
  assert.strictEqual(b.number, 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: companyIsolation');
}

async function testCalendarMonthReset() {
  const { dialect, dbPath } = await setup();
  const now = new Date();
  const current = currentPeriod(now);
  const prev = now.getMonth() === 0 ? `${now.getFullYear() - 1}12` : `${now.getFullYear()}${String(now.getMonth()).padStart(2, '0')}`;
  dialect.prepare(`
    INSERT INTO platform_sequences (id, module_id, scope_key, template, current_value, reset_policy, gap_policy, fiscal_period_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`inv:c1:${prev}`, 'platform_kernel', 'inv', 'INV-{YYYY}{MM}-{###}', 50, 'calendar_month', 'allowed', prev, now.toISOString(), now.toISOString());
  dialect.exec('BEGIN IMMEDIATE;');
  const s = nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{YYYY}{MM}-{###}', companyId: 'c1', resetPolicy: 'calendar_month' });
  dialect.exec('COMMIT;');
  assert.strictEqual(s.number, 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: calendarMonthReset');
}

async function testPeekSeq() {
  const { dialect, dbPath } = await setup();
  dialect.exec('BEGIN IMMEDIATE;');
  nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{#####}', companyId: 'c1' });
  dialect.exec('COMMIT;');
  const peek = peekSeq(dialect, { scopeKey: 'inv', companyId: 'c1' });
  assert.strictEqual(peek.number, 2);
  await cleanup(dialect, dbPath);
  console.log('PASS: peekSeq');
}

async function testResetSeq() {
  const { dialect, dbPath } = await setup();
  dialect.exec('BEGIN IMMEDIATE;');
  nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{#####}', companyId: 'c1' });
  dialect.exec('COMMIT;');
  resetSeq(dialect, { scopeKey: 'inv', companyId: 'c1' });
  dialect.exec('BEGIN IMMEDIATE;');
  const s = nextSeq(dialect, { scopeKey: 'inv', template: 'INV-{#####}', companyId: 'c1' });
  dialect.exec('COMMIT;');
  assert.strictEqual(s.number, 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: resetSeq');
}

async function testFormatSequence() {
  const formatted = formatSequence('ORD-{YYYY}-{MM}-{#####}', 42, '2026-07', new Date('2026-07-21'));
  assert.strictEqual(formatted, 'ORD-2026-07-00042');
  console.log('PASS: formatSequence');
}

async function main() {
  await testBasicSequence();
  await testCompanyIsolation();
  await testCalendarMonthReset();
  await testPeekSeq();
  await testResetSeq();
  await testFormatSequence();
  console.log('\nAll sequence tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
