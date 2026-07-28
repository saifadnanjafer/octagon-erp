// SQL portability layer — Checkpoint G.
//
// Checkpoint F recorded PostgreSQL as BLOCKED BY IMPLEMENTATION: the dialect
// was a stub whose every method threw, and the schema used SQLite-only syntax
// in 297 places (`STRICT`), plus AUTOINCREMENT, INSERT OR REPLACE, PRAGMA and
// sqlite_master.
//
// The mission asks for ONE coherent strategy rather than hand-porting sixty
// migrations. This is that strategy: a migration SQL transformer applied at
// execution time by the PostgreSQL dialect. Migrations 001-060 keep their
// SQLite text unmodified and unversioned; the adapter translates on the way to
// the server. Migrations from 061 onward are additionally written
// dialect-neutral so the debt stops growing.
//
// SCOPE HONESTY. This module is a mechanical translator, not a semantic
// equivalence proof. It handles the constructs actually present in this
// schema, and `auditSqliteOnlyConstructs()` reports anything it recognises but
// cannot translate, so an untranslatable construct surfaces as a finding
// instead of a silent runtime error. Nothing here has been executed against a
// live PostgreSQL server — see
// docs/evidence/checkpoint-g-release-closure/postgresql-adapter-and-runtime.md

'use strict';

// ---------------------------------------------------------------------------
// Statement translation
// ---------------------------------------------------------------------------

// `... ) STRICT;`  ->  `... );`
// SQLite's STRICT enforces column type affinity. PostgreSQL enforces types
// natively, so dropping the keyword preserves the intent exactly.
function stripStrict(sql) {
  return sql.replace(/\)\s*STRICT\s*(?=;|$)/gim, ')');
}

// SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` -> PostgreSQL identity column.
function translateAutoincrement(sql) {
  return sql.replace(
    /\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
    'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
  );
}

// `INSERT OR IGNORE INTO x ...`      -> `INSERT INTO x ... ON CONFLICT DO NOTHING`
// `INSERT OR REPLACE INTO x ...`     -> flagged; a faithful translation needs
//                                       the conflict target, which is not
//                                       derivable from the text alone.
function translateInsertOr(sql) {
  return sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
}

function appendOnConflictDoNothing(sql, original) {
  if (!/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(original)) return sql;
  if (/\bON\s+CONFLICT\b/i.test(sql)) return sql;
  return sql.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING;');
}

// SQLite type names that PostgreSQL does not know.
function translateTypes(sql) {
  return sql
    .replace(/\bTEXT\s+PRIMARY\s+KEY\b/gi, 'TEXT PRIMARY KEY')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ')
    .replace(/\bBLOB\b/gi, 'BYTEA');
}

/**
 * Translate one SQLite statement (or script) into PostgreSQL-compatible SQL.
 * @param {string} sql
 * @returns {string}
 */
export function translateSqlForPostgres(sql) {
  if (typeof sql !== 'string' || sql.length === 0) return sql;
  const original = sql;
  let out = sql;
  out = stripStrict(out);
  out = translateAutoincrement(out);
  out = translateInsertOr(out);
  out = appendOnConflictDoNothing(out, original);
  out = translateTypes(out);
  return out;
}

// ---------------------------------------------------------------------------
// Parameter translation
// ---------------------------------------------------------------------------

/**
 * Convert SQLite positional `?` placeholders to PostgreSQL `$1..$n`.
 *
 * String literals, dollar-quoted blocks, and `--` / block comments are skipped
 * so a `?` inside text is never renumbered.
 *
 * @param {string} sql
 * @returns {{text: string, parameterCount: number}}
 */
export function translateParameters(sql) {
  let out = '';
  let index = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Single-quoted literal (SQL escapes '' inside).
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // Double-quoted identifier.
    if (ch === '"') {
      const j = sql.indexOf('"', i + 1);
      const end = j === -1 ? sql.length - 1 : j;
      out += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // Line comment.
    if (ch === '-' && next === '-') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? sql.length : j;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Block comment.
    if (ch === '/' && next === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j === -1 ? sql.length : j + 2;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '?') {
      index += 1;
      out += `$${index}`;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return { text: out, parameterCount: index };
}

// ---------------------------------------------------------------------------
// Static compatibility audit
// ---------------------------------------------------------------------------

// Constructs this schema uses, whether the translator handles them, and what a
// human must do when it does not.
export const COMPATIBILITY_RULES = [
  { id: 'STRICT', pattern: /\)\s*STRICT\b/i, translated: true, note: 'STRICT dropped; PostgreSQL enforces types natively' },
  { id: 'AUTOINCREMENT', pattern: /\bAUTOINCREMENT\b/i, translated: true, note: 'rewritten to GENERATED ALWAYS AS IDENTITY' },
  { id: 'INSERT_OR_IGNORE', pattern: /\bINSERT\s+OR\s+IGNORE\b/i, translated: true, note: 'rewritten to ON CONFLICT DO NOTHING' },
  { id: 'INSERT_OR_REPLACE', pattern: /\bINSERT\s+OR\s+REPLACE\b/i, translated: false, note: 'needs an explicit conflict target; rewrite by hand as INSERT ... ON CONFLICT (cols) DO UPDATE' },
  { id: 'PRAGMA', pattern: /\bPRAGMA\s+\w+/i, translated: false, note: 'no PostgreSQL equivalent; use information_schema / pg_catalog' },
  { id: 'SQLITE_MASTER', pattern: /\bsqlite_master\b/i, translated: false, note: 'use information_schema.tables / pg_catalog' },
  { id: 'SQLITE_DATE_FUNCS', pattern: /\b(datetime|julianday|strftime)\s*\(/i, translated: false, note: 'use PostgreSQL date/time functions' },
  { id: 'SQLITE_JSON_FUNCS', pattern: /\bjson_(extract|each|tree)\s*\(/i, translated: false, note: 'use PostgreSQL jsonb operators' },
  { id: 'ON_CONFLICT', pattern: /\bON\s+CONFLICT\b/i, translated: true, note: 'supported by PostgreSQL; requires a matching unique index' },
  { id: 'DATETIME_TYPE', pattern: /\bDATETIME\b/i, translated: true, note: 'rewritten to TIMESTAMPTZ' },
  { id: 'BLOB_TYPE', pattern: /\bBLOB\b/i, translated: true, note: 'rewritten to BYTEA' },
];

/**
 * Report which SQLite-only constructs a piece of SQL uses.
 * @param {string} sql
 * @returns {{id: string, translated: boolean, note: string}[]}
 */
export function auditSqliteOnlyConstructs(sql) {
  if (typeof sql !== 'string') return [];
  return COMPATIBILITY_RULES
    .filter((rule) => rule.pattern.test(sql))
    .map(({ id, translated, note }) => ({ id, translated, note }));
}

/**
 * Constructs present that the translator CANNOT handle. Non-empty means a human
 * must port that SQL before it can run on PostgreSQL.
 * @param {string} sql
 */
export function untranslatableConstructs(sql) {
  return auditSqliteOnlyConstructs(sql).filter((c) => !c.translated);
}
