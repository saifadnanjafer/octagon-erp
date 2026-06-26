# Octagon ERP Master Completion Roadmap

**Date:** 2026-06-26  
**Prepared for:** Saif  
**Scope:** Planning and roadmap only. No feature implementation was performed.  
**Repository:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`  
**Baseline inspected:** Phase 6H local auth hardening and 86/86 permission mapping, plus one uncommitted `app.js` delta.

---

## 2026-06-26 Status Addendum

Phase 7D Report Designer and Smart Views is now implemented inside the existing `nl_reports` page, without adding sidebar pages. The slice adds saved report definitions, smart-view column filters, role-group access metadata, Arabic print layout, CSV/JSON/Excel client exports, and a disabled scheduler placeholder under `omni.nlReports`. AI drafting remains read-only and only proposes report-definition wording.

Current next queue item after Phase 7D is Phase 7D-FleetDemo Fleet Fuel Guard Presentation Foundation, then Phase 7E SaaS Productization Foundation. Fleet/Fuel Guard is a customer-demo planning vertical only at this stage: no hardware integration, no sidebar pages, no route baseline changes, and no `database.json` mutation.

---

## 1. Executive Summary

Octagon ERP is already a large Arabic-first, AI-first, local-first ERP with a real operating base: payroll, finance, cashbox, banking, inventory, workshop operations, MRP, QC, documents, legal print drafts, AI/Jarvis, role permissions, industry shells, and diagnostics. Static inspection and safe validation on 2026-06-26 found 86 sidebar pages, 86 view templates, 86 `views/*.html` files, 86/86 page permission coverage in the regression harness, and a 35/35 permission regression pass.

The system is not yet a commercial-grade ERP product. It still needs production authentication, server/session hardening, deployment discipline, reporting/BI, financial statements, advanced inventory, deeper HRMS, mobile/PWA workflows, governed AI business agents, SaaS product packaging, implementation methodology, integration foundations, and vertical sample data/depth.

The next development phase should not add random sidebar pages. Most missing capabilities should be built inside existing pages, as sub-tabs, shared services, reports, approval workflows, PWA views, integration connectors, or AI agents. New pages should be reserved for unavoidable platform centers only after the core product is stable.

The first required action before feature expansion is stabilization: commit or deliberately park the current `app.js` change, add remote backup, complete production-grade server authentication/session handling, and harden audit/backup/release controls.

---

## 2. Current System Baseline

### Current Git State

| Item | Current value |
|---|---|
| Branch | `master` |
| HEAD | `9587518 phase6h local auth hardening and permission mapping` |
| Recent commits | `9587518`, `c261824`, `ae8e614` |
| Remote | none configured (`git remote -v` returned empty) |
| Uncommitted tracked files | `app.js` |
| Untracked planning file | `OCTAGON_MASTER_ERP_COMPLETION_ROADMAP.md` |
| Current `app.js` diff | 1 file, 80 insertions |

Risk note: the earlier "73 modified files" risk is not present in the inspected worktree. The current risk is narrower but still important: the repo has only three local commits, no remote backup, and an uncommitted `app.js` delta.

### Safe Validation Run

| Check | Result |
|---|---|
| `node --check app.js` | PASS |
| `node --check server.js` | PASS |
| `node --check services/permissionService.js` | PASS |
| `node scripts/permission-regression.mjs` | PASS, 35/35 |
| `database.json` parse | PASS, parsed during static schema inspection |

### Static Route and Code Baseline

| Metric | Value |
|---|---|
| Sidebar `data-page` buttons | 86 unique / 86 total |
| View manifest markers | 86 unique |
| `views/*.html` files | 86 |
| JS modules in `modules/` | 53 |
| JS services in `services/` | 8 |
| `app.js` size | 34,870 lines |
| `app.js` named functions | about 1,320 |
| `app.js` render functions | about 205 |
| Regression-mapped sidebar pages | 86/86 |
| Action permission inventory | populated; 24 explicit action permission keys detected statically |
| `database.json` top-level keys | `employees`, `finance`, `omni`, `config`, `selectedEmpIdx`, `reportEmpIdx`, `audit_log`, `journals` |
| `omni` top-level keys | 86 |

### Current Data Snapshot

| Data area | Current record count / note |
|---|---|
| Employees | 21 |
| Finance accounts | 13 |
| Journals | 5 |
| `omni.users` in file | 0; runtime-seeded locally |
| `omni.roles` in file | 3; runtime-expanded locally |
| Equipment | 39 |
| Machines | 7 |
| Materials | 8 |
| Work orders | 3 |
| BOMs | 7 |
| SOPs | 5 |

### Current Known Feature Modules

Existing coverage includes payroll, attendance, timesheet, employees, finance, cashbox, income/expenses, customers, receipts, banking, AR/AP, budgeting, tax compliance, chart of accounts surface, inventory, storage locations, procurement, projects, sales, POS, approvals, Command Center, assets, maintenance, documents, legal print kit, fleet/logistics, rental, warranty/RMA, multi-entity, risk compliance, security center, data quality, AI/Jarvis, AI tools/factory/status/queue, workshop operations, work orders, MRP, QC/rework, machines, task management, SOP, employee mobile, workshop TV, kiosk, and vertical shells for pharmacy, retail, clinic, restaurant, real estate, and hotel.

### Highest Current Risks

- No server-side production authentication/session model.
- No remote Git backup; local disk remains a single point of failure.
- `app.js` is huge and currently has an uncommitted 80-line delta.
- `database.json` contains runtime seed gaps (`omni.users: []`) that depend on client/runtime normalization.
- Report Designer, financial statements, close management, and BI are not mature enough for commercial accounting usage.
- Industry verticals exist as pages but need sample data, workflow depth, and commercial packaging.
- AI/Jarvis has strong foundations but needs a governed agent catalog with explicit tool boundaries and approval routes.
- Current product is ready for roadmap-driven feature expansion only after Phase 7A stabilization.

---

## 3. Benchmark Lessons

### Arabic / Regional ERP Lessons

Alameen shows the importance of mature Arabic accounting, warehouse depth, POS reliability, commission handling, inventory batch/expiry/min-max, dashboards, and Arabic printable financial reports.

Daftra shows the importance of SaaS packaging: plans, trials, demo company mode, mobile approvals, cloud UX, e-commerce connectors, app marketplace, HR modules, POS, installments, commissions, and smart commercial packaging.

### Global ERP Lessons

NetSuite shows suite architecture, single source of truth, multi-company/global accounting, consolidation, SuiteApp extensibility, developer platform, vertical editions, and close management.

Microsoft Dynamics 365 shows process agents, finance agents, reconciliation agents, sales agents, project operations, field service, CRM depth, and modular enterprise apps.

SAP Cloud ERP shows standardized core processes, implementation methodology, integration platform, procurement/supply-chain/manufacturing depth, compliance, finance controls, and go-live playbooks.

Workday shows HRMS/HCM depth, workforce planning, employee experience, HR service delivery, talent/performance, planning, contract intelligence, frontline mobile operations, and governed AI actions.

---

## 4. Existing Strengths

- Strong local-first ERP shell with 86 routed pages and working lazy-loaded views.
- Arabic-first operational UX and document printing direction.
- Real workshop/manufacturing core: machines, equipment, work orders, BOMs, QC, MRP, and shop-floor views.
- Finance and accounting foundations: cashbox, income, expenses, banking, AR/AP, budgeting, accounts, journals, and reconciliation metadata.
- Governance foundations: permission service, page/action policies, regression harness, Security Center, risk compliance, data quality.
- AI foundations: Jarvis assistant, brain/tools, voice runtime, system map, action agent, AI governance, AI queue/factory/tools/status.
- Legal and admin foundations: document center, contract/rules print drafts, e-sign page, approvals, command center, audit log patterns.
- Existing vertical entry points that can be deepened without adding duplicate pages.

---

## 5. Major Missing Layers

1. Production server authentication and session security.
2. Remote backup/version control and release discipline.
3. SaaS productization: plans, licensing, trials, demo mode, feature flags, onboarding.
4. Report Designer, saved smart views, executive dashboards, scheduled reports, financial statements.
5. Mobile/PWA suite for managers, employees, inventory, POS, field service, and expenses.
6. Governed Jarvis agent catalog with dry-run, approval, audit, and current-user enforcement.
7. HRMS completion: contracts, onboarding, offboarding, leave, performance, discipline, custody, workforce planning.
8. Finance close and planning: month-end close, period locks, statements, aging, cash forecast, cost centers, budgets, consolidation.
9. Advanced inventory and supply chain: serial/lot/batch, expiry, min/max, reservations, stock count, landed cost, kits.
10. Commercial sales/POS: commissions, targets, installments, price lists, loyalty, quote-contract-order lifecycle, customer portal.
11. Advanced workshop/manufacturing: production costing, capacity planning, scheduler, advanced MRP, QC analytics, event/project production.
12. Platform ecosystem: plugin registry, marketplace, developer API, webhooks, integration hub.
13. Legal/compliance deepening: contract lifecycle, contract intelligence, compliance register, tax/e-invoicing profiles.
14. E-commerce/external connectors after API foundation.
15. Implementation methodology: setup wizard, templates, imports, opening balances, go-live checklist, training checklist.

---

## 6. Full Feature Backlog by Layer

| ID | Feature group | Priority | Recommended location |
|---|---|---|---|
| A1 | Plans and subscription tiers | P1 | Product/tenant settings + License Center |
| A2 | Trial/demo company mode | P1 | Tenant setting + demo data service |
| A3 | Tenant onboarding wizard | P1 | Existing `multi_entity` / Admin sub-tab |
| A4 | Feature flags | P0/P1 | Shared platform service |
| A5 | License/activation center | P1 | Existing Admin / deployment settings |
| B1 | Report Designer | P1 | Existing `report`, `analytics`, `nl_reports` |
| B2 | Smart lists / saved views | P1 | Shared table/view service |
| B3 | Executive dashboards | P1 | Existing `analytics` |
| B4 | Report scheduler | P2 | Shared background service + reports |
| B5 | Natural language report builder | P2 | Existing `nl_reports` + Jarvis agent |
| C1 | Manager mobile PWA | P1 | PWA view + approvals/dashboard |
| C2 | Employee self-service | P1 | Existing `employee_mobile` / `employee_ui` |
| C3 | Mobile inventory count | P1 | PWA view + inventory sub-tab |
| C4 | Mobile POS | P2 | Existing `pos` PWA mode |
| C5 | Mobile field service | P2 | Existing `field_service` PWA mode |
| C6 | Mobile expense capture | P2 | Existing `expenses` / PWA upload flow |
| D1 | Agent catalog | P2 | Existing AI pages + registry service |
| D2 | Agent permissions | P0/P2 | PermissionService + AI governance |
| D3 | Agent simulation/dry-run | P2 | AI queue + approval preview |
| D4 | Agent memory/context policy | P0/P2 | AI governance service |
| D5 | AI usage governance | P1/P2 | AI status/governance dashboards |
| E1 | Plugin registry | P3 | Integration Hub/Admin |
| E2 | App marketplace | P3 | New page only after product core stable |
| E3 | Developer API | P3 | Server/API layer + Integration Hub |
| E4 | Webhooks | P3 | Integration Hub |
| E5 | Integration hub | P3 | Existing `integration_hub` |
| F1-F13 | HRMS/HCM completion | P1/P2 | Existing `people_ops`, `employees`, `documents`, payroll pages |
| G1-G12 | Finance close/planning | P0/P1/P2 | Existing finance, banking, budgeting, AR/AP, reports |
| H1-H10 | Advanced inventory/supply chain | P1/P2 | Existing inventory/procurement/work orders |
| I1-I9 | Sales/CRM/POS commercial layer | P1/P2 | Existing sales, customers, POS, contracts, customer portal |
| J1-J8 | Manufacturing/workshop/MRP | P1/P2 | Existing work orders, machines, MRP, QC, projects |
| K1-K6 | Implementation/go-live | P0/P1 | Existing Admin/multi-entity/import/training |
| L1-L6 | Security/governance/trust | P0 | Existing security center/admin/data quality |
| M1-M5 | Legal/contracts/compliance | P1/P2 | Existing documents/contracts/risk/tax |
| N1-N5 | E-commerce/connectors | P3/P4 | Integration Hub after API/webhooks |
| O1-O9 | Industry vertical completion | P2/P3 | Existing vertical pages, no duplicates |

---

## 7. Feature-by-Feature Details

### A1. Plans and Subscription Tiers

**Benchmark source:** Daftra / NetSuite / Octagon internal need  
**Purpose:** Package Octagon into sellable plans with limits, upgrades, renewals, and module gating.  
**Current Octagon status:** Missing.  
**Recommended location:** Product/tenant setting plus Admin license sub-tab; no new sidebar page initially.  
**Detailed requirements:**
- Define Basic, Workshop, Professional, Enterprise, trial, demo, and industry-specific plans.
- Track limits for users, companies, branches, storage, invoices, POS devices, AI usage, automations, and vertical modules.
- Support upgrade/downgrade, grace period, expiry, renewal reminders, and expired-tenant disabled state.
**Data model considerations:**
- Add `omni.licensing.plans`, `omni.licensing.subscriptions`, `omni.featureFlags`.
- Tenant/company isolation is mandatory.
- Avoid destructive migration; default existing local tenant to internal/unlimited.
**Permissions and governance:**
- System admin can configure plans.
- Tenant owner can view plan status.
- Plan changes require audit log and preferably approval in hosted mode.
**AI/Jarvis behavior:**
- AI may explain plan limits and draft upgrade recommendations.
- AI must not change a tenant plan, expiry, or billing state directly.
**Reports / dashboards:**
- License status, plan utilization, expiry list, AI quota usage, module adoption.
**Acceptance criteria:**
- Disabled modules disappear or show locked state without broken sidebar.
- Expired tenant cannot perform non-public writes.
- All plan changes are audit-logged.

### A2. Trial / Demo Company Mode

**Benchmark source:** Daftra / SaaS commercial packaging  
**Purpose:** Let prospects experience Octagon safely with sample data and no real financial posting.  
**Current Octagon status:** Partial foundations through sample records; no true trial/demo mode.  
**Recommended location:** Tenant setting + setup wizard + demo data service.  
**Detailed requirements:**
- 14-day trial, demo company, reset demo data, guided walkthrough, demo user roles.
- Sample invoices, employees, warehouse, work orders, financial dashboard, and vertical samples.
- Prevent real posting, external sending, production backups, or live customer exports in demo mode.
**Data model considerations:**
- Add `tenant.mode`, `demoSeedVersion`, `demoResetAt`, and `sampleData: true` markers.
- Demo records must be clearly tagged for filtering and deletion.
**Permissions and governance:**
- Trial owner can explore.
- Admin can reset demo company.
- Financial posting and external integrations disabled.
**AI/Jarvis behavior:**
- AI may guide the walkthrough and generate fake examples.
- AI must refuse real posting or live external messages in demo mode.
**Reports / dashboards:**
- Trial activation funnel, days remaining, demo usage, module interactions.
**Acceptance criteria:**
- Reset returns demo data to a clean known state.
- Demo cannot mutate real tenant records.
- Trial expiry visibly blocks writes with upgrade path.

### A3. Tenant Onboarding Wizard

**Benchmark source:** SAP implementation methodology / NetSuite setup / Daftra onboarding  
**Purpose:** Turn first-run setup into a guided, repeatable business deployment process.  
**Current Octagon status:** Partial; multi-entity/admin/import pieces exist but no end-to-end wizard.  
**Recommended location:** Existing `multi_entity` or Admin setup sub-tab.  
**Detailed requirements:**
- Company info, business type, currency, tax, branches, warehouses, users, roles, opening balances.
- Import employees, inventory, customers, suppliers, chart of accounts.
- Choose vertical package and generate go-live checklist.
**Data model considerations:**
- Reuse tenant/company/branch/warehouse keys.
- Store `omni.setup.onboardingSteps`, `completedAt`, `approvedBy`.
- Opening balances need audit and period lock awareness.
**Permissions and governance:**
- Owner/system admin controls setup.
- Finance steps require finance manager approval.
- User/role steps require security/admin audit.
**AI/Jarvis behavior:**
- AI may recommend modules and checklist sequencing.
- AI must not create opening balances or permissions without approval.
**Reports / dashboards:**
- Setup progress, missing master data, go-live readiness.
**Acceptance criteria:**
- New tenant can be configured from empty state to runnable baseline.
- All setup decisions are reviewable and reversible where safe.

### A4. Feature Flags

**Benchmark source:** NetSuite suite architecture / SaaS product controls  
**Purpose:** Enable or disable modules by tenant, plan, vertical, and rollout stage.  
**Current Octagon status:** Missing as formal shared service.  
**Recommended location:** Shared service/module plus Admin controls.  
**Detailed requirements:**
- Flags for modules, verticals, AI features, finance depth, mobile approvals, POS, and integrations.
- Sidebar and renderers must handle disabled modules without broken links.
- Feature changes require audit and optional approval.
**Data model considerations:**
- Add `omni.featureFlags` and `omni.featureFlagHistory`.
- Defaults must preserve current local behavior.
**Permissions and governance:**
- System admin only.
- Production flag changes require audit and possibly approval.
**AI/Jarvis behavior:**
- AI may explain why a feature is unavailable.
- AI must not toggle flags directly.
**Reports / dashboards:**
- Feature adoption, disabled modules, plan mismatch warnings.
**Acceptance criteria:**
- Disabled pages do not route to blank/broken states.
- Existing 86/86 route health remains green for enabled pages.

### A5. License / Activation Center

**Benchmark source:** Daftra SaaS / local-first commercial deployment  
**Purpose:** Support local/offline activation now and cloud activation later.  
**Current Octagon status:** Missing.  
**Recommended location:** Existing Admin/deployment settings.  
**Detailed requirements:**
- Local license key, offline activation, cloud activation placeholder, tenant license status.
- Plan, AI quota, support expiry, maintenance expiry, activation audit.
**Data model considerations:**
- Add `omni.licensing.activation`, `licenseKeyHash`, `activatedAt`, `expiresAt`.
- Never store raw license secret if avoidable.
**Permissions and governance:**
- System admin can activate.
- Tenant owner can view.
- License edits audit-logged.
**AI/Jarvis behavior:**
- AI may diagnose activation status.
- AI must not generate fake license keys or bypass expiry.
**Reports / dashboards:**
- Activation health, support expiry, blocked tenants.
**Acceptance criteria:**
- Expired or invalid licenses degrade safely.
- Offline activation works without network dependency.

### B1. Report Designer

**Benchmark source:** Alameen / Daftra / NetSuite / SAP  
**Purpose:** Give owners and accountants Arabic printable reports, Excel/PDF exports, filters, grouping, totals, and saved templates.  
**Current Octagon status:** Partial report pages exist; true designer missing.  
**Recommended location:** Existing `report`, `analytics`, and `nl_reports`; shared report engine.  
**Detailed requirements:**
- Data source picker, columns, filters, groups, sort, totals, formulas, date ranges, conditional formatting.
- Arabic labels, saved templates, role-based report permissions, preview, PDF, Excel, versioning.
**Data model considerations:**
- Add `omni.reports.templates`, `omni.reports.versions`, `omni.reports.permissions`.
- Reuse existing finance, inventory, HR, sales, workshop collections.
**Permissions and governance:**
- Report view permissions must respect source-data permissions.
- Exporting payroll/finance/customer data must be audit-logged.
**AI/Jarvis behavior:**
- AI may draft reports and explain fields.
- AI cannot alter source data through report builder.
**Reports / dashboards:**
- Designer itself creates the reports; include usage and export audit.
**Acceptance criteria:**
- User can build AR aging, low stock, payroll summary, and work-order margin reports without code changes.
- PDF/Excel export works with Arabic layout.

### B2. Smart Lists / Saved Views

**Benchmark source:** NetSuite saved searches / modern SaaS tables  
**Purpose:** Let users save filters and layouts for repeated work.  
**Current Octagon status:** Missing as a shared capability.  
**Recommended location:** Shared table/view service embedded across existing pages.  
**Detailed requirements:**
- Saved filters per user, table layouts, pinned views, public/team views, quick filters, favorites.
- Standard views: low stock, unpaid invoices, late work orders, pending approvals, absent today, projects over budget.
**Data model considerations:**
- Add `omni.savedViews[]` with page, owner, visibility, filters, columns, sort.
**Permissions and governance:**
- Private views owned by user.
- Public/team views require manager/admin approval.
**AI/Jarvis behavior:**
- AI may propose saved views from natural language.
- AI must not expose restricted fields in shared views.
**Reports / dashboards:**
- Saved view usage and stale view cleanup.
**Acceptance criteria:**
- Saved view persists across reloads.
- Shared views respect row/field permissions.

### B3. Executive Dashboards

**Benchmark source:** Daftra dashboards / NetSuite / Dynamics  
**Purpose:** Give owners a reliable management cockpit.  
**Current Octagon status:** Partial analytics dashboards exist; executive suite needs completion.  
**Recommended location:** Existing `analytics` with role-specific dashboard sub-tabs.  
**Detailed requirements:**
- CEO, finance, workshop, HR, inventory, sales, projects, cash flow, approvals, and risk dashboards.
- Mobile-friendly KPI cards and drill-down links to source records.
**Data model considerations:**
- Mostly derived metrics; add cached KPI snapshots only if performance requires it.
**Permissions and governance:**
- Dashboards inherit source data permissions.
- Finance/payroll KPIs visible only to authorized roles.
**AI/Jarvis behavior:**
- AI may summarize KPIs and flag anomalies.
- AI must cite source counts and not invent numbers.
**Reports / dashboards:**
- KPI cards, trend charts, exception queues, export snapshots.
**Acceptance criteria:**
- Owner dashboard loads in under target time and every KPI links to source data.

### B4. Report Scheduler

**Benchmark source:** NetSuite / SAP / enterprise reporting  
**Purpose:** Automate daily, weekly, and monthly PDF/Excel report generation.  
**Current Octagon status:** Missing.  
**Recommended location:** Shared background service connected to `report`.  
**Detailed requirements:**
- Daily, weekly, monthly schedules; PDF/Excel output; later email/WhatsApp delivery.
- Scheduled report audit and failure alerts.
**Data model considerations:**
- Add `omni.reports.schedules`, `runs`, `lastRunAt`, `nextRunAt`, `status`.
**Permissions and governance:**
- Scheduler creator must have report/source permissions.
- Exports and deliveries audit-logged.
**AI/Jarvis behavior:**
- AI may draft schedule setup.
- AI must not send sensitive scheduled reports externally without approval.
**Reports / dashboards:**
- Schedule health and generated report archive.
**Acceptance criteria:**
- Schedule can generate an export locally and record run status.

### B5. Natural Language Report Builder

**Benchmark source:** Dynamics Copilot / Workday AI / Octagon AI vision  
**Purpose:** Let managers ask for business reports in plain language while keeping outputs traceable.  
**Current Octagon status:** Partial AI/NL report surfaces exist; governed report builder missing.  
**Recommended location:** Existing `nl_reports` plus Jarvis Report Builder Agent.  
**Detailed requirements:**
- AI suggests filters, columns, anomalies, and explanations.
- Output must trace to saved report template and source data.
**Data model considerations:**
- Store prompt, generated report definition, source collections, and audit trail.
**Permissions and governance:**
- AI cannot bypass user permissions.
- Sensitive report generation/export requires audit.
**AI/Jarvis behavior:**
- AI may draft and explain.
- AI cannot alter source data.
**Reports / dashboards:**
- Generated report history and explainability panel.
**Acceptance criteria:**
- Same natural language prompt creates a reviewable report definition, not hidden ad hoc code.

### C1. Manager Mobile App / PWA

**Benchmark source:** Daftra mobile approvals / Workday frontline mobile  
**Purpose:** Let managers approve, monitor, and react from phones.  
**Current Octagon status:** Partial mobile/employee pages exist; manager PWA incomplete.  
**Recommended location:** PWA view using existing approvals, Command Center, analytics.  
**Detailed requirements:**
- Mobile dashboard, approval inbox, approve/reject with reason, sensitive action review.
- Cash, sales, delayed work orders, attendance, low stock, reconciliation, risk alerts, daily digest.
**Data model considerations:**
- Reuse approvals and notifications.
- Add PWA preferences and push-notification placeholders later.
**Permissions and governance:**
- Approval actions require role checks and audit.
- Sensitive finance/payroll/stock actions remain approval-gated.
**AI/Jarvis behavior:**
- AI may summarize mobile digest.
- AI must not approve on behalf of manager.
**Reports / dashboards:**
- Mobile approval SLA, pending counts, daily digest.
**Acceptance criteria:**
- Manager can review and approve/reject from mobile viewport without layout breakage.

### C2. Employee Self-Service

**Benchmark source:** Workday / Daftra HR  
**Purpose:** Give employees controlled access to their own records and requests.  
**Current Octagon status:** Partial `employee_ui` and `employee_mobile`.  
**Recommended location:** Existing employee mobile/self-service pages.  
**Detailed requirements:**
- Attendance status, leave request, salary slip, advances, assigned tasks, training, documents, profile, HR requests, notifications.
**Data model considerations:**
- Reuse employees, attendance, payroll, task manager, documents.
- Add self-service request records if missing.
**Permissions and governance:**
- Employee sees only own data.
- Salary slip access audit optional but recommended.
**AI/Jarvis behavior:**
- AI may explain employee policy and draft requests.
- AI must not reveal other employees' payroll or attendance.
**Reports / dashboards:**
- HR request volumes, pending employee requests.
**Acceptance criteria:**
- Employee role cannot access finance/admin data.
- Leave/advance requests route to approval.

### C3. Mobile Inventory Count

**Benchmark source:** Alameen inventory maturity / warehouse mobile workflows  
**Purpose:** Support barcode-driven stock counts from phones.  
**Current Octagon status:** Missing/partial; inventory and barcode foundations exist.  
**Recommended location:** Existing `inventory` sub-tab + PWA count mode.  
**Detailed requirements:**
- Scan barcode/QR, count stock, offline session, sync later, discrepancy report, location/batch/expiry scan.
**Data model considerations:**
- Add `omni.inventoryCounts`, `lines`, `variance`, `approvedAdjustmentId`.
- Must integrate with future batch/location stock.
**Permissions and governance:**
- Warehouse users count.
- Adjustments require manager approval and audit.
**AI/Jarvis behavior:**
- AI may summarize discrepancies.
- AI must not post stock adjustments directly.
**Reports / dashboards:**
- Count variance, uncounted locations, adjustment approvals.
**Acceptance criteria:**
- Count session can be opened, counted, submitted, approved, and audited.

### C4. Mobile POS

**Benchmark source:** Daftra POS / retail ERP  
**Purpose:** Let small branches sell from a phone/tablet.  
**Current Octagon status:** POS exists; mobile/offline maturity missing.  
**Recommended location:** Existing `pos` responsive/PWA mode.  
**Detailed requirements:**
- Simple sales, barcode scanner, customer selection, payment method, receipt sharing, offline queue, shift close, cash drawer reconciliation.
**Data model considerations:**
- Reuse POS/sales/cashbox.
- Add offline queue and shift state.
**Permissions and governance:**
- Cashier can sell; manager approves discounts/returns.
**AI/Jarvis behavior:**
- AI may suggest upsell or explain shift variance.
- AI cannot bypass price/discount permissions.
**Reports / dashboards:**
- Z report, cashier shift, POS reconciliation.
**Acceptance criteria:**
- Mobile sale can be queued offline and reconciled safely.

### C5. Mobile Field Service

**Benchmark source:** Dynamics Field Service / Workday frontline  
**Purpose:** Give technicians job execution tools in the field.  
**Current Octagon status:** Field service page exists; mobile depth partial.  
**Recommended location:** Existing `field_service` PWA mode.  
**Detailed requirements:**
- Assigned visits, customer location, checklist, materials used, photos, signature, service report, invoice request, follow-up tasks.
**Data model considerations:**
- Reuse field service, customers, inventory, documents, e-sign.
**Permissions and governance:**
- Technician can update assigned visits only.
- Inventory/material usage and invoice requests require appropriate approvals.
**AI/Jarvis behavior:**
- AI may draft service report.
- AI must not issue invoice without approval.
**Reports / dashboards:**
- Technician productivity, first-time fix, materials usage.
**Acceptance criteria:**
- Technician can complete a visit on mobile with auditable service report.

### C6. Mobile Expense Capture

**Benchmark source:** Workday expenses / Daftra mobile  
**Purpose:** Let staff submit expenses with receipt evidence.  
**Current Octagon status:** Expense page exists; mobile capture/OCR workflow missing.  
**Recommended location:** Existing `expenses` + PWA upload flow.  
**Detailed requirements:**
- Photograph receipt, OCR-ready fields, expense category, tax/VAT, project/cost center, approval route.
**Data model considerations:**
- Add attachments/OCR fields to expense records.
**Permissions and governance:**
- Employee submits.
- Manager/finance approves.
- Reimbursement/payment audit-logged.
**AI/Jarvis behavior:**
- AI may extract draft fields from receipt.
- AI cannot approve or pay expense.
**Reports / dashboards:**
- Expense status, tax totals, project expense report.
**Acceptance criteria:**
- Receipt submission creates pending expense with attachment and approval route.

---

## 8. AI / Jarvis Completion Plan

### D1. Agent Catalog

**Benchmark source:** Dynamics agentic ERP / Workday AI agents / Octagon internal need  
**Purpose:** Turn Jarvis from a general assistant into governed process agents.  
**Current Octagon status:** Partial; assistant/tools exist, formal catalog missing.  
**Recommended location:** Existing `ai_factory`, `ai_tools`, `ai_queue`, `intelligence`; shared agent registry.  
**Detailed requirements:**
- Define Sales Order, Quote Builder, Contract Drafting, AI Order Intake, Bank Reconciliation, Finance Close, Inventory Reorder, Stock Count, Workshop Scheduling, QC/Rework, MRP Planning, Procurement, Supplier Follow-up, HR Leave, Attendance Correction, Payroll Review, Risk Compliance, Report Builder, Executive Briefing, Data Quality, Customer Support, and Field Service agents.
- For each agent store purpose, allowed tools, blocked tools, approval triggers, audit requirements, dry-run mode, simulation mode, human review mode, data sources, and output format.
**Data model considerations:**
- Add `omni.aiAgents.catalog`, `tools`, `runs`, `approvals`, `simulations`.
- Store current user, tenant, active page, selected records, and source data snapshot refs.
**Permissions and governance:**
- Agent cannot exceed current user's permissions.
- AI cannot approve its own requests.
- High-risk writes route to Command Center/approval queue.
**AI/Jarvis behavior:**
- AI may draft, simulate, recommend, summarize, and prepare approval requests.
- AI must never directly post finance, alter payroll, delete records, bypass QC, or bypass permissions.
**Reports / dashboards:**
- Agent run log, approval rate, blocked attempts, cost/token usage, risk categories.
**Acceptance criteria:**
- Every registered agent has an explicit policy and dry-run preview.
- Attempted high-risk action creates approval request instead of direct write.

### D2. Agent Permissions

**Benchmark source:** Enterprise AI governance  
**Purpose:** Keep AI under human/user/role control.  
**Current Octagon status:** Partial; PermissionService and AI governance exist.  
**Recommended location:** `services/permissionService.js` + AI governance module.  
**Detailed requirements:**
- Agent roles, action keys, delegated user permissions, no permission escalation, no delete, no finance/payroll direct post.
**Data model considerations:**
- Add agent action policy keys aligned with `ACTION_PERMISSIONS`.
**Permissions and governance:**
- System admin defines agent policies.
- Managers approve high-risk generated requests.
**AI/Jarvis behavior:**
- AI checks permissions before tool execution and logs outcome.
**Reports / dashboards:**
- AI permission matrix and blocked action dashboard.
**Acceptance criteria:**
- Regression covers representative agent policies and approval routes.

### D3. Agent Simulation / Dry Run

**Benchmark source:** SAP controlled changes / Dynamics Copilot previews  
**Purpose:** Show proposed changes before any business mutation.  
**Current Octagon status:** Partial approval queue exists; general simulation layer missing.  
**Recommended location:** AI queue + Command Center preview panel.  
**Detailed requirements:**
- Preview affected records, proposed before/after, risk level, approval route, rollback notes.
**Data model considerations:**
- Store simulation payload separate from live records.
**Permissions and governance:**
- Approval required before execution.
- Simulations should expire.
**AI/Jarvis behavior:**
- AI drafts simulations and explains risk.
**Reports / dashboards:**
- Simulation-to-approval conversion and rejected suggestions.
**Acceptance criteria:**
- User can review an AI proposal without data mutation.

### D4. Agent Memory / Context Policy

**Benchmark source:** Workday/Dynamics trusted AI  
**Purpose:** Prevent cross-tenant leakage and wrong-user execution.  
**Current Octagon status:** Partial current-user stamping exists.  
**Recommended location:** AI governance/context service.  
**Detailed requirements:**
- Track business context, tenant, current user, role, active company, page, selected records.
- Enforce no cross-tenant leakage and sensitive-data redaction.
**Data model considerations:**
- Store minimal run context, not unrestricted memory dumps.
**Permissions and governance:**
- Context visible to admins/auditors only where appropriate.
**AI/Jarvis behavior:**
- AI must cite context used and refuse missing/ambiguous tenant context for high-risk actions.
**Reports / dashboards:**
- Context/audit trail by AI run.
**Acceptance criteria:**
- AI output for one tenant cannot include another tenant's data.

### D5. AI Usage Governance

**Benchmark source:** Enterprise AI operations  
**Purpose:** Control provider, cost, tokens, logs, redaction, and fallback behavior.  
**Current Octagon status:** Partial AI status/provider pages exist.  
**Recommended location:** Existing `ai_status`, `ai_tools`, and governance service.  
**Detailed requirements:**
- Provider status, cost tracking, token tracking, model routing, fallback model, offline fallback, prompt logging policy, redaction, AI audit trail.
**Data model considerations:**
- Add `omni.aiUsage.runs`, `costs`, `providerHealth`, `redactionEvents`.
**Permissions and governance:**
- Admin sees provider/cost; managers see business AI runs.
**AI/Jarvis behavior:**
- AI reports uncertainty and provider fallback.
**Reports / dashboards:**
- Token/cost trends, failed runs, high-risk AI requests.
**Acceptance criteria:**
- Every AI run logs provider, user, tool/action, risk, and approval outcome.

---

## 9. Governance / Permissions / Security Completion Plan

### L1. Production Authentication

**Benchmark source:** All commercial ERPs  
**Purpose:** Replace local/dev client-side auth assumptions with deployable server/session security.  
**Current Octagon status:** Partial; client-side SHA-256/salt and guest state exist, but final production auth is missing.  
**Recommended location:** `server.js`, auth service, Admin user management.  
**Detailed requirements:**
- Server-side password hashing, first password setup, password reset, sessions, logout, failed login lock, admin reset, session expiry.
**Data model considerations:**
- Store password hashes server-side or in protected store, not only client-managed local JSON.
**Permissions and governance:**
- User admin actions audit-logged.
- Password reset requires admin/system permission.
**AI/Jarvis behavior:**
- AI may explain auth status.
- AI must never reveal/reset passwords or impersonate users.
**Reports / dashboards:**
- Login history, failed login lockouts, inactive users, session report.
**Acceptance criteria:**
- Unauthorized network client cannot access protected data or APIs.

### L2. Permission Completion

**Benchmark source:** SAP/Dynamics security model  
**Purpose:** Keep 86/86 page mapping current and expand action/field coverage.  
**Current Octagon status:** Mostly complete for pages; actions/fields need continuous expansion.  
**Recommended location:** `services/permissionService.js`, Security Center, regression harness.  
**Detailed requirements:**
- Map all pages, all high-risk actions, role templates, permission matrix, tests.
**Data model considerations:**
- Permission policies should be data-driven over time.
**Permissions and governance:**
- Only system admin changes policies.
- Policy changes audit-logged and regression-tested.
**AI/Jarvis behavior:**
- AI must check both page and action permission.
**Reports / dashboards:**
- Coverage report, unmapped action report.
**Acceptance criteria:**
- Permission regression stays green and expands when high-risk actions are added.

### L3. Audit Log Center

**Benchmark source:** Enterprise trust / finance controls  
**Purpose:** Make logins, writes, approvals, AI actions, permissions, exports, and sensitive actions reviewable.  
**Current Octagon status:** Partial logs exist.  
**Recommended location:** Existing Security Center/Admin sub-tab.  
**Detailed requirements:**
- Log login/logout, data writes, approvals, blocked actions, AI actions, permission changes, finance/payroll/stock/export events.
**Data model considerations:**
- Normalize `audit_log` plus `omni.auditEvents`.
**Permissions and governance:**
- Read access limited to admin/auditor.
- Tamper-evident export recommended.
**AI/Jarvis behavior:**
- AI may summarize audit patterns.
- AI cannot delete or rewrite audit logs.
**Reports / dashboards:**
- Audit filters, export audit, suspicious activity.
**Acceptance criteria:**
- Every high-risk write has who/when/what/before-after/reason.

### L4. Backup / Restore Center

**Benchmark source:** Production ERP operations  
**Purpose:** Protect local-first data.  
**Current Octagon status:** Backups folder/scripts exist; UI maturity incomplete.  
**Recommended location:** Existing Admin/deploy readiness.  
**Detailed requirements:**
- Manual backup, scheduled backup, backup health, restore points, verification, corruption recovery, restore test.
**Data model considerations:**
- Backup metadata index separate from backup payloads.
**Permissions and governance:**
- Admin only; restore requires confirmation and audit.
**AI/Jarvis behavior:**
- AI may recommend backup before risky work.
- AI must not restore/delete backups directly.
**Reports / dashboards:**
- Backup age, last verification, restore test status.
**Acceptance criteria:**
- Latest backup can be verified and restored in test path.

### L5. Release / Version Center

**Benchmark source:** SAP/NetSuite release management  
**Purpose:** Make each deployment traceable and reversible.  
**Current Octagon status:** Partial release notes and diagnostics exist.  
**Recommended location:** Existing `deploy_ready` / Admin.  
**Detailed requirements:**
- App version, migration version, release notes, regression result, route health, deployment time, rollback marker.
**Data model considerations:**
- Add `omni.releaseHistory`.
**Permissions and governance:**
- System admin/dev only.
**AI/Jarvis behavior:**
- AI may draft release notes from commits/tests.
**Reports / dashboards:**
- Release readiness checklist.
**Acceptance criteria:**
- Every release shows commit, checks, route count, and rollback marker.

### L6. Data Quality Center

**Benchmark source:** NetSuite/SAP master data controls  
**Purpose:** Find and fix master data issues before they become finance/stock errors.  
**Current Octagon status:** Page exists; rules need expansion.  
**Recommended location:** Existing `data_quality`.  
**Detailed requirements:**
- Duplicate customers, missing suppliers, materials without cost, account type gaps, orphan records, negative stock, unpaid old invoices, employees without role, missing permissions, AI anomalies.
**Data model considerations:**
- Mostly derived checks; store issue dismissals and assignments.
**Permissions and governance:**
- Data stewards can assign/resolve.
- Sensitive fixes require relevant manager approval.
**AI/Jarvis behavior:**
- AI may detect and explain anomalies.
- AI cannot silently merge/delete records.
**Reports / dashboards:**
- Data quality score, aging issues, owner status.
**Acceptance criteria:**
- Issues link to source record and recommended safe fix.

---

## 10. Productization / SaaS Completion Plan

Productization should be built after Phase 7A stabilization and before marketplace/e-commerce. The correct order is feature flags, setup wizard, license center, trial/demo mode, plans, and only then cloud billing/marketplace concepts.

Priority implementation locations:

| Feature | Location | Priority |
|---|---|---|
| Feature flags | Shared service + Admin | P0/P1 |
| Setup/onboarding wizard | `multi_entity` / Admin | P1 |
| License center | Admin / Deploy Ready | P1 |
| Trial/demo mode | Tenant setting + seed service | P1 |
| Plans/tier limits | Product settings + license service | P1 |

Do not build billing, online payments, or marketplace monetization until authentication, backups, feature flags, and setup wizard are stable.

---

## 11. Mobile / PWA Completion Plan

Mobile should start as PWA, not native apps. The first release should cover manager approvals, employee self-service, inventory count, and simple mobile dashboard. POS, field service, and expense capture come after the PWA shell is stable.

PWA rules:

- Use existing pages and services.
- Keep actions permission-checked.
- Cache only safe assets and non-sensitive drafts.
- Design for low bandwidth and mobile Arabic layout.
- Route all finance/payroll/stock-sensitive actions through approval where required.

Acceptance for mobile phase:

- Mobile viewport has no overlapping controls.
- Manager can approve/reject with reason.
- Employee cannot see another employee's data.
- Inventory count can submit variance for approval.

---

## 12. Reporting / BI / Planning Completion Plan

Reporting is a commercial blocker. Octagon should build a shared reporting engine before adding more vertical depth. The engine must power finance statements, inventory reports, HR reports, workshop costing, sales dashboards, and executive dashboards.

Required report packs:

- Finance: P&L, balance sheet, cash flow, trial balance, GL, account statement, customer/supplier statement, AR/AP aging.
- Inventory: stock balance, low stock, expiry, batch trace, stock movement, count variance.
- HR: attendance, salary, leave, contracts, custody, performance.
- Workshop: job costing, rework, machine load, QC score, late work orders.
- Sales/POS: sales, collections, commissions, targets, installments, returns, Z report.
- Governance: audit, permission changes, AI actions, data quality.

Acceptance:

- Reports export Arabic PDF and Excel.
- Source permissions are enforced.
- Sensitive exports are audit-logged.

---

## 13. HRMS Completion Plan

### F1. Employee Master File

**Benchmark source:** Workday / Daftra HR  
**Purpose:** Make employee records complete enough for HR, payroll, access, custody, and reporting.  
**Current Octagon status:** Partial; employees/payroll exist.  
**Recommended location:** Existing `employees` and `people_ops`.  
**Detailed requirements:**
- Personal/contact info, job title, department, manager, branch, role, salary profile, contract, documents, emergency contact, skills, training, custody/assets, status, audit history.
**Data model considerations:** Extend employee profile carefully; avoid breaking payroll calculation.  
**Permissions and governance:** HR can edit; finance sees salary-relevant parts; employee sees own limited profile.  
**AI/Jarvis behavior:** AI can find missing fields and draft profile summaries; no direct salary/profile changes without permission.  
**Reports / dashboards:** Employee completeness, headcount, missing documents.  
**Acceptance criteria:** Employee profile has clear tabs and payroll-sensitive fields are guarded.

### F2. Organization Chart

**Benchmark source:** Workday HCM  
**Purpose:** Map departments, teams, reporting lines, and workforce distribution.  
**Current Octagon status:** Partial/unknown.  
**Recommended location:** `people_ops` sub-tab.  
**Detailed requirements:** Departments, teams, managers, open positions, workforce distribution, role-permission links.  
**Data model considerations:** `omni.hr.orgUnits`, `positions`, manager references.  
**Permissions and governance:** HR/admin maintain; managers view own org.  
**AI/Jarvis behavior:** AI may detect missing managers or reporting gaps.  
**Reports / dashboards:** Org chart, span of control, vacancies.  
**Acceptance criteria:** Every active employee can be placed in an org unit or flagged.

### F3. Contracts Lifecycle

**Benchmark source:** Workday / legal contract management  
**Purpose:** Manage employment contracts from draft to renewal/expiry.  
**Current Octagon status:** Partial; printable contract drafts exist in Documents, contracts page exists.  
**Recommended location:** `people_ops`, `documents`, `contracts`.  
**Detailed requirements:** Type, start/end, renewal reminders, probation, salary terms, hours, benefits, attachments, templates, approvals.  
**Data model considerations:** Link employee contract IDs to document records.  
**Permissions and governance:** Contract changes require HR/owner approval and audit.  
**AI/Jarvis behavior:** AI may draft contract text; cannot approve legal contract.  
**Reports / dashboards:** Expiring contracts, probation, missing signed contracts.  
**Acceptance criteria:** Expiring employee contracts generate reminders and are linked to employee file.

### F4. Onboarding

**Benchmark source:** Workday HR service delivery  
**Purpose:** Standardize employee start process.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** `people_ops` sub-tab + Task Manager templates.  
**Detailed requirements:** Checklist, required documents, trainer, custody, access, training plan, probation review, payroll setup.  
**Data model considerations:** `omni.hr.onboardingCases`.  
**Permissions and governance:** HR owns; IT/admin grants access; finance reviews payroll setup.  
**AI/Jarvis behavior:** AI may generate checklist from role.  
**Reports / dashboards:** New hire readiness, overdue onboarding tasks.  
**Acceptance criteria:** New employee cannot be marked fully onboarded until required tasks complete.

### F5. Offboarding / Termination

**Benchmark source:** Workday / enterprise HR controls  
**Purpose:** Safely close employee relationship and access.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** `people_ops` + approvals + custody/assets.  
**Detailed requirements:** Resignation/termination request, approvals, final settlement, custody return, access removal, last working day, dues/deductions, document archive, exit interview.  
**Data model considerations:** Termination workflow should not delete employee history.  
**Permissions and governance:** HR starts; owner/finance approve; access removal audited.  
**AI/Jarvis behavior:** AI may draft settlement checklist; cannot terminate employee directly.  
**Reports / dashboards:** Offboarding status, custody pending, final settlement.  
**Acceptance criteria:** Termination requires approvals and preserves audit/history.

### F6. Leave Management

**Benchmark source:** Daftra HR / Workday  
**Purpose:** Manage leave balances and payroll impact.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** `people_ops`, `employee_mobile`, payroll integration.  
**Detailed requirements:** Leave types, balances, request, manager approval, payroll impact, calendar, conflicts, unpaid/sick leave documents.  
**Data model considerations:** `omni.hr.leaveRequests`, `leaveBalances`.  
**Permissions and governance:** Employee requests; manager approves; payroll lock respected.  
**AI/Jarvis behavior:** AI may answer balance and draft request; cannot approve leave.  
**Reports / dashboards:** Leave calendar, balance report, unpaid leave impact.  
**Acceptance criteria:** Approved leave flows into attendance/payroll calculation rules.

### F7. Attendance Corrections

**Benchmark source:** HRMS controls  
**Purpose:** Make attendance edits approval-based and payroll-lock aware.  
**Current Octagon status:** Partial attendance/payroll exist.  
**Recommended location:** Timesheet/attendance + approvals.  
**Detailed requirements:** Correction request, reason, evidence, manager approval, payroll lock awareness, audit.  
**Data model considerations:** Store corrections separate from raw attendance.  
**Permissions and governance:** Employee/manager submit; HR/payroll approve depending on period.  
**AI/Jarvis behavior:** AI may detect anomalies; cannot directly edit locked attendance.  
**Reports / dashboards:** Correction volume, late approvals.  
**Acceptance criteria:** Locked period correction routes to approval, not direct edit.

### F8. Salary Components

**Benchmark source:** Workday / payroll systems  
**Purpose:** Model pay beyond base salary.  
**Current Octagon status:** Partial payroll calculator exists.  
**Recommended location:** Payroll/employees/people_ops salary profile.  
**Detailed requirements:** Base, allowances, transport, food, overtime, deductions, bonuses, fines, advances, loans, change approval, effective date, payroll period lock.  
**Data model considerations:** Versioned salary profiles with effective dates.  
**Permissions and governance:** Finance/HR approval; locked period protected.  
**AI/Jarvis behavior:** AI may review and flag anomalies; cannot alter salary directly.  
**Reports / dashboards:** Payroll variance, component summary, salary changes.  
**Acceptance criteria:** Salary changes are versioned, approved, and reflected from effective date.

### F9. Performance Reviews

**Benchmark source:** Workday talent management  
**Purpose:** Link employee performance to goals, tasks, and work output.  
**Current Octagon status:** Missing.  
**Recommended location:** `people_ops` sub-tab.  
**Detailed requirements:** Review cycles, goals, ratings, manager notes, self-review, productivity metrics, work-order/task links, improvement plans.  
**Data model considerations:** `omni.hr.performanceReviews`.  
**Permissions and governance:** Manager/HR visibility rules.  
**AI/Jarvis behavior:** AI may draft review summaries from allowed task data; cannot generate final rating without manager review.  
**Reports / dashboards:** Review completion, ratings distribution, improvement plans.  
**Acceptance criteria:** Review cycle can be opened, completed, approved, and archived.

### F10. Disciplinary Actions

**Benchmark source:** HR compliance  
**Purpose:** Track warnings, fines, suspensions, and evidence.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** `people_ops`; payroll link for fines.  
**Detailed requirements:** Warning, fine, suspension, incident record, evidence, approval, payroll impact, audit.  
**Data model considerations:** `omni.hr.disciplinaryActions`.  
**Permissions and governance:** HR/manager create; finance/payroll impact approval required.  
**AI/Jarvis behavior:** AI may draft incident summary; cannot issue penalty directly.  
**Reports / dashboards:** Incidents by department, pending approvals.  
**Acceptance criteria:** Any payroll-impacting discipline is approval-routed and audit-logged.

### F11. Custody / Employee Assets

**Benchmark source:** Workday / local workshop needs  
**Purpose:** Track tools, laptops, uniforms, cards, and machine keys assigned to employees.  
**Current Octagon status:** Partial asset/equipment foundations exist.  
**Recommended location:** Employee file + assets/equipment.  
**Detailed requirements:** Assigned tools, condition, return process, missing/damaged item, deduction approval.  
**Data model considerations:** Link `omni.equipment/assets` to employee custody records.  
**Permissions and governance:** Warehouse/HR assign; deductions require approval.  
**AI/Jarvis behavior:** AI may list missing custody; cannot apply deductions directly.  
**Reports / dashboards:** Custody by employee, overdue returns, damaged items.  
**Acceptance criteria:** Offboarding checklist shows all unreturned custody.

### F12. Workforce Planning

**Benchmark source:** Workday workforce planning / workshop reality  
**Purpose:** Match skills and capacity to work demand.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** `people_ops`, workshop scheduler, analytics.  
**Detailed requirements:** Skill matrix, available workers, shift capacity, machine skills, absence impact, workload forecast, shortage alerts, hiring recommendations.  
**Data model considerations:** Skills linked to employees/machines/tasks.  
**Permissions and governance:** Managers view planning; HR maintains skills.  
**AI/Jarvis behavior:** AI may recommend staffing; cannot hire or change contracts.  
**Reports / dashboards:** Capacity by skill, shortage forecast.  
**Acceptance criteria:** Scheduler can flag skill/capacity shortages before deadline breach.

### F13. Employee Voice / Requests

**Benchmark source:** Workday employee experience  
**Purpose:** Give employees a governed channel for HR requests, complaints, and suggestions.  
**Current Octagon status:** Partial through tasks/requests.  
**Recommended location:** Employee self-service + people_ops.  
**Detailed requirements:** Complaint, suggestion, HR request, optional anonymous feedback, status, HR response, audit.  
**Data model considerations:** `omni.hr.employeeRequests`.  
**Permissions and governance:** Anonymous mode must protect identity if enabled; HR response audit.  
**AI/Jarvis behavior:** AI may classify requests; cannot expose anonymous identity.  
**Reports / dashboards:** Request SLA, categories, unresolved issues.  
**Acceptance criteria:** Employee can submit and track request without seeing other requests.

---

## 14. Finance / Accounting / Close Completion Plan

### G1. Month-End Close

**Benchmark source:** NetSuite / SAP finance controls  
**Purpose:** Make finance period closing controlled and repeatable.  
**Current Octagon status:** Missing.  
**Recommended location:** Finance/reporting sub-tab + approvals.  
**Detailed requirements:** Checklist, responsible person, due date, status, bank/cashbox/inventory/payroll/expenses/depreciation/AR/AP/tax review, close approval, period lock.  
**Data model considerations:** `finance.closePeriods`, `tasks`, `approvals`.  
**Permissions and governance:** Finance manager owns; owner approves close/unlock.  
**AI/Jarvis behavior:** AI may check missing close items; cannot close period directly.  
**Reports / dashboards:** Close status, overdue tasks, approval history.  
**Acceptance criteria:** Closed period blocks edits except approved adjustments.

### G2. Period Locking

**Benchmark source:** Enterprise accounting controls  
**Purpose:** Prevent unauthorized edits in closed financial periods.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Finance service + settings.  
**Detailed requirements:** Lock/unlock month, approval unlock, prevent edits, adjustment entries, audit unlocks, role restrictions.  
**Data model considerations:** `finance.periodLocks`.  
**Permissions and governance:** Finance manager/admin only; unlock approval required.  
**AI/Jarvis behavior:** AI can explain lock conflicts; cannot unlock.  
**Reports / dashboards:** Locked periods and adjustment entries.  
**Acceptance criteria:** Finance/payroll/stock posting APIs check period lock before write.

### G3. Financial Statements

**Benchmark source:** Alameen / NetSuite / SAP  
**Purpose:** Provide core accounting outputs.  
**Current Octagon status:** Missing/partial; accounts/journals exist.  
**Recommended location:** Reports/finance.  
**Detailed requirements:** P&L, balance sheet, cash flow, trial balance, GL, account/customer/supplier statements, PDF/Excel Arabic formats.  
**Data model considerations:** COA needs account types and statement mapping.  
**Permissions and governance:** Finance-only; exports audit-logged.  
**AI/Jarvis behavior:** AI may explain statement variance; cannot alter postings.  
**Reports / dashboards:** The financial statements themselves.  
**Acceptance criteria:** Statements reconcile to journals/accounts for selected period.

### G4. Aging Reports

**Benchmark source:** Alameen / Daftra / NetSuite  
**Purpose:** Manage receivables/payables collections and supplier risk.  
**Current Octagon status:** Partial AR/AP exists.  
**Recommended location:** `ar_ap`, reports, customer/supplier pages.  
**Detailed requirements:** AR aging, AP aging, overdue customers/suppliers, expected collections, bad debt flag, follow-up tasks.  
**Data model considerations:** Invoice/payment due dates and settlement status required.  
**Permissions and governance:** Finance/sales managers view; follow-up tasks audit.  
**AI/Jarvis behavior:** AI may draft collection follow-up; external sending requires approval/template.  
**Reports / dashboards:** Aging buckets, top overdue, collection forecast.  
**Acceptance criteria:** Aging report matches invoice/payment data and links to follow-up tasks.

### G5. Cash Flow Forecast

**Benchmark source:** NetSuite planning / Workday finance  
**Purpose:** Predict short-term cash position.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Finance analytics/budgeting.  
**Detailed requirements:** Expected income/expenses, payroll, purchase obligations, project payments, bank/cash balances, scenarios, alerts.  
**Data model considerations:** Requires due dates, budgets, AR/AP, payroll obligations.  
**Permissions and governance:** Finance/owner only.  
**AI/Jarvis behavior:** AI may explain forecast drivers; cannot move money.  
**Reports / dashboards:** 7/30/90-day cash forecast.  
**Acceptance criteria:** Forecast links each amount to source record or assumption.

### G6. Cost Centers and Department Profitability

**Benchmark source:** SAP/NetSuite management accounting  
**Purpose:** Measure profitability by department, branch, project, machine, product/service.  
**Current Octagon status:** Partial project/department data exists.  
**Recommended location:** Finance/budgeting/projects/workshop reports.  
**Detailed requirements:** Department/project/branch/workshop/machine/product cost centers and overhead allocation.  
**Data model considerations:** Add `costCenterId` to transactions, expenses, payroll, work orders.  
**Permissions and governance:** Finance controls setup; managers view own center.  
**AI/Jarvis behavior:** AI may suggest allocations; cannot post allocation entries without approval.  
**Reports / dashboards:** Profitability by center and allocation audit.  
**Acceptance criteria:** Transactions can be filtered and reported by cost center.

### G7. Budget vs Actual

**Benchmark source:** Workday/NetSuite planning  
**Purpose:** Track budgets and prevent overspend.  
**Current Octagon status:** Budgeting page exists; depth partial.  
**Recommended location:** Existing `budgeting`.  
**Detailed requirements:** Annual/monthly/department/project budgets, variance, overspend approvals, forecast revision.  
**Data model considerations:** `finance.budgets`, `versions`, `actualMappings`.  
**Permissions and governance:** Finance creates; department heads approve/own lines.  
**AI/Jarvis behavior:** AI may explain variance and draft forecast revisions.  
**Reports / dashboards:** Budget vs actual, variance alerts.  
**Acceptance criteria:** Actual spend updates variance and overspend requires approval.

### G8. Consolidation

**Benchmark source:** NetSuite global business management  
**Purpose:** Support multi-company financial reporting.  
**Current Octagon status:** Multi-entity exists; consolidation missing.  
**Recommended location:** Multi-entity + finance reports.  
**Detailed requirements:** Multi-company consolidation, intercompany transactions, currency conversion, eliminations, consolidated statements.  
**Data model considerations:** Strong tenant/company isolation and chart mapping required.  
**Permissions and governance:** Group finance/admin only.  
**AI/Jarvis behavior:** AI may explain eliminations; cannot post consolidation entries directly.  
**Reports / dashboards:** Consolidated P&L, balance sheet, intercompany balances.  
**Acceptance criteria:** Consolidated report excludes eliminated intercompany amounts.

### G9. Cheque Lifecycle

**Benchmark source:** Regional accounting practice  
**Purpose:** Track issued/received cheques through clearing and bounce.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Banking/cashbox/AR/AP.  
**Detailed requirements:** Received/issued cheques, due date, deposit, bounce, cancellation, clearing, customer/supplier link, audit.  
**Data model considerations:** `finance.cheques` linked to bank/cash/customer/supplier.  
**Permissions and governance:** Finance only; bounce/cancel audit.  
**AI/Jarvis behavior:** AI may warn due cheques; cannot clear/cancel directly.  
**Reports / dashboards:** Cheques due, bounced, clearing status.  
**Acceptance criteria:** Cheque state changes are auditable and reflected in cash expectations.

### G10. Bank Sync / Import

**Benchmark source:** Daftra/NetSuite banking  
**Purpose:** Import statements and improve reconciliation.  
**Current Octagon status:** Partial reconciliation overlay exists; import depth missing.  
**Recommended location:** Existing `banking`.  
**Detailed requirements:** CSV/Excel statement import, bank feed placeholder, matching, duplicate detection, import log, adjustment approval.  
**Data model considerations:** Reuse `omni.banking.statementLines`, add import batch metadata.  
**Permissions and governance:** Finance imports; adjustments approval-routed.  
**AI/Jarvis behavior:** Bank Reconciliation Agent may suggest matches only.  
**Reports / dashboards:** Import success, unmatched lines, duplicates.  
**Acceptance criteria:** Imported lines do not create accounting entries without approval.

### G11. Fixed Assets Deepening

**Benchmark source:** SAP/NetSuite assets  
**Purpose:** Mature asset accounting and maintenance.  
**Current Octagon status:** Assets and maintenance exist; finance depth partial.  
**Recommended location:** Existing `assets` and finance.  
**Detailed requirements:** Asset register, depreciation methods, disposal, sale, maintenance link, insurance, warranty, custody, audit.  
**Data model considerations:** Link assets to depreciation journals and custody.  
**Permissions and governance:** Finance controls depreciation/disposal; maintenance updates service state.  
**AI/Jarvis behavior:** AI may suggest due depreciation/maintenance; cannot dispose asset directly.  
**Reports / dashboards:** Asset register, depreciation, disposal gains/losses.  
**Acceptance criteria:** Asset lifecycle states affect reports and audit trail.

### G12. Finance AI Agents

**Benchmark source:** Dynamics finance agents  
**Purpose:** Assist finance without bypassing controls.  
**Current Octagon status:** Partial Jarvis tools exist.  
**Recommended location:** AI Agent Catalog + finance pages.  
**Detailed requirements:** Reconciliation agent, close checklist agent, anomaly detection, expense categorization, cash forecast explanation, no direct posting without approval.  
**Data model considerations:** AI proposals stored separately from posted finance data.  
**Permissions and governance:** Finance users only; postings approval-routed.  
**AI/Jarvis behavior:** Draft/suggest/explain; no direct post.  
**Reports / dashboards:** AI finance suggestions, acceptance/rejection.  
**Acceptance criteria:** Every finance AI write proposal enters approval queue.

---

## 15. Inventory / Supply Chain Completion Plan

### H1. Serial / Lot / Batch Tracking

**Benchmark source:** Alameen inventory / manufacturing/pharmacy needs  
**Purpose:** Trace stock by serial, lot, batch, supplier, and production batch.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Existing `inventory`, `procurement`, `work_orders`.  
**Detailed requirements:** Serial, batch, lot, supplier batch, production batch, traceability, recall, batch balances.  
**Data model considerations:** `omni.inventory.batches`, `serials`, `stockByBatchLocation`.  
**Permissions and governance:** Warehouse/procurement manage; adjustments approved.  
**AI/Jarvis behavior:** AI may trace batch impact; cannot adjust batch stock directly.  
**Reports / dashboards:** Batch stock, recall trace, serial history.  
**Acceptance criteria:** Sale/work order consumption can identify exact batch/serial when required.

### H2. Expiry Management

**Benchmark source:** Pharmacy/food inventory standards  
**Purpose:** Prevent expired stock use and support FEFO.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Inventory + pharmacy/restaurant verticals.  
**Detailed requirements:** Expiry date, near-expiry alerts, expired blocking, FEFO picking, pharmacy/food support.  
**Data model considerations:** Expiry stored on batch/location balances.  
**Permissions and governance:** Expired stock issue blocked or manager-approved disposal.  
**AI/Jarvis behavior:** AI may alert near-expiry and suggest promotions/disposal.  
**Reports / dashboards:** Near-expiry, expired stock, write-off approvals.  
**Acceptance criteria:** Expired batch cannot be sold/issued without governed exception.

### H3. Min/Max and Reorder

**Benchmark source:** Alameen/Daftra inventory  
**Purpose:** Keep stock healthy by warehouse/location.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Inventory/procurement.  
**Detailed requirements:** Min, max, reorder point, reorder quantity, per warehouse/location, supplier lead time, reorder suggestions, approval to purchase.  
**Data model considerations:** Add reorder rules to item/location.  
**Permissions and governance:** Warehouse suggests; procurement/manager approves PO.  
**AI/Jarvis behavior:** Reorder Agent suggests purchase requests only.  
**Reports / dashboards:** Low stock, overstock, reorder queue.  
**Acceptance criteria:** Low-stock item creates reviewable reorder recommendation.

### H4. Reserved vs Available Stock

**Benchmark source:** Manufacturing/retail inventory control  
**Purpose:** Avoid overselling or over-consuming stock.  
**Current Octagon status:** Partial work-order reservation behavior exists.  
**Recommended location:** Inventory, sales, work orders.  
**Detailed requirements:** Reserved for work orders/sales, available stock, allocated stock, release reservation, expiry, conflict warning.  
**Data model considerations:** Reservation records by source document and location/batch.  
**Permissions and governance:** Release/override audited.  
**AI/Jarvis behavior:** AI may explain conflicts; cannot override reservation without approval.  
**Reports / dashboards:** Available/reserved stock report.  
**Acceptance criteria:** Availability calculations subtract active reservations.

### H5. Stock Count Sessions

**Benchmark source:** Warehouse controls  
**Purpose:** Govern physical inventory counts and adjustments.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Inventory + mobile count.  
**Detailed requirements:** Count plan, freeze location, mobile scan, counted quantity, variance, approval, audit, count report.  
**Data model considerations:** Count session lines and approved adjustment records.  
**Permissions and governance:** Warehouse counts; manager approves adjustment.  
**AI/Jarvis behavior:** AI may identify variance patterns; no direct adjustment.  
**Reports / dashboards:** Variance by item/location/user.  
**Acceptance criteria:** Posted adjustment requires approved count session.

### H6. Internal Stock Requests

**Benchmark source:** Workshop/warehouse operations  
**Purpose:** Manage material requests from departments/jobs.  
**Current Octagon status:** Partial through work orders/tasks.  
**Recommended location:** Inventory + work orders + approvals.  
**Detailed requirements:** Department/job request, material issue, approval, fulfillment, partial fulfillment, backorder.  
**Data model considerations:** `omni.stockRequests`, lines, approvals, issue records.  
**Permissions and governance:** Requester submits; warehouse fulfills; manager approves sensitive items.  
**AI/Jarvis behavior:** AI may draft material request from job; cannot issue stock directly.  
**Reports / dashboards:** Open requests, fulfillment SLA, backorders.  
**Acceptance criteria:** Material issue links to approved request or work order.

### H7. Landed Cost

**Benchmark source:** SAP/NetSuite procurement  
**Purpose:** Calculate actual item cost including shipping/customs/transport.  
**Current Octagon status:** Missing.  
**Recommended location:** Procurement/inventory/finance.  
**Detailed requirements:** Purchase price, shipping, customs, transport, other expenses, allocation by quantity/value/weight, valuation impact.  
**Data model considerations:** Landed cost batches tied to purchase receipts.  
**Permissions and governance:** Finance/procurement approval before valuation update.  
**AI/Jarvis behavior:** AI may suggest allocation method; cannot post valuation without approval.  
**Reports / dashboards:** Landed cost variance, true item margin.  
**Acceptance criteria:** Inventory valuation report includes approved landed costs.

### H8. Bundled / Kit Products

**Benchmark source:** POS/manufacturing retail packs  
**Purpose:** Support product bundles and kit assembly/disassembly.  
**Current Octagon status:** Missing/partial via BOMs.  
**Recommended location:** Inventory/POS/MRP.  
**Detailed requirements:** Bundle definition, component stock, assembly, disassembly, POS support, manufacturing support.  
**Data model considerations:** Reuse BOMs where possible; separate sellable kit rules.  
**Permissions and governance:** Assembly/disassembly stock moves audited.  
**AI/Jarvis behavior:** AI may suggest kit availability; cannot alter stock silently.  
**Reports / dashboards:** Kit margin and component shortage.  
**Acceptance criteria:** POS sale of kit reduces component stock according to definition.

### H9. Barcode / QR Labels

**Benchmark source:** Alameen/Daftra inventory operations  
**Purpose:** Standardize labels for materials, locations, batches, assets, and custody.  
**Current Octagon status:** Partial barcode UX exists.  
**Recommended location:** Inventory/assets/equipment print templates.  
**Detailed requirements:** Material, location, batch, asset, employee custody labels and print templates.  
**Data model considerations:** Stable IDs and short display codes.  
**Permissions and governance:** Label generation allowed; relabeling identity audited.  
**AI/Jarvis behavior:** AI may help generate label batches; cannot change identity codes without permission.  
**Reports / dashboards:** Label print history.  
**Acceptance criteria:** Scanned label opens correct record or count workflow.

### H10. Supplier Performance

**Benchmark source:** SAP procurement / NetSuite vendor scorecards  
**Purpose:** Rank suppliers by reliability, price, and quality.  
**Current Octagon status:** Partial supplier records exist.  
**Recommended location:** Procurement/supplier portal/reports.  
**Detailed requirements:** Lead time, quality issues, price history, late deliveries, preferred supplier, supplier score.  
**Data model considerations:** Link purchase orders, receipts, QC defects, price history.  
**Permissions and governance:** Procurement manages preferred status; audit changes.  
**AI/Jarvis behavior:** AI may summarize supplier risk; cannot blacklist supplier directly.  
**Reports / dashboards:** Supplier scorecard, late delivery, defect rate.  
**Acceptance criteria:** Supplier score is computed from auditable source events.

---

## 16. Sales / CRM / POS Completion Plan

### I1. Commission Engine

**Benchmark source:** Alameen/Daftra commercial operations  
**Purpose:** Calculate sales, referral, designer, and project manager commissions.  
**Current Octagon status:** Missing.  
**Recommended location:** Sales/finance/payroll reports.  
**Detailed requirements:** Rules by invoice, collected payment, profit, product/category, approval before payout, commission statement.  
**Data model considerations:** `omni.sales.commissionRules`, `commissionAccruals`.  
**Permissions and governance:** Sales manager defines; finance/payroll approves payout.  
**AI/Jarvis behavior:** AI may explain commission calculation; cannot approve payout.  
**Reports / dashboards:** Commission statements and unpaid commissions.  
**Acceptance criteria:** Commission can be calculated and approved from real sales/collection data.

### I2. Sales Targets

**Benchmark source:** Daftra / Dynamics Sales  
**Purpose:** Manage targets and bonuses by salesperson/branch/department.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Sales/analytics.  
**Detailed requirements:** Monthly/person/department/branch targets, actuals, bonus rules, AI sales insights.  
**Data model considerations:** `omni.sales.targets`, target periods.  
**Permissions and governance:** Managers set targets; sales staff see own.  
**AI/Jarvis behavior:** AI may suggest pipeline actions.  
**Reports / dashboards:** Target vs actual, bonus forecast.  
**Acceptance criteria:** Sales dashboard compares closed sales to target.

### I3. Installments

**Benchmark source:** Daftra installments / regional sales  
**Purpose:** Track customer payment schedules and collections.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Sales/invoices/AR/AP/customer portal.  
**Detailed requirements:** Plans, due dates, schedules, late alerts, partial payments, optional penalties, invoice link, customer statement.  
**Data model considerations:** `finance.installmentPlans`, `installmentLines`.  
**Permissions and governance:** Finance/sales approve plan; penalties governed.  
**AI/Jarvis behavior:** AI may draft payment reminders; external send approval/template.  
**Reports / dashboards:** Installment aging and collections forecast.  
**Acceptance criteria:** Customer statement includes installment schedule and paid/unpaid lines.

### I4. Advanced Price Lists

**Benchmark source:** NetSuite / retail ERP  
**Purpose:** Support customer, wholesale/retail, branch, contract, date, and quantity pricing.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Sales/POS/products/inventory.  
**Detailed requirements:** Price lists, branch price, contract price, quantity breaks, discount-below-margin approval.  
**Data model considerations:** `omni.sales.priceLists`, item/customer links.  
**Permissions and governance:** Sales manager controls; below-margin discounts approval-routed.  
**AI/Jarvis behavior:** AI may suggest price based on rules; cannot override margin guard.  
**Reports / dashboards:** Margin leakage and price-list usage.  
**Acceptance criteria:** POS/sales price lookup respects active price list and approvals.

### I5. Loyalty / Customer Rewards

**Benchmark source:** Daftra/POS retail  
**Purpose:** Improve repeat sales.  
**Current Octagon status:** Loyalty page exists; maturity partial.  
**Recommended location:** Existing `loyalty`, POS, customers.  
**Detailed requirements:** Points, tiers, vouchers, birthday offers, customer wallet, POS link.  
**Data model considerations:** `omni.loyalty.accounts`, transactions, vouchers.  
**Permissions and governance:** Voucher issuance/adjustment audited.  
**AI/Jarvis behavior:** AI may recommend offers; cannot issue monetary credits without permission.  
**Reports / dashboards:** Points liability, campaign conversion.  
**Acceptance criteria:** POS can earn/redeem points with audit.

### I6. Quotation to Contract to Order

**Benchmark source:** Dynamics Sales / NetSuite order-to-cash  
**Purpose:** Connect commercial lifecycle from quote to delivery and close.  
**Current Octagon status:** Partial pieces exist.  
**Recommended location:** Sales/contracts/work orders/invoices.  
**Detailed requirements:** Quote, approval, contract, down payment, work order, invoice, delivery, close, AI contract draft, signature later.  
**Data model considerations:** Link documents across lifecycle with source IDs.  
**Permissions and governance:** Discount/contract/final issue approvals.  
**AI/Jarvis behavior:** AI may draft quote/contract; cannot finalize contract/order without approval.  
**Reports / dashboards:** Conversion, margin, delivery status.  
**Acceptance criteria:** User can trace one customer deal from quote through invoice/delivery.

### I7. Customer Portal Deepening

**Benchmark source:** SaaS customer portals  
**Purpose:** Give customers secure self-service for documents and order status.  
**Current Octagon status:** Customer portal page exists; depth partial.  
**Recommended location:** Existing `customer_portal`.  
**Detailed requirements:** Dashboard, quotes, invoices, payments, order status, approval/signature, tickets, documents, statements.  
**Data model considerations:** External customer identity/token model required.  
**Permissions and governance:** Customer sees own records only.  
**AI/Jarvis behavior:** AI support agent may answer based on customer-visible data only.  
**Reports / dashboards:** Portal usage, unpaid invoices, open tickets.  
**Acceptance criteria:** Customer cannot access another customer's records.

### I8. POS Deepening

**Benchmark source:** Daftra/Alameen POS  
**Purpose:** Make POS commercially reliable.  
**Current Octagon status:** POS exists; maturity partial.  
**Recommended location:** Existing `pos`.  
**Detailed requirements:** Cashier shifts, cash drawer, offline mode, printer, barcode scanner, returns, exchange, discount approval, Z report, reconciliation.  
**Data model considerations:** POS sessions, payments, return links.  
**Permissions and governance:** Cashier vs manager roles; returns/discounts audited.  
**AI/Jarvis behavior:** AI may explain shift variance; cannot approve own variance.  
**Reports / dashboards:** Z report, shift close, return analysis.  
**Acceptance criteria:** Shift can open, sell, return, close, reconcile to cashbox.

### I9. WhatsApp/Email Sharing

**Benchmark source:** Daftra modern sharing  
**Purpose:** Share invoices, quotes, receipts, reminders, order updates, statements.  
**Current Octagon status:** WhatsApp page exists; integration maturity partial.  
**Recommended location:** Existing `whatsapp`, sales, finance, templates.  
**Detailed requirements:** Invoice/quote/receipt links, payment reminders, order updates, statements, template management.  
**Data model considerations:** Message templates, delivery logs, approval flags.  
**Permissions and governance:** External sends logged; sensitive sends approved/template-controlled.  
**AI/Jarvis behavior:** AI may draft message templates; send requires user action/approval.  
**Reports / dashboards:** Sent messages, failed deliveries, reminder conversions.  
**Acceptance criteria:** Sharing action creates auditable outbound log with template/source record.

---

## 17. Manufacturing / Workshop / MRP Completion Plan

### J1. Production Costing

**Benchmark source:** Manufacturing ERP / workshop need  
**Purpose:** Measure actual job profitability.  
**Current Octagon status:** Partial work-order costing exists.  
**Recommended location:** Work orders/MRP/finance reports.  
**Detailed requirements:** Material, labor, machine time, overhead, subcontracting, waste, rework, actual vs estimated, margin by job.  
**Data model considerations:** Cost lines linked to work order and cost centers.  
**Permissions and governance:** Finance locks final costs; workshop enters operational actuals.  
**AI/Jarvis behavior:** AI may explain margin variance; cannot post finance adjustments.  
**Reports / dashboards:** Job margin, cost variance, rework cost.  
**Acceptance criteria:** Closed work order shows estimated vs actual cost and margin.

### J2. Capacity Planning

**Benchmark source:** SAP manufacturing / Dynamics operations  
**Purpose:** Predict bottlenecks and realistic delivery dates.  
**Current Octagon status:** Partial machine/job data exists.  
**Recommended location:** Machines/work orders/MRP.  
**Detailed requirements:** Machine, employee, shift capacity, job queue, bottlenecks, delivery simulation, AI schedule recommendation.  
**Data model considerations:** Calendar/shift/machine availability and operation durations.  
**Permissions and governance:** Workshop manager schedules; changes audited.  
**AI/Jarvis behavior:** AI may recommend schedule; manager approves.  
**Reports / dashboards:** Capacity load, bottlenecks, late risk.  
**Acceptance criteria:** New job can estimate capacity impact before confirmation.

### J3. Workshop Scheduler

**Benchmark source:** Field/manufacturing dispatch tools  
**Purpose:** Allocate jobs to machines/workers visually.  
**Current Octagon status:** Partial queue/schedule concepts exist.  
**Recommended location:** Work orders/machines sub-tab.  
**Detailed requirements:** Drag/drop scheduling, machine/worker allocation, priority, due date, dependencies, conflicts.  
**Data model considerations:** `omni.workshopSchedule` assignments.  
**Permissions and governance:** Manager-only schedule changes; conflict overrides audited.  
**AI/Jarvis behavior:** AI suggests schedule, cannot override locked jobs.  
**Reports / dashboards:** Schedule adherence and conflicts.  
**Acceptance criteria:** Scheduler detects machine/worker conflicts.

### J4. Advanced MRP

**Benchmark source:** SAP/NetSuite manufacturing  
**Purpose:** Plan materials and operations from demand.  
**Current Octagon status:** MRP page/BOMs exist; advanced planning partial.  
**Recommended location:** Existing `mrp`.  
**Detailed requirements:** BOM, routing, operation steps, material requirements, purchase/production suggestions, shortage report, capacity-aware planning.  
**Data model considerations:** BOM versions, routings, operation times.  
**Permissions and governance:** Planner proposes; procurement/production approvals.  
**AI/Jarvis behavior:** MRP Agent suggests plans only.  
**Reports / dashboards:** Shortages, suggested POs, production plan.  
**Acceptance criteria:** MRP run outputs material shortages and recommended actions without direct posting.

### J5. QC Deepening

**Benchmark source:** Manufacturing quality systems  
**Purpose:** Strengthen inspection and prevent bypass.  
**Current Octagon status:** QC center exists; depth partial.  
**Recommended location:** Existing `qc_center` and work orders.  
**Detailed requirements:** Inspection templates, defect categories, rework workflow, photos, bypass guard, customer acceptance, QC score by employee/machine/supplier.  
**Data model considerations:** QC templates, defects, evidence attachments.  
**Permissions and governance:** QC pass/fail by authorized roles; bypass requires approval.  
**AI/Jarvis behavior:** AI may summarize defects; cannot pass QC.  
**Reports / dashboards:** Defect rate, rework rate, QC scorecards.  
**Acceptance criteria:** Work order cannot close if required QC is failed or missing unless approved bypass.

### J6. Rework Analytics

**Benchmark source:** Lean manufacturing / quality analytics  
**Purpose:** Reduce repeated errors and rework cost.  
**Current Octagon status:** Partial issue/rework records.  
**Recommended location:** QC/work orders/analytics.  
**Detailed requirements:** Reason, cost, responsible section, repeated defect detection, supplier/material link, training recommendation.  
**Data model considerations:** Rework events linked to cost and root cause.  
**Permissions and governance:** Managers assign cause; sensitive blame data role-limited.  
**AI/Jarvis behavior:** AI may detect patterns and recommend training.  
**Reports / dashboards:** Rework cost and repeat defects.  
**Acceptance criteria:** Rework report ties defect to cost and corrective action.

### J7. Job Profitability

**Benchmark source:** Professional services/manufacturing ERP  
**Purpose:** See true margin per job/project.  
**Current Octagon status:** Partial through costing and sales.  
**Recommended location:** Work orders/projects/finance reports.  
**Detailed requirements:** Estimated cost, actual cost, quoted price, collected amount, margin, late penalty, rework impact, commission impact.  
**Data model considerations:** Connect quote/invoice/payment/cost/work-order records.  
**Permissions and governance:** Finance/owner view; sales sees limited margin if allowed.  
**AI/Jarvis behavior:** AI explains margin drivers; cannot alter costs.  
**Reports / dashboards:** Job P&L and margin leaderboard.  
**Acceptance criteria:** Closed job shows revenue, collections, cost, and margin.

### J8. Event / Decoration / Project Production

**Benchmark source:** Vertical project operations  
**Purpose:** Support event/decor/installation work.  
**Current Octagon status:** Events/projects/rental exist; integrated depth partial.  
**Recommended location:** Existing `events`, `projects`, `rental`, `field_service`.  
**Detailed requirements:** Build plan, site tasks, rental items, transport, crew, install/dismantle checklists, photos, client sign-off.  
**Data model considerations:** Project/event schedule and asset reservations.  
**Permissions and governance:** Project manager approves changes; client sign-off retained.  
**AI/Jarvis behavior:** AI may draft event plan; cannot confirm delivery/signoff.  
**Reports / dashboards:** Event profitability, crew load, rental utilization.  
**Acceptance criteria:** Event project can reserve rental items and track install/dismantle tasks.

---

## 18. Platform / Marketplace / Developer Ecosystem Plan

### E1. Plugin Registry

**Benchmark source:** NetSuite SuiteApps / SAP BTP  
**Purpose:** Track installed extensions safely.  
**Current Octagon status:** Missing.  
**Recommended location:** Integration Hub/Admin.  
**Detailed requirements:** Metadata, version, enabled state, permissions, routes, data keys, dependencies, compatibility, uninstall/upgrade safety.  
**Data model considerations:** `omni.plugins.registry`; do not execute arbitrary code before governance exists.  
**Permissions and governance:** System admin only.  
**AI/Jarvis behavior:** AI may explain plugin risk; cannot install/enable.  
**Reports / dashboards:** Plugin health and compatibility.  
**Acceptance criteria:** Plugin registry can describe installed module without breaking route health.

### E2. App Marketplace

**Benchmark source:** Daftra marketplace / SuiteApp  
**Purpose:** Package industry packs, reports, connectors, and AI agents later.  
**Current Octagon status:** Missing.  
**Recommended location:** New page only after product core is stable, or Integration Hub sub-tab first.  
**Detailed requirements:** Internal marketplace, install/disable apps, categories, industry packs, reports packs, connector apps, AI agents, pricing/reviews later.  
**Data model considerations:** Depends on plugin registry, license, feature flags.  
**Permissions and governance:** Admin installs; plan/license checks.  
**AI/Jarvis behavior:** AI may recommend apps; cannot purchase/install.  
**Reports / dashboards:** App adoption.  
**Acceptance criteria:** Marketplace disabled until plugin registry and auth are production-safe.

### E3. Developer API

**Benchmark source:** NetSuite/Dynamics/SAP integration platforms  
**Purpose:** Allow safe external integration.  
**Current Octagon status:** Partial local APIs exist; developer platform missing.  
**Recommended location:** Server/API layer + Integration Hub.  
**Detailed requirements:** API tokens, scoped permissions, tenant isolation, REST endpoints, read/write scopes, logs, rate limits, docs, test sandbox.  
**Data model considerations:** Token hashes and scopes, not raw tokens.  
**Permissions and governance:** Admin creates scoped tokens; all calls audit/rate-limited.  
**AI/Jarvis behavior:** AI may generate API docs/examples; cannot expose secrets.  
**Reports / dashboards:** API usage, errors, rate limit hits.  
**Acceptance criteria:** API token cannot access data outside its tenant/scope.

### E4. Webhooks

**Benchmark source:** SaaS integration ecosystems  
**Purpose:** Notify external systems when ERP events happen.  
**Current Octagon status:** Missing.  
**Recommended location:** Integration Hub.  
**Detailed requirements:** Event registry, invoice/payment/stock/approval/work-order/customer/employee events, retry, secret, logs.  
**Data model considerations:** `omni.integrations.webhooks`, deliveries.  
**Permissions and governance:** Admin configures; sensitive payload redaction.  
**AI/Jarvis behavior:** AI may help create payload mapping; cannot send secrets.  
**Reports / dashboards:** Delivery success/failure.  
**Acceptance criteria:** Failed webhook retries and logs without blocking core transaction.

### E5. Integration Hub

**Benchmark source:** SAP BTP / Dynamics connectors  
**Purpose:** Centralize external connector health and sync.  
**Current Octagon status:** Existing page; depth partial.  
**Recommended location:** Existing `integration_hub`.  
**Detailed requirements:** Connector registry, OAuth later, API keys, CSV import/export, scheduled/manual sync, logs, conflict resolution, health.  
**Data model considerations:** Connector configs should encrypt/separate secrets when productionized.  
**Permissions and governance:** Admin config; operators run safe sync if scoped.  
**AI/Jarvis behavior:** AI may diagnose sync errors; cannot expose API keys.  
**Reports / dashboards:** Connector health, sync runs, conflicts.  
**Acceptance criteria:** Connector run logs status, changed records, errors, and conflicts.

---

### M1. Contract Template Library

**Benchmark source:** Workday contract intelligence / regional legal operations  
**Purpose:** Provide reusable Arabic, English, and bilingual contract templates for business operations.  
**Current Octagon status:** Partial; Documents now has printable employee contract/company rules drafts and contracts page exists.  
**Recommended location:** Existing `documents` and `contracts`; no new page.  
**Detailed requirements:** Workshop service, supply, rental, employment, project, maintenance, and event contract templates with versioning and printable layouts.  
**Data model considerations:** `omni.contracts.templates`, language, version, jurisdiction, owner, active flag, linked document IDs.  
**Permissions and governance:** Legal/admin manage templates; operational users can draft from approved templates only.  
**AI/Jarvis behavior:** AI may draft template variants and summarize clauses; AI cannot mark a template legally approved.  
**Reports / dashboards:** Active templates, expiring review dates, template usage.  
**Acceptance criteria:** User can generate a contract draft from an approved template and preserve version/source metadata.

### M2. Contract Lifecycle Management

**Benchmark source:** NetSuite / Workday / SAP contract controls  
**Purpose:** Track contracts from draft through signature, renewal, expiry, and cancellation.  
**Current Octagon status:** Partial; contracts/documents/e-sign pieces exist but lifecycle is not complete.  
**Recommended location:** Existing `contracts`, `documents`, `esign`, approvals.  
**Detailed requirements:** Draft, review, approved, signed, active, expired, renewed, cancelled, amendments, obligations, reminders.  
**Data model considerations:** `omni.contracts.records`, states, parties, obligations, renewal dates, amendment chain.  
**Permissions and governance:** Draft by authorized owner; approve/sign/cancel require role-specific permission and audit.  
**AI/Jarvis behavior:** AI may draft, compare, and extract obligations; final issue/signature requires human approval.  
**Reports / dashboards:** Expiring contracts, unsigned contracts, obligations due, cancelled/renewed counts.  
**Acceptance criteria:** Contract state changes are permission-checked, audit-logged, and linked to documents/signatures.

### M3. Contract Intelligence

**Benchmark source:** Workday contract intelligence / enterprise legal AI  
**Purpose:** Use AI to read contract text and surface obligations, risk clauses, and differences.  
**Current Octagon status:** Missing/partial through general AI only.  
**Recommended location:** Existing `contracts`, `documents`, AI Agent Catalog.  
**Detailed requirements:** AI extracts obligations, highlights risky clauses, compares versions, drafts amendments, routes final issue to approval.  
**Data model considerations:** Store extracted obligations, risk tags, compared version IDs, and AI run audit.  
**Permissions and governance:** Legal/manager visibility; sensitive contracts not exposed to unauthorized roles.  
**AI/Jarvis behavior:** AI can analyze and draft; AI must never approve legal contract or send final copy directly.  
**Reports / dashboards:** Contract risks, obligations by owner, amendment backlog.  
**Acceptance criteria:** AI analysis is reviewable, linked to the source contract version, and clearly marked as draft.

### M4. Compliance Register

**Benchmark source:** SAP governance / enterprise risk management  
**Purpose:** Connect risks, controls, legal/tax/safety obligations, owners, evidence, and review dates.  
**Current Octagon status:** Partial; `risk_compliance` page exists.  
**Recommended location:** Existing `risk_compliance` and Security Center.  
**Detailed requirements:** Risks, controls, legal obligations, tax obligations, safety obligations, evidence, control owner, review date.  
**Data model considerations:** Extend `omni.riskCompliance` with obligation/control evidence links and review workflow.  
**Permissions and governance:** Managers own controls; auditors/admins review; changes audit-logged.  
**AI/Jarvis behavior:** AI may identify missing evidence and draft risk summaries; AI cannot close controls without approval.  
**Reports / dashboards:** Open risks, overdue controls, evidence completeness, compliance calendar.  
**Acceptance criteria:** Every high-risk control has owner, evidence, review date, and audit trail.

### M5. E-Invoicing / Tax Deepening

**Benchmark source:** Daftra e-invoicing / regional tax requirements  
**Purpose:** Prepare invoice/tax outputs for country-specific validation and export.  
**Current Octagon status:** Partial tax compliance page exists; country-grade e-invoicing missing.  
**Recommended location:** Existing `tax_compliance`, invoices/sales/finance reports.  
**Detailed requirements:** Country profiles, tax rules, invoice fields, QR code, export formats, validation, audit.  
**Data model considerations:** `finance.taxProfiles`, `invoiceTaxFields`, validation results, export batches.  
**Permissions and governance:** Finance manages tax settings; export/submission audit-logged.  
**AI/Jarvis behavior:** AI may explain tax validation errors; AI cannot alter submitted tax records directly.  
**Reports / dashboards:** Tax return support, validation errors, submitted/exported invoice list.  
**Acceptance criteria:** Invoice validation can run against selected country profile and produce auditable result.

### N1. WooCommerce Connector

**Benchmark source:** Daftra marketplace/connectors / SaaS commerce integration  
**Purpose:** Sync products, customers, orders, stock, and invoices with WooCommerce.  
**Current Octagon status:** Missing; integration hub foundation exists.  
**Recommended location:** Existing `integration_hub` after Developer API/Webhooks are ready.  
**Detailed requirements:** Product sync, order import, customer import, stock sync, invoice creation, payment status, webhook logs, conflict handling.  
**Data model considerations:** Connector config, external IDs, sync batches, conflict records, secret storage.  
**Permissions and governance:** Admin configures; sync writes permission-checked and logged.  
**AI/Jarvis behavior:** AI may explain sync conflicts; AI cannot expose API keys or force overwrite.  
**Reports / dashboards:** Sync health, imported orders, stock conflicts, failed webhooks.  
**Acceptance criteria:** Connector can import a test order without duplicating customers/products.

### N2. Shopify Connector

**Benchmark source:** Global e-commerce ERP connectors  
**Purpose:** Support Shopify product, order, customer, stock, and payment mapping.  
**Current Octagon status:** Missing.  
**Recommended location:** Existing `integration_hub`; depends on API/token foundation.  
**Detailed requirements:** Product sync, order import, customer sync, stock sync, payment mapping.  
**Data model considerations:** External IDs and idempotent import keys are mandatory.  
**Permissions and governance:** Admin-only setup; finance review for payment mapping.  
**AI/Jarvis behavior:** AI can summarize sync status; cannot change connector credentials.  
**Reports / dashboards:** Shopify order import status, stock mismatch, payment reconciliation queue.  
**Acceptance criteria:** Re-running sync is idempotent and does not duplicate orders.

### N3. Salla / Zid Connector

**Benchmark source:** Gulf market ERP connectors  
**Purpose:** Support regional online stores used in Arabic markets.  
**Current Octagon status:** Missing.  
**Recommended location:** Existing `integration_hub`; after generic connector patterns.  
**Detailed requirements:** Product sync, order import, invoice creation, customer sync, stock sync.  
**Data model considerations:** Regional tax/shipping/payment mapping fields.  
**Permissions and governance:** Admin config; finance validates invoice/tax mapping.  
**AI/Jarvis behavior:** AI may help map statuses and explain sync errors.  
**Reports / dashboards:** Gulf connector health, imported orders, failed sync.  
**Acceptance criteria:** Connector imports a sample order and maps customer/product/payment consistently.

### N4. Payment Gateway Integration

**Benchmark source:** Daftra/SaaS commerce payments  
**Purpose:** Create payment links and reconcile external payment status.  
**Current Octagon status:** Missing/partial payment tracking exists.  
**Recommended location:** Sales/finance/integration hub.  
**Detailed requirements:** Payment link, status, reconciliation, failed payment, refund, gateway fees.  
**Data model considerations:** Payment intents, gateway transaction IDs, fee lines, refund links.  
**Permissions and governance:** Finance controls reconciliation/refunds; external callbacks logged.  
**AI/Jarvis behavior:** AI may explain failed payments and fee variance; cannot issue refunds directly.  
**Reports / dashboards:** Payment status, gateway fees, unreconciled payments, refunds.  
**Acceptance criteria:** Payment callback updates a pending payment safely and queues reconciliation if needed.

### N5. WhatsApp Integration

**Benchmark source:** Daftra regional customer operations  
**Purpose:** Enable governed customer communication for orders, invoices, approvals, reminders, and support.  
**Current Octagon status:** Partial WhatsApp page/sharing concepts exist; live integration not complete.  
**Recommended location:** Existing `whatsapp`, sales, approvals, customer portal, helpdesk.  
**Detailed requirements:** Order intake, invoice share, approval link, customer update, payment reminder, support ticket creation.  
**Data model considerations:** Message templates, contact consent, delivery logs, inbound message records.  
**Permissions and governance:** External sends require template/role permission and audit; consent policy needed.  
**AI/Jarvis behavior:** AI may draft message text and classify inbound requests; AI cannot send sensitive messages without explicit user action/approval.  
**Reports / dashboards:** Delivery status, reminders sent, inbound requests, conversion rate.  
**Acceptance criteria:** Sending/receiving creates auditable logs and never exposes unauthorized customer/finance data.

---

## 19. Industry Vertical Completion Plan

Do not add duplicate vertical pages. Deepen the existing pages with data templates, workflows, reports, and guarded actions.

| Vertical | Current status | Missing commercial depth | Recommended location |
|---|---|---|---|
| O1 Workshop/custom manufacturing | Strongest current vertical | quote-to-job, full costing, scheduler, QC analytics, delivery/payment close | Existing work orders/MRP/QC/sales |
| O2 Retail | POS/inventory foundations | returns, loyalty, shifts, branch pricing, barcode operations | Existing retail/POS/inventory |
| O3 Pharmacy | Vertical page exists | batch/expiry, prescription fields if needed, near-expiry, controlled stock warning | Existing pharmacy/inventory |
| O4 Clinic | Vertical page exists | patient file, appointments, visits, services, invoices, medical docs, doctor schedule | Existing clinic/appointments/documents |
| O5 Restaurant | Vertical page exists | tables, kitchen display, menu/modifiers, recipes, stock deduction, delivery, cashier close | Existing restaurant/POS/inventory |
| O6 Hotel | Vertical page exists | rooms, reservations, check-in/out, housekeeping, invoices, occupancy, seasonal pricing | Existing hotel/appointments/sales |
| O7 Real Estate | Vertical page exists | properties, units, leases, tenants, rent schedules, maintenance, collections | Existing real-estate/contracts/finance |
| O8 Fleet/Logistics | Existing fleet/logistics pages | vehicles, drivers, trips, fuel, delivery costs, maintenance, Fleet Fuel Guard demo planning for diesel/kaz monitoring, geofence speed rules, anomaly scoring, and audited investigations | Existing fleet/logistics/assets/reports |
| O9 Field Service | Existing field_service page | dispatch, checklist, materials, signature, invoice request | Existing field_service/PWA |

For each vertical, acceptance requires sample data, core workflow, printable forms, role permissions, reports, and at least one dashboard tied to real records.

---

## 20. Implementation Methodology / Go-Live Plan

### K1. Company Setup Wizard

**Benchmark source:** SAP Activate / NetSuite implementation  
**Purpose:** Standard first-run setup.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Admin/multi-entity.  
**Detailed requirements:** Business type, modules, branches, warehouses, COA, tax, users, roles, opening balances, starting inventory.  
**Data model considerations:** Setup progress and approvals.  
**Permissions and governance:** Admin/finance approvals for opening balances.  
**AI/Jarvis behavior:** AI may guide checklist; cannot post balances.  
**Reports / dashboards:** Setup readiness.  
**Acceptance criteria:** New company reaches ready state with checklist sign-off.

### K2. Industry Templates

**Benchmark source:** NetSuite/SAP vertical editions  
**Purpose:** Package Octagon for workshop, retail, pharmacy, clinic, restaurant, hotel, real estate, contracting, event/decor, manufacturing.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Setup wizard + feature flags.  
**Detailed requirements:** Enabled modules, default roles, workflows, reports, forms, sample data, required setup steps.  
**Data model considerations:** Template definitions versioned.  
**Permissions and governance:** Admin applies template; destructive changes blocked.  
**AI/Jarvis behavior:** AI may recommend template based on business type.  
**Reports / dashboards:** Template adoption and missing setup.  
**Acceptance criteria:** Applying a template configures modules without breaking unrelated pages.

### K3. Data Import Center

**Benchmark source:** ERP implementation basics  
**Purpose:** Bring customer data into Octagon safely.  
**Current Octagon status:** Import foundations exist; full center incomplete.  
**Recommended location:** Existing `import`.  
**Detailed requirements:** Customers, suppliers, employees, inventory, accounts, opening balances, assets, price lists, templates, validation, rollback if possible.  
**Data model considerations:** Import batches, row errors, rollback markers.  
**Permissions and governance:** Imports require role permissions and audit.  
**AI/Jarvis behavior:** AI may map columns and detect errors; cannot import without user confirmation.  
**Reports / dashboards:** Import status and errors.  
**Acceptance criteria:** Invalid rows are rejected before write with clear error report.

### K4. Opening Balance Wizard

**Benchmark source:** Accounting implementation  
**Purpose:** Initialize finance and stock correctly.  
**Current Octagon status:** Missing/partial.  
**Recommended location:** Finance/Admin setup.  
**Detailed requirements:** Cashbox, bank, customers, suppliers, inventory, fixed assets, loans, equity, audit.  
**Data model considerations:** Opening balances must be locked after approval.  
**Permissions and governance:** Finance manager prepares; owner approves.  
**AI/Jarvis behavior:** AI may validate balance equation; cannot post.  
**Reports / dashboards:** Opening balance proof and approval status.  
**Acceptance criteria:** Approved opening balances reconcile and cannot be edited without unlock approval.

### K5. Go-Live Checklist

**Benchmark source:** SAP/NetSuite go-live method  
**Purpose:** Make deployment repeatable and auditable.  
**Current Octagon status:** Partial deploy readiness exists.  
**Recommended location:** `deploy_ready`.  
**Detailed requirements:** Users, permissions, backups, opening balances, inventory count, payroll settings, reports, route health, regression, owner sign-off.  
**Data model considerations:** Checklist item status and evidence.  
**Permissions and governance:** Owner/admin sign-off.  
**AI/Jarvis behavior:** AI may identify missing go-live evidence.  
**Reports / dashboards:** Go-live readiness score.  
**Acceptance criteria:** No live deployment if P0 checklist items fail.

### K6. Training Checklist

**Benchmark source:** ERP rollout practice  
**Purpose:** Ensure users know core workflows.  
**Current Octagon status:** Training LMS page exists; content/deployment partial.  
**Recommended location:** `training_lms` + setup wizard.  
**Detailed requirements:** Admin, accountant, sales, warehouse, production, employee mobile, manager approvals training.  
**Data model considerations:** Training completions per role/user.  
**Permissions and governance:** Managers track team training.  
**AI/Jarvis behavior:** AI may generate role-specific training plan.  
**Reports / dashboards:** Training completion and overdue users.  
**Acceptance criteria:** Go-live checklist can require training completion by role.

---

## 21. Priority Matrix

### P0 Must Finish Before Real Live Deployment

- Server-side production authentication and session handling.
- Remote Git backup and release discipline.
- Backup/restore verification.
- Audit Log Center for sensitive actions.
- Period locks if financial posting is active.
- Permission regression and action coverage for new sensitive actions.
- Route health and syntax checks.
- Data quality checks for master data and security gaps.

### P1 Must Have for Commercial ERP

- Report Designer and Arabic PDF/Excel exports.
- Financial statements and aging reports.
- Setup wizard, import center, opening balance wizard.
- Feature flags and license center.
- Manager mobile approvals and employee self-service.
- HR contracts, leave, salary components, custody.
- Advanced inventory basics: batch/expiry, min/max, reservations, stock counts.
- Commission engine, installments, price lists, POS deepening, customer statements.

### P2 Strong Differentiators

- Governed Agent Catalog.
- AI simulation/dry-run.
- Contract intelligence.
- Mobile inventory count and field service.
- Workflow/report designer maturity.
- Industry templates.
- Executive dashboards and mobile digest.
- Capacity planning, workshop scheduler, QC analytics.

### P3 Platform / Scale

- Developer API.
- Webhooks.
- Plugin registry.
- App marketplace.
- E-commerce connectors.
- Multi-company consolidation.
- Connector health and scheduled sync.

### P4 Future / Optional

- Native mobile apps.
- Advanced OCR beyond expense drafts.
- Advanced data warehouse.
- Multi-country tax packs beyond first target market.
- Partner program.
- Marketplace monetization and reviews.

---

## 22. Recommended Phases

## Phase 7A - Stabilize Product Core

Goal: Make the current product safe enough for the next feature wave.  
Features: Commit/park `app.js` delta, configure remote Git backup, server-side auth/session, backup verification, Audit Log Center, Release Center, period lock foundation, data quality expansion.  
Acceptance: No uncommitted critical code, remote backup exists, auth protects server/API, backup restore test passes, 35/35 regression passes, route baseline remains 86/86.  
Do not include: new vertical features, marketplace, e-commerce, native apps.  
Risks: auth touches many flows; keep rollout incremental and regression-backed.

## Phase 7B - Report Designer and Smart Views

Goal: Build commercial reporting foundation.  
Features: Report Designer, saved views, Arabic PDF/Excel export, finance statement engine starter, executive dashboards.  
Acceptance: Users can build/save/export finance, inventory, HR, and workshop reports with permission enforcement.  
Do not include: AI auto-posting, external scheduled delivery.  
Risks: report engine must respect source permissions.

## Phase 7C - Mobile / PWA Suite

Goal: Make manager and employee workflows usable on phones.  
Features: Manager approvals PWA, employee self-service, mobile inventory count starter, mobile dashboard.  
Acceptance: Mobile viewports pass layout QA; approval and employee data isolation work.  
Do not include: native mobile apps.  
Risks: offline caching must not leak sensitive data.

## Phase 7D-FleetDemo - Fleet Fuel Guard Presentation Foundation

Goal: Build a customer-demo foundation for controlling more than 100 vehicles/equipment units, tracking diesel/kaz fuel behavior, detecting possible theft, applying geofence speed limits, and presenting the control model clearly.  
Features: Fleet command map mock/grid, vehicle/equipment register, geofences, zone speed policies, full vehicle/equipment history, trip history, detailed fuel refill/measurement ledger, oil-change/service/inspection tracking, anomaly center, dashboard, investigation/approval flow, customer demo reports, and AI explanation boundaries.  
Acceptance: Demo scope is documented and later implemented without adding sidebar pages by default, without route baseline break, without destructive data migration, and without claiming hardware integration.  
Do not include: live GPS/OBD/CAN/J1939/tank-sensor integrations, vendor-specific promises, direct AI approvals, fuel-ledger mutation by AI, or `database.json` migration during planning.  
Risks: Demo claims must stay clear about mock/manual data until hardware and ingestion contracts are implemented.

## Phase 7D - Agent Catalog

Goal: Turn Jarvis into governed process agents.  
Features: Agent registry, permissions, dry-run preview, AI usage governance, Report Builder Agent, Bank Reconciliation Agent, HR Leave Agent.  
Acceptance: All agents have policies and high-risk writes route to approval.  
Do not include: direct finance/payroll/stock posting by AI.  
Risks: tool boundaries must be regression-tested.

## Phase 7E - HRMS Completion

Goal: Complete employee lifecycle.  
Features: Employee master file, org chart, contracts lifecycle, onboarding/offboarding, leave, attendance corrections, salary components, custody.  
Acceptance: Employee lifecycle from hire to exit is auditable and payroll-aware.  
Do not include: advanced talent AI without permissions.  
Risks: payroll-sensitive changes must remain approval/lock aware.

## Phase 7F - Finance Close and Planning

Goal: Make finance enterprise-ready.  
Features: Month-end close, period locking, statements, aging, cash forecast, cost centers, budget vs actual, cheque lifecycle, bank import.  
Acceptance: Closed periods block edits; statements reconcile to accounts/journals.  
Do not include: consolidation until single-company statements are stable.  
Risks: accounting accuracy requires careful COA mapping.

## Phase 7G - Advanced Inventory

Goal: Make stock safe for workshop, retail, pharmacy, food, and manufacturing.  
Features: Batch/serial/lot, expiry, min/max, reserved vs available, stock counts, internal requests, landed cost starter, barcode labels.  
Acceptance: Stock reports separate on-hand, reserved, available, expired, and count variance.  
Do not include: large API/e-commerce stock sync yet.  
Risks: stock model changes affect work orders and POS.

## Phase 7H - Sales Commercial Pack

Goal: Improve revenue workflows.  
Features: Commission engine, sales targets, installments, advanced price lists, loyalty maturity, quote-contract-order lifecycle, POS deepening, sharing templates.  
Acceptance: Sales lifecycle and collections can be traced to finance and reports.  
Do not include: external marketplace or broad e-commerce connectors.  
Risks: discount/commission rules must not undermine margin controls.

## Phase 7I - Implementation and Industry Templates

Goal: Make deployments repeatable.  
Features: Company setup wizard, industry templates, data import center, opening balance wizard, go-live checklist, training checklist.  
Acceptance: A new tenant can be configured using a template and signed off.  
Do not include: app marketplace.  
Risks: templates need feature flags and permissions alignment.

## Phase 7J - Platform / Marketplace

Goal: Build extension foundation after core product is stable.  
Features: Plugin registry, developer API, webhooks, Integration Hub maturity. Marketplace remains internal/staged.  
Acceptance: Scoped API token and webhook cannot access outside tenant/scope.  
Do not include: public marketplace monetization.  
Risks: secrets and tenant isolation must be production-grade.

## Phase 7K - E-Commerce and External Connectors

Goal: Connect online sales after API/integration foundation exists.  
Features: WooCommerce, Shopify, Salla/Zid, payment gateway, WhatsApp integration.  
Acceptance: Product/order/customer/stock sync has logs, conflicts, and rollback path.  
Do not include: connectors before API/webhooks are stable.  
Risks: stock conflicts and external payment reconciliation.

## Phase 7L - Industry Vertical Completion

Goal: Turn vertical shells into sellable editions.  
Features: workshop, retail, pharmacy, clinic, restaurant, hotel, real estate, fleet/logistics, field service templates and workflows.  
Acceptance: Each vertical has sample data, workflows, reports, permissions, and printable forms.  
Do not include: new duplicate pages.  
Risks: shallow verticals damage demos; prioritize one or two markets first.

---

## 23. Risks and Dependencies

| Risk | Impact | Mitigation |
|---|---|---|
| No production server auth | Cannot safely deploy | Phase 7A first |
| No remote Git | Local data/code loss risk | Add remote backup before more work |
| Huge `app.js` | High regression risk | Incremental extraction only during feature work |
| Uncommitted `app.js` delta | Ambiguous baseline | Commit or park before Phase 7A |
| Reporting accuracy gaps | Commercial trust risk | Build report engine + financial statements early |
| Stock model changes | Can break POS/work orders | Add tests and staged migration |
| AI overreach | Finance/payroll/security risk | Agent permissions, dry-run, approval queue |
| Industry shells too shallow | Demo/product credibility risk | Add sample data and workflows before selling vertical |
| Local-first storage | Multi-user/cloud deployment complexity | Define deployment modes explicitly |

Dependencies:

- Phase 7A blocks real deployment.
- Reporting/financial statements should precede advanced SaaS sales demos.
- Feature flags should precede industry templates and plans.
- Developer API/webhooks must precede e-commerce connectors.
- PWA should precede native mobile apps.
- Plugin registry should precede marketplace.

---

## 24. What NOT To Build Yet

- Do not add 50 new sidebar pages.
- Do not duplicate existing ERP pages.
- Do not rewrite the whole system.
- Do not replace Jarvis.
- Do not remove local-first behavior.
- Do not delete locked payroll/finance modules.
- Do not implement everything in one phase.
- Do not switch risky security behavior in one uncontrolled batch.
- Do not build marketplace before product core is stable.
- Do not build e-commerce connectors before API/webhook foundation exists.
- Do not build native mobile apps before PWA is mature.
- Do not build marketplace billing/partner program before plans, licensing, and auth are stable.
- Do not allow AI to post finance, alter payroll, delete records, approve its own requests, or bypass QC.

---

## 25. Final Agent-Ready Summary

Future coding agents should work from this sequence:

1. Re-check `git status --short`, `git log --oneline --decorate --graph --max-count=30`, syntax, JSON parse, and `node scripts/permission-regression.mjs`.
2. Do not add sidebar pages unless a feature is truly impossible inside existing pages/services.
3. Prefer existing pages, sub-tabs, shared services, reports, PWA modes, approval workflows, integration connectors, or AI agents.
4. Add permission/action policies for every new sensitive write.
5. Keep AI read-only, draft-only, or approval-routed for finance, payroll, stock, contracts, security, and QC.
6. Update `HERE.md` and `STRUCTURE.md` only when implementation work changes the live system; this roadmap is planning-only.
7. Keep route health at 86/86 unless a deliberate product decision changes the page set.
8. Commit atomically and preserve local-first safety.

Recommended next coding prompt:

**Phase 7A - Server-Side Authentication, Remote Git Backup, Audit Center, Backup Verification, and Period Lock Foundation**

The prompt should explicitly say: do not add new sidebar pages, do not reset `database.json`, preserve 86/86 route health, keep AI high-risk actions approval-gated, run `node --check`, JSON parse, and `node scripts/permission-regression.mjs`.

### Phase 7A Start Note - 2026-06-26

Phase 7A execution has started after Stage 1 stabilization. The roadmap baseline was committed separately from the pending `app.js` maintenance delta. The first Phase 7A slice adds a minimal server auth/session bridge, audit review panel, backup verification/status foundation, release readiness panel, period-lock helper, and deployment-blocker checks inside existing pages only. This is not Phase 7B reporting work and does not add sidebar pages.

### Phase 7B Production Safety Note - 2026-06-26

Phase 7B closes production-safety gaps before feature expansion: server/port diagnostics, `/api/server/status`, sensitive API session/role gates, restore dry-run comparison, typed-confirmation restore protection, richer production blocker dashboard, auth session-mode indicator, and remote Git status guidance. It still does not add sidebar pages, does not reset `database.json`, and does not push to any remote.

---

# Final Short Summary for Saif

- What Octagon already has: 86 routed pages, 86 views, 35/35 permission regression pass, payroll/finance/workshop/inventory/POS/AI/governance/legal-document foundations, and complete page permission mapping from the Phase 6H baseline.
- What is still missing: production server authentication, remote Git backup, report designer, financial statements, close/period locks, advanced inventory, HRMS lifecycle, PWA workflows, governed AI agent catalog, SaaS packaging, implementation methodology, API/webhooks, connectors, and vertical depth.
- What must be built first: Phase 7A stabilization, especially server-side auth/session handling, remote backup, audit center, backup verification, release readiness, and period lock foundation.
- What must not be built yet: marketplace, e-commerce connectors, native apps, broad new pages, and direct AI execution of finance/payroll/stock/security/legal actions.
- The recommended next prompt title: **Phase 7A - Server-Side Authentication, Remote Git Backup, Audit Center, Backup Verification, and Period Lock Foundation**.
