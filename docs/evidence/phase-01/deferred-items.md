# Phase 01 Deferred Items

**Phase:** 01  
**Date:** 2026-07-21  

---

## Deferred to Phase 02 — Identity, permissions, settings, workflow

- Full role administration and role-membership table.
- Field-level ACL and record rules/data scopes.
- Delegation and approval-center behavior.
- SSO, MFA, API-key management, and credential policy.
- Full tenant provisioning UI and seat counting.
- Settings override resolution per company/user/branch.
- Feature-flag `tenant`, `branch`, and `user` scope resolution.
- Final workflow designer and durable approval execution.
- Permission audit trail (denied checks written to `platform_audit_log`).

## Deferred to Phase 06/08 — Commercial packaging and vertical packs

- Pack SDK vertical expansion (workshop, retail POS, etc.).
- Commercial licensing, subscriptions, seats, billing, and provisioning.
- Public SaaS onboarding.
- Full entitlement enforcement and edition packaging.

## Deferred to Phase 07 — Final UI

- Metadata renderer and form builder.
- Responsive grid system and accessibility pass.
- Full Studio UX and view patch merge rules.
- Arabic RTL final polish beyond preserved localization keys.

## Deferred to later domain phases — Business modules

- Accounting posting, taxes, payments, reconciliation.
- Stock valuation, reservations, inventory movements.
- Sales, procurement, manufacturing, projects, assets, maintenance.
- Payroll, attendance, HR records, POS, portals, e-commerce, MES, quality.
- Unrestricted no-code entity creation.

## Deferred technical work

- PostgreSQL dialect production testing and migration.
- Durable outbox worker topology and external webhooks.
- Credential vault and integration credentials.
- Support bundle export and SLO dashboards.
- Full browser automation test suite.
- Distributed concurrency stress tests.

## Missing donor paths

- `erp-research/frappe-develop` — Frappe source missing locally; Frappe-derived behavior inferred from available references or deferred.
- `erp-research/yudao-ui-admin-vue3-master` — RuoYi frontend missing locally; inferred from backend or deferred.

## Frozen zones

- Payroll calculations and Iraqi payroll behavior.
- Attendance source and smart timesheet behavior.
- Employee records required by payroll.
- Existing `account_moves`, `employee_payroll_closings`, `payroll_periods`, `payroll_payments`, `payroll_adjustments` collections as authoritative write targets.

---

## Next review

This list must be reviewed at the start of Phase 02 and each subsequent phase.
