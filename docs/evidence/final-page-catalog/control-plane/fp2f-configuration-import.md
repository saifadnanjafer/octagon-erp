# FP-2F — Configuration Center / Data Import Center (2026-07-31)

Status: two governed read surfaces, wired end-to-end.

## configuration_center

- Tabs: Settings, Numbering Sequences, Feature Flags.
- Resources: `settings` (secrets excluded at SQL level — `WHERE secret=0`),
  `numbering-sequences`, `feature-flags`.
- Real facts on fresh install: 1 non-secret setting, 0 sequences, 1 flag.
- Inherited-vs-override per-scope values, terminology, themes, and secret
  references have no canonical read resources; not faked. Deferred.

## data_import_center

- Tabs: Import Jobs, Row-level Results (per-job drill).
- New read resources added to `handleControlPlaneQuery`: `import-jobs` and
  `import-rows/<id>` over the canonical DataExchangeService store
  (`import_jobs` / `import_rows`). Read-only; imports execute through the
  service's ActionExecutor path, never through this dispatch.
- Row-level errors are first-class: test 4 proves a rejected row appears as a
  failed row with its error message — no silent row drop.
- Idempotent replay is the service's own (`idempotency_key` → duplicate
  marker), tested in the data-exchange domain suite, not duplicated here.
- Upload/mapping UI remains the legacy import wizard; this page is the
  governed jobs/evidence surface.

## Tests

`tests/final-page-catalog/fp2f-configuration-import.test.mjs` (5 tests,
disposable DB): secret-free settings, honest empty sequences, real feature
flags, dry-run import served by import-jobs, failed-row visibility, honest
empty job list.
