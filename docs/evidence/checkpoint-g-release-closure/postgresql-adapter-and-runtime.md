# Checkpoint G — PostgreSQL adapter and runtime

| | Result |
|---|---|
| **Adapter implementation** | **DONE** — `database/dialects/postgres-dialect.mjs` |
| **Portability layer** | **DONE** — `database/dialects/sql-portability.mjs` |
| **Adapter tests** | **22/22 pass** (`tests/checkpoint-g/postgres_adapter.test.mjs`) |
| **Runtime execution** | **NOT EXECUTED** |

## Runtime: not executed, and why

No PostgreSQL binaries are on PATH (`psql`, `pg_ctl`, `postgres` all absent),
and the `pg` driver is not a dependency of this project. No disposable database
was created, no migration chain was run against PostgreSQL, and no domain,
rollback or concurrency test touched a PostgreSQL server.

**The adapter has never executed a statement against a live PostgreSQL server.**
It is exercised against an injected fake client that records the statements it
receives, which proves translation, parameter binding, transaction sequencing
and error wrapping — and proves nothing about wire behaviour.

Do not read "adapter implemented" as "PostgreSQL supported".

## What changed from the stub

Checkpoint F found a 38-line stub whose every method threw
`'PostgreSQL dialect is not yet configured in Phase 01.'` — so PostgreSQL was
blocked by *implementation*, not merely by environment.

The adapter now provides: lazy driver loading (importing the module never
requires `pg`), connection handling, explicit `BEGIN`/`COMMIT`/`ROLLBACK` with
nested-transaction refusal, `transaction(fn)` that rolls back on any throw,
prepared statements with `.run()/.get()/.all()`, a scalar helper,
batch-in-transaction, capability reporting, error wrapping that carries the
failing SQL and the driver's own code, and `close()` that rolls back an open
transaction before releasing the client.

It still fails closed — but for an actionable reason. Without a connection
string it rejects with `PG_NO_CONNECTION_STRING`; without the driver it says
"run `npm install pg`, then set `OCTAGON_POSTGRES_URL`" instead of "this dialect
does not exist".

## The portability strategy

The mission asked for **one coherent strategy** rather than hand-porting sixty
migrations. That strategy is a **migration SQL transformer applied at execution
time**: migrations 001–060 keep their SQLite text unmodified and unversioned;
the adapter translates on the way to the server. Migrations from 061 onward are
additionally written dialect-neutral so the debt stops growing.

| Construct | Handling |
|---|---|
| `STRICT` | **Stripped.** PostgreSQL enforces types natively, so the intent is preserved |
| `AUTOINCREMENT` | Rewritten to `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `INSERT OR IGNORE` | Rewritten to `INSERT ... ON CONFLICT DO NOTHING` |
| `DATETIME` | → `TIMESTAMPTZ` |
| `BLOB` | → `BYTEA` |
| `?` parameters | → `$1..$n`, correctly skipping string literals, `''` escapes, line and block comments |
| `ON CONFLICT` | Already compatible; needs a matching unique index |
| `INSERT OR REPLACE` | **Refused** — a faithful rewrite needs an explicit conflict target |
| `PRAGMA` | **Refused** — use `information_schema` / `pg_catalog` |
| `sqlite_master` | **Refused** — use `pg_catalog` |
| SQLite date functions | **Refused** — 0 occurrences in this schema |
| SQLite JSON functions | **Refused** — use `jsonb` operators |

Untranslatable constructs are **surfaced** by `untranslatableConstructs()` and
refused by the adapter **before the statement reaches the server**, rather than
silently mistranslated. Verified: `untranslatable SQL is refused before it
reaches the server` asserts zero queries were sent.

## The 297-STRICT blocker

Verified across the **real schema, not a sample**: every migration file
containing `STRICT` (**47 files, 297+ occurrences**) is STRICT-free after
translation. This is the single largest portability blocker Checkpoint F
recorded, and it is now handled mechanically rather than by rewriting history.

## Static compatibility audit

`COMPATIBILITY_RULES` encodes 11 constructs with a `translated` flag and an
actionable note each; every rule is asserted to carry a note longer than a
label. `auditSqliteOnlyConstructs(sql)` reports what a given statement uses.

## To complete the runtime proof

1. `npm install pg`
2. Provision an isolated disposable PostgreSQL database
3. Set `OCTAGON_POSTGRES_URL`
4. Run the full migration chain through the adapter
5. Run representative domain, rollback and concurrency tests
6. Destroy the disposable database

Steps 1–3 are environment work this checkpoint could not perform.
