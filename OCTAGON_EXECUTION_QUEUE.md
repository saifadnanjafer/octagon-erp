# Octagon ERP Execution Queue

## Current Baseline

Last verified commit:
`44f93f5 phase7c cleanup route pwa cache and inventory count safety`

Current protected route baseline:
- public nav pages: 86
- public view markers: 86
- counted routed view files: 86
- total view files: 88
- internal route-less views:
  - manager_approvals
  - mobile_inventory_count

Current validation baseline:
- permission regression: 35/35
- database parse: PASS
- route health: PASS
- backup verify: PASS
- git status: clean at last report

Important:
Do not increase public page count unless the phase explicitly requires it and Saif approves.

---

## Execution Rules

- Execute only one phase per `كمل` unless Saif explicitly asks for multiple.
- Never use `git add .`.
- Do not push.
- Do not reset/revert without explicit Saif approval.
- Do not mutate `database.json` directly.
- Do not run destructive restore.
- Do not add random sidebar pages.
- Prefer existing pages, sub-tabs, panels, services, reports, and PWA/internal views.
- Preserve Arabic-first UI.
- Preserve local-first behavior.
- Preserve AI-first, not AI-only behavior.
- AI/Jarvis must never directly execute high-risk finance, payroll, stock, security, legal, or QC actions.
- High-risk actions must go through approvals and audit.

---

## Stop Conditions

Stop immediately and report if any of these happen:

- `database.json` parse fails
- permission regression fails
- route health drops below protected baseline
- public view count changes unexpectedly
- service worker caches `/api/*`, `/api/db`, `/api/auth`, or `database.json`
- AI/Jarvis can approve or execute high-risk writes
- a stock/finance/payroll write bypasses approval or audit
- Git status contains unexpected runtime/database/backup files
- a phase requires destructive migration
- browser smoke shows fatal app load errors

---

## Standard Baseline Check Before Every Phase

Run:

```bash
git status --short
git log --oneline --decorate --graph --max-count=10
node --check app.js
node --check server.js
node --check services/permissionService.js
node --check services/auditService.js
node --check services/stateService.js
node --check services/tenantService.js
node --check modules/route-health.js
node --check modules/phase7a-stabilization.js
node scripts/permission-regression.mjs
node -e "JSON.parse(require('fs').readFileSync('database.json','utf8')); console.log('database.json parse: PASS')"
```

Also check if server is running:

```bash
node -e "fetch('http://localhost:8080/api/release/status').then(r=>r.json()).then(j=>console.log(JSON.stringify(j.route||j,null,2))).catch(e=>console.error(e.message))"
node -e "fetch('http://localhost:8080/api/backup/verify').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2))).catch(e=>console.error(e.message))"
```

If 8080 is unavailable and the app uses a fallback port, report it clearly.

---

## Phase Queue

### Phase 7A — Stabilize Product Core

Status: DONE
Commit: `9f7d145`

Scope:
* server auth/session foundation
* audit panels
* backup verify endpoint
* release readiness endpoint
* period lock foundation
* data quality expansion

Notes:
* Completed before the early Phase 7C work.

---

### Phase 7C-Early — Mobile / PWA Suite

Status: DONE_EARLY
Commit: `3ac49d5`

Scope:
* PWA manifest
* service worker
* manager approvals internal view
* mobile inventory count internal view
* employee/frontline mobile updates
* mobile approval flow

Notes:
* Built early before Phase 7B.
* Accepted only after cleanup commit.

---

### Phase 7C-Cleanup — Route/PWA/Inventory Safety

Status: DONE
Commit: `44f93f5`

Scope:
* internal route-less views excluded from counted routed view baseline
* localhost service worker bypass
* Octagon cache cleanup
* inventory count canonical location safety
* stock sync between `warehouseStock` and `locationStock`
* stock drift data quality warnings

Notes:
* This phase made the early Mobile/PWA work safe enough to keep.
* Do not expand Mobile/PWA further until Phase 7B is complete.

---

### Phase 7B — Production Safety Closure

Status: DONE
Commit: `d5cf44c`

Scope:
1. Remote Git readiness/status
2. API session enforcement matrix
3. Server/port diagnostics
4. Auth user/role cleanup
5. Backup restore dry-run
6. Data quality production blockers
7. Browser smoke recovery
8. Documentation/handover update

Acceptance:
* Git remote status is visible in release readiness.
* API endpoints are classified:
  * public
  * session required
  * admin required
  * webhook-special
  * diagnostic
  * dangerous/destructive
* Sensitive write APIs are not anonymously writable.
* `/api/db POST` is protected or explicitly local-dev/admin gated.
* `/api/auth/session` leaks no secrets.
* `/api/release/status` leaks no secrets.
* `/api/backup/verify` is safe and non-destructive.
* Restore remains dry-run only unless explicit typed confirmation and pre-restore backup exist.
* Server status shows:
  * port
  * fallback port usage
  * uptime
  * root path
  * database path
  * node version
* Data Quality shows production blockers with:
  * severity
  * affected count
  * sample records
  * recommendation
  * owner role
* Browser smoke is attempted honestly.
* Route baseline remains:
  * public nav: 86
  * public markers: 86
  * counted routed views: 86
  * total view files: 88
  * internal route-less views: 2
* Permission regression remains 35/35 or better.
* Commit after success:
  `phase7b close production safety gaps`

