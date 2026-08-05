# Known Limitations — Octagon ERP Review Freeze 1

Only limitations verified during construction of this review package are listed
here. Nothing in this document is a UI/UX finding — those belong in
`FUNCTIONAL_REVIEW_MATRIX.md` / `UI_UX_AUDIT_MATRIX.md` via `BUG_REPORT_TEMPLATE.md`.

## Intentionally simulated integrations

- **Billing is simulation-only.** Review fixtures include a `saas_simulated_invoices`
  row explicitly labelled "SIMULATION / NO EXTERNAL CHARGE / NO GL POSTING". No
  payment provider is contacted anywhere in this environment.
- **Marketing publishing is simulation-only.** Content fixtures carry
  `[SIMULATED CONTENT - never sent to any real recipient]`. No email/SMS/social
  provider is contacted.
- **Event communication is simulation-only.** No registration confirmation,
  reminder, or check-in notification leaves this environment.

## Unsupported/inactive external providers

- No real payment gateway, email/SMS provider, or third-party marketing/events
  platform is configured or reachable from the review environment. Any "send" or
  "charge" action a reviewer triggers is expected to complete against a local
  simulation only — if it appears to reach an external system, that is itself a
  P0 finding.

## AI behavior

- The AI governance model requires human review before a proposal can take
  effect: proposal creation, approval, rejection, and withdrawal are separate,
  independently permissioned actions (`ai:proposal_create` /
  `ai:proposal_approve` / `ai:proposal_reject` / `ai:proposal_withdraw`), and
  review fixtures include one proposal awaiting review, one approved, and one
  rejected specifically so reviewers can exercise that boundary. Reviewers
  should treat "does the AI ever mutate data without an approved proposal?" as
  an open question to test, not an assumed guarantee — file a P0 security-scope
  finding if it does.

## Technical limitations — permission enforcement visibility

- **`authorization_route_coverage` is empty (0 rows) in this build.** Nothing in
  `server.js` or `platform-runtime-bridge.mjs` calls `routeCoverage.register()`
  at boot, so this table — which exists specifically to let tooling verify
  "every route has a declared permission" — currently registers none. This is
  a genuine gap in *server-side, table-declared* route/permission tracking, not
  something the review environment can paper over.
  `docs/review/PAGE_INVENTORY.md` therefore uses the client-side
  `PAGE_PERMISSIONS` gate in `services/permissionService.js` as the effective
  "required permission" per page instead. That gate controls what the UI shows
  a role — it is **not proof that the server independently re-checks the same
  permission on every underlying API call**. Reviewers signed in as
  `review.viewer` or `review.isolation_viewer` should specifically try
  triggering a write action whose button the UI hides, via a role that
  shouldn't have it, and confirm the server rejects it — do not assume the
  client-side hiding is backed by a server check. Treat any case where it
  isn't as a P0 security-scope finding.

## Review-only demo-data limitations

- **Events schema has no literal "approved" or "no-show" state.**
  `build12_events.status` only allows `draft|published|ongoing|completed|cancelled`
  and `build12_event_registrations.status` only allows
  `registered|waitlisted|checked_in|cancelled`. The "approved event" fixture
  uses `status='published'` as the nearest equivalent; the "no-show" fixture uses
  a `registered` (never checked-in) registration on an event whose end time has
  already passed. If the product is meant to have distinct approved/no-show
  states, that is a genuine product gap to raise separately — it is not
  something this review package could paper over with fixture data alone.
- **Al-Warsha pack has no "role template" table.** The spec asked for a role-
  template fixture; `build12_pack_profiles` / `build12_pack_installations` have
  no table or column for it (only terminology overlay, workflow templates,
  readiness categories, and KPI profile). No role-template row was fabricated.
  If role templates are an expected Al-Warsha capability, that is a product gap
  to raise separately.
- **People Development fixtures attach to review user identities, not a
  separate `employees` row.** `employees`, `employee_advances`, and all
  payroll/attendance/timesheet tables are a read-only frozen zone per this
  repository's governance notes (`CLAUDE.md`). People Development demo records
  reference `usr_review_people_manager` / `usr_review_employee_self_service`
  instead of inventing or touching an employee record.
- Every review-fixture row and identity is prefixed `rev_`/`review.` and
  labelled `[DEMO]` specifically so it is never mistaken for real data. If a
  reviewer sees anything in the review environment that looks like real
  customer, financial, or personal data, stop and report it as a P0
  security-scope finding rather than a content finding — it may indicate the
  disposable-database guards were bypassed.

## Technical limitations

- `npm run review:start` logs a harmless `❌ No valid snapshot found to recover
  database.json` line on every boot. This is expected: the review environment
  deliberately has no legacy `database.json` mirror (it runs on the canonical
  SQLite store only), so the server's legacy auto-recovery step finds nothing
  to recover and says so. It is not an error and requires no action.
- The disposable review database only boots correctly because `review:setup`
  writes a `cutover_staged_fixture` marker row proving it is disposable to
  `database/migration-runner/startup-policy.mjs`'s identity classifier. A
  database file copied or renamed outside of `review:setup`/`review:reset`
  will very likely be refused at boot ("database identity unknown; failing
  closed") — always use the provided npm scripts rather than copying
  `.review-data/octagon-review.db` by hand.
- During construction of this review package, an earlier version of
  `review:start` was found to import the *real* operational backup file
  (`database.backup.scheduler.*.json`, present in the repository root) into
  the disposable review database, because the server's legacy backup-recovery
  step defaults its search directory to the repository root unless overridden.
  This was fixed (`review:start` now pins `OCTAGON_BACKUP_DIR` to an empty,
  review-scoped directory and clears any stray `database.json`/`.prev` before
  boot) before any review data was ever exposed to a reviewer. Documented here
  for transparency, not because it remains a live risk.

## Capability closure deferred

- **BUILD-13 is not started.** Any functionality gap a reviewer identifies as
  "missing" rather than "broken" belongs in `REVIEW_SUMMARY_TEMPLATE.md`'s
  "Recommended BUILD-13 scope" field, not a bug report.
- **BUILD-14 and beyond** are out of scope for this review entirely.

## Production-readiness items outside functional review

- This snapshot is **not a production deployment**. It has no TLS termination,
  no production secrets, no monitoring/alerting wiring, and no production
  database — none of that is being evaluated here.
- Real credentials and real external providers are never activated anywhere in
  this review environment.
- Review data is fully disposable: `npm run review:reset` destroys and
  regenerates it deterministically at any time, with zero effect on any
  operational system.
