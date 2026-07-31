# Octagon ERP — Final Page Catalog · Test Suite Register

**Branch:** `build/octagon-final-page-catalog`

## Suites run in this wave

| Suite | Command | Result |
|---|---|---|
| Final Page Catalog — Wave 2 wiring | `node --test --test-concurrency=1 "tests/final-page-catalog/wave2-wiring.test.mjs"` | **22 / 22 pass** |
| Final Page Catalog — page regression | `node --test "tests/final-page-catalog/page-regression.test.mjs"` | **17 / 17 pass** |
| Unit | `node --test --test-concurrency=1 "tests/unit/*.test.mjs"` | **9 / 9 pass** |
| Module Wave 1 | `node --test --test-concurrency=1 "tests/module-wave-1/**/*.test.mjs"` | pass |
| Module Wave 2 | `node --test --test-concurrency=1 "tests/module-wave-2/**/*.test.mjs"` | pass |
| **Consolidated** | all four above in one run | **128 tests, 128 pass, 0 fail** |

## Suites run in the FP-2 recovery slice (2026-07-31, this worktree)

| Suite | Command | Result |
|---|---|---|
| Final Page Catalog (all: wave2 wiring, governance wiring, module pack center, customization studio, commercial control center, page regression) | `node --test --test-concurrency=1 tests/final-page-catalog/*.test.mjs` | **69 / 69 pass** |
| Migration | `npm run test:migration` | **5 / 5 pass** |
| Unit | `npm run test:unit` | **9 / 9 pass** |
| Precommit | `node scripts/precommit.js` | **passed** |

The migration suite was red on entry for a pre-existing reason: manifests covered
only migrations ≤066 while 067–083 were on disk. Repaired through the governed
manifest process (`accepted-067-083-wave2.json`, 17 entries, real checksums and
source commits) — not by editing the test.

## New permanent tests added in the FP-2 recovery slice

| File | What it locks down |
|---|---|
| `tests/final-page-catalog/customization-studio.test.mjs` | Real empty state, custom-field/view-schema/saved-view round-trips through the canonical ConfigurationAuthority, out-of-scope company isolation, 404 on unknown resource. |
| `tests/final-page-catalog/commercial-control-center.test.mjs` | License round-trip via the real `control:license:set` action, overview counts, unlicensed-module derivation, cross-tenant license isolation, seeded-license integrity. |
| `tests/final-page-catalog/page-regression.test.mjs` (extended) | All 6 FPC pages held to the full standard: registration, controller `wirePage` literal-call pattern, shell loading, no legacy writers, no hardcoded KPI values. |

## Suites NOT run in this wave

`tests/phase02`, `tests/phase03`, `tests/phase04`, `tests/phase04-finalization`,
`tests/checkpoint-c` … `tests/checkpoint-h`, `tests/cutover`, `tests/migration`.

These start a full Octagon server and a Chromium instance and must run serially;
they were out of budget for this wave. Recorded as risk **R7**. Migration 083 is
additive (no business table is created, altered, or dropped), and the two
behaviour changes it makes — module status `available` → `installed`, and new
`platform_entities` rows — are the two things that broke four tests in the suites
that *were* run, both fixed.

## New permanent tests added

| File | What it locks down |
|---|---|
| `tests/final-page-catalog/wave2-wiring.test.mjs` | Wave 2 registry integrity, action execution, company scoping, filter whitelisting, secret redaction, disabled-module refusal. |
| `tests/final-page-catalog/page-regression.test.mjs` | The §79 defect classes: nav→page orphans, duplicate page/section ids, orphan view fragments, missing permissions, dangling permission keys, unscoped CSS, fake KPI values, missing bidi isolation, mobile touch targets. |

## Tests repaired (pre-existing failures)

| File | Was | Now |
|---|---|---|
| `tests/module-wave-1/crm/migration.test.mjs` | Pinned `066` as the migration tip; positional `steps: 2` rollback; exact-set re-apply assertion. | Ordering assertions and an explicit rollback `target`. |
| `tests/module-wave-1/crm/activity-unification-migration.test.mjs` | Positional `steps: 1` rollbacks; exact-set assertions. | Explicit `target: 065`; first-migration assertions. |
| `tests/module-wave-2/rental/rental.test.mjs` | Asserted module status `available`. | `installed`, with the reason recorded inline. |
| `tests/module-wave-2/subscriptions/subscriptions.test.mjs` | Asserted module status `available`. | `installed`, with the reason recorded inline. |

Both CRM files were **already failing on the Wave 2 baseline** (`237febe`) before
this wave touched anything — verified by running them in the
`octagon-module-expansion-wave-2` worktree.
