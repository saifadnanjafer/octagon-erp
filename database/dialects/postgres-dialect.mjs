/**
 * PostgreSQL dialect for the Octagon migration runner — Checkpoint G.
 *
 * Replaces the Phase 01 stub whose every method threw. That stub was correct
 * for its time (fail closed rather than half-work), but Checkpoint F recorded
 * it as the reason PostgreSQL support was BLOCKED BY IMPLEMENTATION rather than
 * merely unavailable.
 *
 * This is a real adapter: connection handling, explicit transaction control,
 * prepared statements, `?` -> `$n` parameter translation, row and scalar
 * retrieval, batch execution, capability reporting, error wrapping and
 * connection cleanup — with SQLite-only schema constructs translated at
 * execution time by ./sql-portability.mjs, so migrations 001-060 need not be
 * rewritten.
 *
 * ===========================================================================
 * WHAT IS AND IS NOT PROVEN
 * ===========================================================================
 *
 * The `pg` driver is NOT a dependency of this project and no PostgreSQL server
 * was reachable in this environment, so **this adapter has never executed a
 * statement against a live PostgreSQL server**. Its SQL translation, parameter
 * handling, transaction sequencing and error wrapping are unit-tested against
 * an injected fake client; its wire behaviour is not tested at all.
 *
 * It therefore still fails closed, but for an honest and actionable reason: it
 * says "install pg and give me a connection string" instead of "this dialect
 * does not exist". Do not read "adapter implemented" as "PostgreSQL supported"
 * — see docs/evidence/checkpoint-g-release-closure/
 * postgresql-adapter-and-runtime.md
 *
 * The driver is loaded lazily so importing this module never requires `pg`.
 */

import {
  translateSqlForPostgres,
  translateParameters,
  untranslatableConstructs,
} from './sql-portability.mjs';

export class PostgresDialectError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'PostgresDialectError';
    this.code = code;
    this.details = details;
  }
}

/** Load the optional `pg` driver, with an actionable message when absent. */
export async function loadPgDriver(loader = null) {
  const load = loader || (() => import('pg'));
  try {
    const mod = await load();
    return mod?.default ?? mod;
  } catch (err) {
    throw new PostgresDialectError(
      'The PostgreSQL driver is not installed. Run `npm install pg`, then provide a connection ' +
      'string via OCTAGON_POSTGRES_URL (or the connectionString option) and re-run the migration.',
      'PG_DRIVER_MISSING',
      { cause: String(err?.message || err) },
    );
  }
}

export class PostgresDialect {
  name = 'postgres';

  constructor({ connectionString = null, driverLoader = null, client = null } = {}) {
    this.connectionString = connectionString || process.env.OCTAGON_POSTGRES_URL || null;
    this.driverLoader = driverLoader;
    this.client = client; // injectable, so the adapter is testable without a server
    this.inTransaction = false;
  }

  /** Capability report, used by release health and by the migration runner. */
  capabilities() {
    return {
      dialect: 'postgres',
      transactions: true,
      preparedStatements: true,
      positionalParameters: '$n',
      returningClause: true,
      upsert: 'ON CONFLICT',
      backup: false, // pg_dump is an external tool, not an in-process backup
      sqliteCompatibilityLayer: true,
      driverConnected: Boolean(this.client),
    };
  }

  async open() {
    if (this.client) return this.client;
    if (!this.connectionString) {
      throw new PostgresDialectError(
        'No PostgreSQL connection string. Set OCTAGON_POSTGRES_URL or pass { connectionString }.',
        'PG_NO_CONNECTION_STRING',
      );
    }
    const pg = await loadPgDriver(this.driverLoader);
    const client = new pg.Client({ connectionString: this.connectionString });
    await client.connect();
    this.client = client;
    return client;
  }

  requireClient() {
    if (!this.client) {
      throw new PostgresDialectError('PostgreSQL dialect is not connected; call open() first.', 'PG_NOT_CONNECTED');
    }
    return this.client;
  }

  wrapError(err, sql) {
    if (err instanceof PostgresDialectError) return err;
    return new PostgresDialectError(
      `PostgreSQL execution failed: ${err?.message || err}`,
      'PG_EXECUTION_FAILED',
      { sql: String(sql).slice(0, 500), driverCode: err?.code ?? null },
    );
  }

