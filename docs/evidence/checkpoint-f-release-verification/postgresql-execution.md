# Checkpoint F — PostgreSQL execution

**Result: BLOCKED BY IMPLEMENTATION.** No PostgreSQL proof is claimed, and none
was fabricated.

## Availability

No PostgreSQL binaries on PATH — `psql`, `pg_ctl` and `postgres` are all
absent; `psql --version` is not runnable. No isolated disposable database could
be created.

## The stronger finding — the adapter does not exist

Environment availability turns out to be moot.
`database/dialects/postgres-dialect.mjs` is a 38-line **fail-closed stub**.
Every method throws:

```
open()    -> 'PostgreSQL dialect is not yet configured in Phase 01. ...'
exec()    -> 'PostgreSQL dialect is not yet configured in Phase 01.'
prepare() -> 'PostgreSQL dialect is not yet configured in Phase 01.'
close()   -> ...
backup()  -> ...
```

Only `sqlString()` is implemented. **Even with a running PostgreSQL server the
migration chain could not execute.**

The stub is well-behaved — it fails closed rather than silently mutating
anything — but the claim "PostgreSQL-compatible SQL design" is not currently
supportable.

## Static dialect review

All 60 migrations scanned:

| Pattern | Occurrences | PostgreSQL compatibility |
|---|---|---|
| `STRICT` table modifier | **297** across 47 migrations | **SQLite-only.** Not valid PostgreSQL. Every one is a required change. |
| `ON CONFLICT ... DO UPDATE` | 138 | Compatible, but each needs a matching unique index |
| `INSERT OR REPLACE` | 1 | **SQLite-only.** Rewrite as `INSERT ... ON CONFLICT DO UPDATE`. |
| `AUTOINCREMENT` | 1 | **SQLite-only.** Use `GENERATED ... AS IDENTITY` / `BIGSERIAL`. |
| `PRAGMA table_info` | present | **SQLite-only.** Use `information_schema.columns`. |
| `sqlite_master` | 3 | **SQLite-only.** Use `pg_catalog` / `information_schema`. |
| `datetime()`, `julianday()`, `strftime()` | **0** | Favourable — no SQLite date functions to port |

The absence of SQLite date functions is genuinely good news: timestamps are
handled in application code as ISO strings. The blocker is `STRICT`, at 297
occurrences.

## No forward correction attempted

Rewriting 297 `STRICT` declarations would be a schema-wide change to historical
migrations with no way to execute the result — unverifiable churn that risks the
working SQLite install. Historical migrations must not be rewritten to make a
claim pass.

**Recommendation:** treat PostgreSQL support as unstarted work deserving its own
checkpoint — implement the adapter, add a dialect conformance test, then port
the schema behind it.
