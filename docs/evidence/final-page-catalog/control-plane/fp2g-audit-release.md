# FP-2G — Audit & Security Center / Release Health / Release & Upgrade Center / Integration Hub upgrade (2026-07-31)

Status: three new governed read surfaces + one existing-page upgrade, wired end-to-end.

## audit_security_center

- Read-only projection over `platform_audit_log` via `control-plane/audit`
  (last 150 entries, tenant-scoped).
- Filter strip: all / failures / governance / configuration / modules.
- No update/delete surface exists in the dispatch — asserted by test 2
  (`audit/delete` → 404).
- Audit entries are seeded by real authorities (test 1 proves a
  ConfigurationAuthority mutation lands in the served log).

## release_health

- Tabs: Module Health, Backups, Background Jobs (+ real KPI strip from
  `overview`).
- Resources: `health`, `backups`, `jobs`, `overview`.
- Unknown stays unknown: health rows carry only measured states
  (`healthy`/`warning`/`blocked`); zero backups renders an explicit warning,
  never a green checkmark.

## release_upgrade_center

- Tabs: Configuration Packages, Restore Points.
- Resources: `packages`, `backups`.
- Production execution is blocked by design: the page offers no apply/
  rollback action and displays an explicit owner-authorization notice.

## integration_hub (upgrade, not duplicate)

- The existing hub (WhatsApp/email/webhooks/service health, owned by legacy
  modules) is untouched.
- `modules/fpc-integration-hub-governance.js` wraps `switchPage` and appends
  ONE governed section to the existing `integrationHubBody`: SSO providers,
  API keys (prefixes only — no plaintext secrets), background jobs — all from
  the canonical control-plane resources. Idempotent (section id guard) and
  fail-contained (a section failure renders an error inside the section,
  never breaks the legacy hub).

## Tests

`tests/final-page-catalog/fp2g-audit-release.test.mjs` (6 tests, disposable
DB): audit trail visibility for a real authority mutation, read-only audit
dispatch, measured-only health states, honest empty backups, real package
visibility, and the three hub resources serving honest scoped data.
