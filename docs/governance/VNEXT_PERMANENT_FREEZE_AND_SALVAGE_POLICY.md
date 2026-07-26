# VNext Permanent Freeze and Salvage Policy

**Owner decision date:** 2026-07-26

**Policy status:** ACTIVE

**Only product/runtime under development:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`

**Frozen salvage source:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp-commercial-vnext`

## Product decision

Original Octagon ERP is the only product, product repository, product shell, and
target runtime. VNext development is permanently stopped. VNext must not become
a second product, a replacement runtime, a parallel frontend, a parallel
server, or an independent roadmap target.

VNext is project-owned, read-only salvage material. It may be inspected to
recover useful project-owned code, migrations, tests, schemas, services, UI
patterns, and engineering evidence into original Octagon. No new feature, fix,
migration, branch, test, UI change, release, roadmap step, or runtime operation
may be developed in VNext for VNext itself.

## Salvage acceptance rule

Every salvaged file, function, class, schema, migration idea, test, or UI
component must receive source provenance in original Octagon. At minimum, the
record must identify:

- source repository, branch/commit, path, and symbol;
- project ownership or license;
- reuse mode and modifications;
- target Octagon file and canonical owner;
- migrations and compatibility work;
- permissions, company/branch scope, audit, and outbox behavior;
- tests and runtime/UI integration evidence.

A capability is not complete merely because it exists or passes tests in
VNext. It is accepted only after it is integrated into original Octagon's
runtime, canonical domain model, permission model, UI, migrations, tests,
reconciliation, and relevant rollback/idempotency gates.

## One-authority rule

Salvage must strengthen one canonical authority per business fact. It must not
introduce duplicate finance, stock, reservation, valuation, payment, payroll,
task, party, product, procurement, workflow, identity, licensing, audit, or
other governed write authorities.

## Frozen business-data boundary

Payroll, attendance, and timesheet data and behavior remain read-only. No VNext
salvage may write, migrate, replace, or reinterpret the frozen collections
defined by the workspace governance notice.

## Operational rule

Read VNext; write only in original Octagon. Do not delete or clean the VNext
repository. Existing VNext working-tree changes are preserved as found and are
not treated as instructions or as completion evidence.