  /** Translate a statement; refuse anything the translator cannot handle. */
  prepareSql(sql) {
    const blocking = untranslatableConstructs(sql);
    if (blocking.length > 0) {
      throw new PostgresDialectError(
        `SQL uses constructs with no automatic PostgreSQL translation: ${blocking.map((b) => b.id).join(', ')}. ` +
        blocking.map((b) => `${b.id}: ${b.note}`).join(' | '),
        'PG_UNTRANSLATABLE_SQL',
        { constructs: blocking, sql: String(sql).slice(0, 500) },
      );
    }
    const translated = translateSqlForPostgres(sql);
    return translateParameters(translated);
  }

  /** Execute a script (possibly multi-statement, no parameters). */
  async exec(sql) {
    const client = this.requireClient();
    const { text } = this.prepareSql(sql);
    try {
      return await client.query(text);
    } catch (err) {
      throw this.wrapError(err, text);
    }
  }

  /**
   * Prepare a statement. Mirrors the SQLite dialect's `.run()/.get()/.all()`
   * surface, but every method returns a promise — PostgreSQL is inherently
   * async, and pretending otherwise would be a lie callers must later unwind.
   */
  prepare(sql) {
    const { text, parameterCount } = this.prepareSql(sql);
    const client = () => this.requireClient();
    const wrap = (err) => this.wrapError(err, text);

    return {
      text,
      parameterCount,
      async run(...params) {
        try {
          const res = await client().query(text, params);
          return { changes: res.rowCount ?? 0, rows: res.rows ?? [] };
        } catch (err) { throw wrap(err); }
      },
      async get(...params) {
        try {
          const res = await client().query(text, params);
          return res.rows?.[0] ?? undefined;
        } catch (err) { throw wrap(err); }
      },
      async all(...params) {
        try {
          const res = await client().query(text, params);
          return res.rows ?? [];
        } catch (err) { throw wrap(err); }
      },
    };
  }

  /** Scalar convenience: first column of the first row. */
  async scalar(sql, ...params) {
    const row = await this.prepare(sql).get(...params);
    return row ? Object.values(row)[0] : undefined;
  }

  // -- transactions ---------------------------------------------------------

  async begin() {
    const client = this.requireClient();
    if (this.inTransaction) throw new PostgresDialectError('transaction already open', 'PG_NESTED_TRANSACTION');
    await client.query('BEGIN');
    this.inTransaction = true;
  }

  async commit() {
    const client = this.requireClient();
    if (!this.inTransaction) throw new PostgresDialectError('no open transaction to commit', 'PG_NO_TRANSACTION');
    await client.query('COMMIT');
    this.inTransaction = false;
  }

  async rollback() {
    const client = this.requireClient();
    if (!this.inTransaction) return; // rolling back nothing is not an error
    await client.query('ROLLBACK');
    this.inTransaction = false;
  }

  /** Run fn inside a transaction, rolling back on any throw. */
  async transaction(fn) {
    await this.begin();
    try {
      const result = await fn(this);
      await this.commit();
      return result;
    } catch (err) {
      await this.rollback();
      throw err;
    }
  }

  /** Execute many statements in one transaction. */
  async batch(statements) {
    return this.transaction(async () => {
      const results = [];
      for (const stmt of statements) {
        if (typeof stmt === 'string') results.push(await this.exec(stmt));
        else results.push(await this.prepare(stmt.sql).run(...(stmt.params || [])));
      }
      return results;
    });
  }

  backup() {
    throw new PostgresDialectError(
      'In-process backup is a SQLite-specific capability. For PostgreSQL use pg_dump / pg_basebackup ' +
      'and record the artefact hash externally.',
      'PG_BACKUP_UNSUPPORTED',
    );
  }

  async close() {
    if (!this.client) return;
    try {
      if (this.inTransaction) await this.rollback();
      if (typeof this.client.end === 'function') await this.client.end();
    } finally {
      this.client = null;
      this.inTransaction = false;
    }
  }

  sqlString(value) {
    // PostgreSQL uses single-quoted literals with doubled quotes
    return `'${String(value).replaceAll("'", "''")}'`;
  }
}
