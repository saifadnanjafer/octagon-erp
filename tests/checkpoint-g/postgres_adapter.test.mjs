// Checkpoint G — PostgreSQL adapter and portability layer.
//
// Closes the *implementation* half of Checkpoint F blocker H4. The runtime half
// stays open and is reported as such: no PostgreSQL server was reachable and
// the `pg` driver is not a dependency, so nothing here touches a real server.
// The adapter is exercised against an injected fake client that records the
// statements it receives, which proves translation, parameter binding,
// transaction sequencing and error wrapping — and proves nothing about wire
// behaviour.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  translateSqlForPostgres,
  translateParameters,
  auditSqliteOnlyConstructs,
  untranslatableConstructs,
  COMPATIBILITY_RULES,
} from '../../database/dialects/sql-portability.mjs';
import { PostgresDialect, PostgresDialectError, loadPgDriver } from '../../database/dialects/postgres-dialect.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');

/** Records every statement, so we can assert on what the adapter actually sent. */
function fakeClient({ failOn = null, rows = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text, params: params ?? null });
      if (failOn && text.includes(failOn)) {
        const err = new Error('relation "nope" does not exist');
        err.code = '42P01';
        throw err;
      }
      return { rows, rowCount: rows.length };
    },
    async end() { this.ended = true; },
  };
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

test('STRICT is stripped — the 297-occurrence blocker', () => {
  const sqlite = `CREATE TABLE IF NOT EXISTS t (
    id TEXT PRIMARY KEY,
    n INTEGER NOT NULL
  ) STRICT;`;
  const pg = translateSqlForPostgres(sqlite);
  assert.ok(!/STRICT/i.test(pg), `STRICT survived translation: ${pg}`);
  assert.ok(/CREATE TABLE IF NOT EXISTS t/.test(pg), 'translation damaged the statement');
  assert.ok(/\)\s*;/.test(pg), 'translation left a malformed tail');
});

test('every STRICT declaration in the real schema is translatable', () => {
  // Not a sample: every migration file that uses STRICT.
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.mjs'));
  let strictFiles = 0;
  let strictOccurrences = 0;

  for (const file of files) {
    const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const matches = source.match(/\)\s*STRICT/gi);
    if (!matches) continue;
    strictFiles += 1;
    strictOccurrences += matches.length;
    assert.ok(
      !/\)\s*STRICT/i.test(translateSqlForPostgres(source)),
      `${file} still contains STRICT after translation`,
    );
  }

  assert.ok(strictFiles > 40, `expected STRICT across many migrations, saw ${strictFiles}`);
  assert.ok(strictOccurrences > 250, `expected ~297 STRICT occurrences, saw ${strictOccurrences}`);
});

test('AUTOINCREMENT becomes an identity column', () => {
  const pg = translateSqlForPostgres('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT);');
  assert.ok(!/AUTOINCREMENT/i.test(pg), 'AUTOINCREMENT survived');
  assert.match(pg, /GENERATED ALWAYS AS IDENTITY/i);
});

test('INSERT OR IGNORE becomes ON CONFLICT DO NOTHING', () => {
  const pg = translateSqlForPostgres("INSERT OR IGNORE INTO t (a) VALUES ('x');");
  assert.ok(!/INSERT\s+OR\s+IGNORE/i.test(pg));
  assert.match(pg, /ON CONFLICT DO NOTHING/i);
});

test('SQLite type names are mapped', () => {
  const pg = translateSqlForPostgres('CREATE TABLE t (a DATETIME, b BLOB);');
  assert.match(pg, /TIMESTAMPTZ/i);
  assert.match(pg, /BYTEA/i);
});

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

test('positional ? placeholders become $1..$n in order', () => {
  const { text, parameterCount } = translateParameters('SELECT * FROM t WHERE a = ? AND b = ? AND c = ?');
  assert.equal(text, 'SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3');
  assert.equal(parameterCount, 3);
});

test('a ? inside a string literal or comment is not renumbered', () => {
  const { text, parameterCount } = translateParameters(
    "SELECT '? not a param', a FROM t WHERE b = ? -- trailing ? comment",
  );
  assert.match(text, /'\? not a param'/, 'a literal question mark was rewritten');
  assert.match(text, /b = \$1/, 'the real parameter was not translated');
  assert.match(text, /-- trailing \? comment/, 'a comment question mark was rewritten');
  assert.equal(parameterCount, 1);
});

test('escaped quotes inside literals do not break parameter scanning', () => {
  const { text, parameterCount } = translateParameters(
    "UPDATE t SET name = 'O''Brien ?' WHERE id = ?",
  );
  assert.match(text, /'O''Brien \?'/);
  assert.match(text, /id = \$1/);
  assert.equal(parameterCount, 1);
});

// ---------------------------------------------------------------------------
// Compatibility audit
// ---------------------------------------------------------------------------

test('the audit reports both translatable and untranslatable constructs', () => {
  const found = auditSqliteOnlyConstructs('SELECT * FROM sqlite_master; PRAGMA table_info(t);');
  const ids = found.map((f) => f.id);
  assert.ok(ids.includes('SQLITE_MASTER'));
  assert.ok(ids.includes('PRAGMA'));
  for (const f of found) assert.equal(f.translated, false, `${f.id} claims to be translatable`);
});

test('untranslatable constructs are surfaced, never silently mistranslated', () => {
  assert.deepEqual(untranslatableConstructs('CREATE TABLE t (id TEXT) STRICT;'), []);
  const blocked = untranslatableConstructs("INSERT OR REPLACE INTO t VALUES ('a');");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].id, 'INSERT_OR_REPLACE');
});

