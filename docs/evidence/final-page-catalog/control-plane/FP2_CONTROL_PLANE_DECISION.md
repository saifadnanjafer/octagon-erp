# FP-2 Control Plane — Decision Record (2026-07-31)

## Decision

The FP-2 Control Plane is delivered as **governed read projections over the
existing canonical authorities**, not as new backends. Fifteen canonical pages
are registered, permissioned, navigable, and tested; the four legacy surfaces
(`multi_entity`, `workflow`, `approvals`, `automation`, `deploy_ready`,
`security_center`, `integration_hub`) remain untouched and are scheduled for
FP-10 consolidation.

## Canonical authority map (verified against the repository, no duplicates)

| Page | Canonical backend | Surface |
|---|---|---|
| `module_pack_center` | `platform/control_plane/index.mjs` (existing, from `0c3c005`) | control-plane queries + control actions |
| `organization_center` | platform organization tables via control plane | companies / branches / data-scopes / localization |
| `identity_center` | platform identity tables via control plane | users / api-keys (prefixes) / sso |
| `permission_center` | authorization registry + governance evaluator | roles / permissions / scopes / explain |
| `authority_governance` | `platform/policies` (wired in `0c3c005`) | delegations / limits / sod / conflicts |
| `workflow_studio` | `platform/workflow` (wired in `0c3c005`) | definitions / instances |
| `approval_policy_studio` | `platform/approvals` (wired in `0c3c005`) | policies / worklist / counts |
| `automation_rules` | `platform/automation` (wired in `0c3c005`) | rules / runs |
| `configuration_center` | platform settings/sequences/flags | settings (secret=0) / sequences / flags |
| `customization_studio` | `platform/configuration` ConfigurationAuthority | custom-fields / view-schemas / saved-views / packages |
| `data_import_center` | `platform/data-exchange` DataExchangeService | import-jobs / import-rows |
| `integration_hub` | existing hub + appended governed section | integrations / api-keys / jobs |
| `audit_security_center` | `platform_audit_log` (read-only) | audit |
| `release_health` | control plane health/backups/jobs/overview | health / backups / jobs |
| `release_upgrade_center` | configuration packages + backups | packages / restore points |
| `commercial_control_center` | `platform_module_licenses` + registry | licensing / modules / overview |

## What is deliberately NOT built

- No second workflow/approval/automation/delegation engine.
- No second billing engine; no fabricated commercial meters (storage/AI/API
  allowances render `not_supported`).
- No mutation buttons where no canonical action exists (custom fields, saved
  views, commercial upgrades, package apply/rollback).
- No plaintext secrets anywhere (settings exclude `secret=1`; API keys show
  prefixes; identity rows are metadata-only — test-enforced).

## Recovery findings (interrupt takeover)

- The brief's premise (uncommitted governance wiring at `82082bd`) was stale:
  that slice was already committed and pushed as `0c3c005`. The actual dirty
  work was two page drafts with fake data, which were rewritten to real
  queries. Full account: `interrupted-session-recovery.md`.
- Two committed-state defects found and fixed: the positional `wirePage`
  silent no-op on Module & Pack Center, and the pre-existing migration
  manifest gap 067–083 (repaired through the governed manifest process).

## Test position

`tests/final-page-catalog/`: 95 tests, all passing (includes 6 suites of new
page tests: module pack center, customization studio, commercial control
center, FP-2D centers, FP-2E governance pages, FP-2F configuration/import,
FP-2G audit/release, plus wave2 wiring, governance wiring, page regression).
Migration suite 5/5, unit 9/9, precommit passes on every commit.

## Boundaries (honest)

- Browser smoke for the 15 new pages is **not** claimed in this session: the
  administrator credential was not used (per the owner constraint), and no
  synthetic-auth disposable launcher was validated for page-level screenshots.
  DOM/section/permission/query/dispatch behaviour is instead locked by 95
  tests. Recorded as risk R12; prior wave's Chromium evidence for the shell,
  kit, RTL/LTR, and mobile baseline stands.
- UI mutation actions whose backends exist but are not yet wired to page UI
  (workflow publish, approval policy create, delegation create, automation
  toggles, custom-field define) are deferred — the pages are read surfaces by
  design until those actions are wired (R9).