Do not build:
* Report Designer
* Agent Catalog
* Marketplace
* SaaS billing
* E-commerce connectors
* new public pages

---

### Phase 7D — Report Designer and Smart Views

Status: PENDING
Priority: P1
Blocked by: None

Goal:
Build the first commercial ERP feature expansion after safety closure.

Scope:
* report builder
* saved filters
* smart views
* role-based report access
* printable Arabic layouts
* Excel/PDF export if existing export patterns support it
* report scheduler placeholder only if safe
* AI natural-language report drafting without direct data mutation

Implementation rule:
Use existing `nl_reports`, analytics, and reporting surfaces where possible. Do not add duplicate reporting pages unless justified.

Acceptance:
* no route baseline break
* report definitions are saved safely
* AI only drafts/explains reports
* exports are safe and audited if needed

Commit:
`phase7d report designer and smart views`

---

### Phase 7E — SaaS Productization Foundation

Status: PENDING
Priority: P1
Blocked by: Phase 7D unless Saif changes priority

Goal:
Prepare Octagon as a sellable product.

Scope:
* feature flags
* plan/tier placeholders
* demo company mode
* setup wizard foundation
* tenant onboarding checklist
* license/activation status placeholder
* no real payment gateway yet

Commit:
`phase7e saas productization foundation`

---

### Phase 7F — Agent Catalog Foundation

Status: PENDING
Priority: P2
Blocked by: Phase 7D and basic reporting/productization foundations

Goal:
Turn Jarvis from general assistant into governed business agents.

Scope:
* agent registry
* allowed tools
* blocked tools
* dry-run mode
* human approval checkpoint
* agent audit logs
* no direct high-risk execution

Initial agents:
* Report Builder Agent
* Executive Briefing Agent
* Inventory Reorder Agent
* Bank Reconciliation Agent
* Workshop Scheduling Agent
* QC/Rework Agent
* Contract Drafting Agent
* HR Leave Agent

Commit:
`phase7f agent catalog foundation`

---

### Phase 7G — HRMS Completion

Status: PENDING
Priority: P1/P2

Goal:
Upgrade HR from payroll/attendance to HRMS.

Scope:
* contracts lifecycle
* org chart
* onboarding/offboarding
* leave impact
* custody/assets
* disciplinary actions
* performance reviews
* workforce planning
* skills matrix
* final settlement

Commit:
`phase7g hrms completion foundation`

---

### Phase 7H — Finance Close and Planning

Status: PENDING
Priority: P1/P2

Goal:
Enterprise-grade finance controls.

Scope:
* month-end close checklist
* period lock UI hardening
* financial statements polish
* AR/AP aging
* cash flow forecast
* budget vs actual
* audit export
* consolidation placeholder

Commit:
`phase7h finance close and planning`

---

### Phase 7I — Advanced Inventory and Supply Chain

Status: PENDING
Priority: P1/P2

Goal:
Make inventory suitable for workshop, pharmacy, retail, and manufacturing.

Scope:
* serial/lot/batch
* expiry
* min/max reorder
* reserved vs available
* stock count sessions
* internal stock requests
* landed cost
* barcode/QR labels
* supplier performance

Commit:
`phase7i advanced inventory and supply chain`

---

### Phase 7J — Sales Commercial Pack

Status: PENDING
Priority: P2

Goal:
Commercial sales maturity.

Scope:
* commission engine
* sales targets
* installments
* advanced price lists
* loyalty
* customer statements
* quote to contract to work order
* WhatsApp/email sharing

Commit:
`phase7j sales commercial pack`

---

### Phase 7K — Implementation Methodology and Industry Templates

Status: PENDING
Priority: P2/P3

Goal:
Make Octagon deployable for real customers.

Scope:
* company setup wizard
* industry templates
* data import center
* opening balance wizard
* go-live checklist
* training checklist

Commit:
`phase7k implementation methodology`

---

### Phase 7L — Platform / Marketplace / Developer Ecosystem

Status: PENDING
Priority: P3

Goal:
Make Octagon extensible.

Scope:
* plugin registry
* API tokens
* webhooks
* connector registry
* internal marketplace
* developer docs

Commit:
`phase7l platform marketplace foundation`

---

### Phase 7M — E-Commerce and External Connectors

Status: PENDING
Priority: P3/P4
Blocked by: Phase 7L

Scope:
* WooCommerce connector
* Shopify connector
* Salla/Zid connector
* payment gateway status integration
* WhatsApp integration expansion

Commit:
`phase7m ecommerce connectors`

---

## Current Next Action

The next action is:

`Phase 7D — Report Designer and Smart Views`

Do not execute any other phase before Phase 7D unless Saif explicitly changes priority.

---

## After Each Phase

Update this file:
* set phase status to DONE / PARTIAL / BLOCKED
* add commit hash
* add validation result
* add remaining risks
* update “Current Next Action”

Also update:
* `HERE.md`
* `STRUCTURE.md`
* `OCTAGON_MASTER_ERP_COMPLETION_ROADMAP.md` only with short status note if needed

Do not rewrite the full roadmap.

---

## Standard Final Report

Every phase report must end with:

```md
## Next Automatic Step

If Saif says `كمل`, the next phase will be:
`<phase name>`

Reason:
`<why this phase is next>`

Blocked by:
`<none or listed blockers>`
```
