# Checkpoint H — PostgreSQL runtime result

# RESULT: NOT EXECUTED — ENVIRONMENT UNAVAILABLE

Re-checked once at Checkpoint H, per mission section 23. Nothing changed since
Checkpoint G.

| Probe | Result |
|---|---|
| `psql`, `pg_ctl`, `postgres`, `initdb` on PATH | **none** |
| `import("pg")` | **not installed** |
| `OCTAGON_POSTGRES_URL` | **unset** |
| TCP 127.0.0.1:5432 | **closed** |

No disposable PostgreSQL database was created, no migration chain was run, and
no domain, rollback or concurrency test touched a PostgreSQL server.

Per the mission: no arbitrary external software was installed, and no
operational infrastructure was used.

## What remains proven

The adapter and portability layer are implemented and unit-tested:
`tests/checkpoint-g/postgres_adapter.test.mjs` — **22/22**, including that
every `STRICT` declaration in the real schema (47 files, 297+ occurrences) is
translatable, and that untranslatable constructs are refused before reaching a
server rather than silently mistranslated.

## How this is reported

`GET /api/release/health` reports two SEPARATE signals:

- `postgres_adapter` -> **healthy** (implemented, unit-tested)
- `postgres_runtime` -> **not_executed** (never green)

A regression test asserts the runtime signal can never be healthy and cannot
inherit green from the adapter signal. The distinction is enforced by test, not
by convention.

## To complete

1. `npm install pg`
2. Provision an isolated disposable PostgreSQL database
3. Set `OCTAGON_POSTGRES_URL`
4. Run the migration chain through the adapter
5. Run representative Identity, Product, Inventory, Sales, Manufacturing,
   Finance and Asset workflows, plus rollback and concurrency
6. Destroy the disposable database

Steps 1-3 are environment work this checkpoint could not perform.