test('every compatibility rule carries an actionable note', () => {
  for (const rule of COMPATIBILITY_RULES) {
    assert.ok(rule.id && rule.pattern instanceof RegExp, `malformed rule ${JSON.stringify(rule)}`);
    assert.ok(rule.note && rule.note.length > 10, `rule ${rule.id} has no actionable note`);
  }
});

// ---------------------------------------------------------------------------
// Adapter behaviour
// ---------------------------------------------------------------------------

test('the adapter no longer throws "not yet configured" for everything', async () => {
  const dialect = new PostgresDialect({ client: fakeClient() });
  const caps = dialect.capabilities();
  assert.equal(caps.dialect, 'postgres');
  assert.equal(caps.transactions, true);
  assert.equal(caps.positionalParameters, '$n');
  assert.equal(caps.sqliteCompatibilityLayer, true);
});

test('exec translates before sending to the server', async () => {
  const client = fakeClient();
  const dialect = new PostgresDialect({ client });
  await dialect.exec('CREATE TABLE t (id TEXT PRIMARY KEY) STRICT;');
  assert.equal(client.queries.length, 1);
  assert.ok(!/STRICT/i.test(client.queries[0].text), 'untranslated SQL reached the server');
});

test('prepare().run/get/all bind parameters positionally', async () => {
  const client = fakeClient({ rows: [{ id: 'a', n: 1 }] });
  const dialect = new PostgresDialect({ client });

  const stmt = dialect.prepare('SELECT * FROM t WHERE id = ? AND n = ?');
  assert.equal(stmt.text, 'SELECT * FROM t WHERE id = $1 AND n = $2');
  assert.equal(stmt.parameterCount, 2);

  const row = await stmt.get('a', 1);
  assert.deepEqual(row, { id: 'a', n: 1 });
  assert.deepEqual(client.queries.at(-1).params, ['a', 1]);

  const all = await stmt.all('a', 1);
  assert.equal(all.length, 1);

  const res = await stmt.run('a', 1);
  assert.equal(res.changes, 1);
});

test('transaction() commits on success and rolls back on throw', async () => {
  const okClient = fakeClient();
  const ok = new PostgresDialect({ client: okClient });
  await ok.transaction(async (d) => d.exec('SELECT 1;'));
  const okSeq = okClient.queries.map((q) => q.text.trim());
  assert.equal(okSeq[0], 'BEGIN');
  assert.equal(okSeq.at(-1), 'COMMIT');
  assert.equal(ok.inTransaction, false);

  const badClient = fakeClient();
  const bad = new PostgresDialect({ client: badClient });
  await assert.rejects(
    () => bad.transaction(async () => { throw new Error('domain failure'); }),
    /domain failure/,
  );
  const badSeq = badClient.queries.map((q) => q.text.trim());
  assert.equal(badSeq[0], 'BEGIN');
  assert.equal(badSeq.at(-1), 'ROLLBACK');
  assert.equal(bad.inTransaction, false, 'transaction flag left set after rollback');
});

test('a nested transaction is refused rather than silently flattened', async () => {
  const dialect = new PostgresDialect({ client: fakeClient() });
  await dialect.begin();
  await assert.rejects(() => dialect.begin(), (e) => e.code === 'PG_NESTED_TRANSACTION');
  await dialect.rollback();
});

test('driver errors are wrapped with the failing SQL and driver code', async () => {
  const dialect = new PostgresDialect({ client: fakeClient({ failOn: 'nope' }) });
  await assert.rejects(
    () => dialect.exec('SELECT * FROM nope;'),
    (err) => {
      assert.ok(err instanceof PostgresDialectError, 'raw driver error escaped unwrapped');
      assert.equal(err.code, 'PG_EXECUTION_FAILED');
      assert.equal(err.details.driverCode, '42P01');
      assert.match(err.details.sql, /nope/);
      return true;
    },
  );
});

test('untranslatable SQL is refused before it reaches the server', async () => {
  const client = fakeClient();
  const dialect = new PostgresDialect({ client });
  await assert.rejects(
    () => dialect.exec('PRAGMA table_info(t);'),
    (err) => err.code === 'PG_UNTRANSLATABLE_SQL',
  );
  assert.equal(client.queries.length, 0, 'untranslatable SQL was still sent to the server');
});

test('operations without a connection fail closed', async () => {
  const dialect = new PostgresDialect({});
  assert.throws(() => dialect.requireClient(), (e) => e.code === 'PG_NOT_CONNECTED');
  await assert.rejects(() => dialect.open(), (e) => e.code === 'PG_NO_CONNECTION_STRING');
});

test('a missing pg driver produces an actionable message, not a stack trace', async () => {
  await assert.rejects(
    () => loadPgDriver(() => Promise.reject(new Error("Cannot find package 'pg'"))),
    (err) => {
      assert.equal(err.code, 'PG_DRIVER_MISSING');
      assert.match(err.message, /npm install pg/);
      assert.match(err.message, /OCTAGON_POSTGRES_URL/);
      return true;
    },
  );
});

test('close() rolls back an open transaction and releases the client', async () => {
  const client = fakeClient();
  const dialect = new PostgresDialect({ client });
  await dialect.begin();
  await dialect.close();
  assert.equal(client.queries.map((q) => q.text.trim()).at(-1), 'ROLLBACK');
  assert.equal(dialect.client, null, 'client not released on close');
});

test('backup is refused with a pointer to the correct PostgreSQL tool', () => {
  const dialect = new PostgresDialect({ client: fakeClient() });
  assert.throws(
    () => dialect.backup(),
    (err) => err.code === 'PG_BACKUP_UNSUPPORTED' && /pg_dump/.test(err.message),
  );
});
