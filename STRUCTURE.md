# Octagon ERP Structure

This system is built as a single-page application (SPA) with a modular architecture for AI-driven operation.

## Key Files

- `index.html`: Entry point of the ERP system, loading all required modules, stylesheets, and pages.
- `app.js`: Main ERP application logic, handling live store operations and state.
- `style.css`: Core stylesheet for general layout and spacing.
- `omni-ai-assistant.js`: The AI assistant panel wrapper, carrying resizable/movable UI states and layout persistence.
- `jarvis-voice-runtime.js`: Dedicated Voice Runtime for hands-free audio capturing, state machine, and echo loops.
- `jarvis-visual-overlay.css`: Scoped CSS styles for JARVIS pulsing visual highlights and status cards.

## Modules Directory (`modules/`)
- `jarvis-system-map.js`: Scans the DOM and caches ERP pages, forms, and actions.
- `jarvis-action-agent.js`: Highlights active targets and executes deterministic action IDs safely.
- `jarvis-test-harness.js`: Diagnostics self-test modal, programmatic matrix, and report exporter.
- `ai-providers.js`: Standardized provider routing (OpenRouter / Gemini fallbacks).
- `jarvis-brain.js`: Planner/executor coordinating user requests with direct tools and approval center requests.
- `ai-governance.js`: Registers tool permissions and policies, auditing all AI operations.
- `pos.js`, `mrp.js`, `workshop-ai.js`, `route-health.js`, etc.: Sector-specific business and diagnostic logic.

## Services Directory (`services/`)
- `financeService.js`, `stockService.js`, `recordService.js`, `tenantService.js`: State managers handling the ERP database.

## Page / Route Registry (reconciled 2026-06-23)
A page is "fully wired" when it appears consistently in **six** places. As of this pass all **86** sidebar pages agree (79 after the 2026-06-22 reconciliation; +`appointments` +`loyalty` 06-22; +`esign` +`events` +`knowledge` +`surveys` +`visitors` +`risk_compliance` 06-23):

| Registry | Where | Count | Role |
| --- | --- | --- | --- |
| Sidebar buttons | `index.html` `.nav-btn[data-page]` | 86 | what the user can click |
| View markers `<!-- view:key -->` | `index.html` | 86 | **documentary manifest only** — NOT parsed at runtime (only the build-time `scratch/extract_views.js` reads them) |
| Page templates | `views/<key>.html` | 86 | the actual `<section class="page">`, fetched on demand |
| Dynamic loader map | `app.js` → `ensurePageTemplateLoaded()` `pageMap` + `prefetchAllViews()` | 86 | appends each template into `#mainContent` and warms them on boot |
| Renderer | core `app.js` (`switchPage` inline `pageMap`, 31 core pages) **or** a module that wraps `window.switchPage` (enterprise-suite, route-health, appointments…) | 86 | hydrates the page body |
| Route Health | `modules/route-health.js` (runtime) | 86/86 | audits nav↔section↔renderer live |

Notes:
- **Route Health is a dynamic metric**: it enumerates live `.nav-btn[data-page]` and checks each has a matching section + render hook. Its denominator therefore **equals the current sidebar size**. Older audits that said "66/66" were point-in-time snapshots taken before later pages (warranty, the 11 enterprise-suite tabs, appointments, …) were added — not a cap or a regression.
- **Permissions** (`services/permissionService.js` `PAGE_PERMISSIONS`) intentionally restrict only ~28 sensitive core pages (finance/workshop/admin). Every other page — all verticals, all enterprise-suite tabs, and `appointments` — is **default-allow** (`checkPage` returns `true` when a page has no entry). This is by design, not a gap.
- The `switchPage` inline `pageMap` (31 entries) covers only the original core pages; the remaining ~55 are routed by the dynamic loader + per-module `switchPage` wrappers. Both together cover all 86.
- **Governance freeze 2026-06-23:** `risk_compliance` is an active routed page and participates in the 86/86 baseline. It is not fully read-only: it can persist self-contained governance records under `omni.riskCompliance` when the user adds/updates risks or controls. It does not post financial/accounting/payroll/stock/QC/price changes and does not mutate locked payroll/finance pages. It uses `PermissionService.checkPage('risk_compliance')`, which currently resolves through the default-allow behavior because only sensitive pages are explicitly mapped.
- **Handover protocol:** `MASTER_ROADMAP.md` is the long-range single source of truth; `HERE.md` is the short live handoff; `STRUCTURE.md` is the route/page registry. `CODEX_RUNBOOK.md` and `all into here file.md` are not present in the current root and were not restored during the 2026-06-23 governance freeze because the current `MASTER_ROADMAP.md` states they were consolidated/replaced. Do not recreate parallel handoff files unless the project protocol is explicitly changed.
- **Deployment permission risk:** the 28-page explicit permission map plus default-allow model is acceptable for local/dev, but before live deployment every new operational/governance page should be reviewed for explicit `PAGE_PERMISSIONS` policy.
- **Loader race fix (2026-06-23):** `ensurePageTemplateLoaded()` had a race — the default boot page (calculator) was loaded by initial navigation AND by `prefetchAllViews()` concurrently; both passed the existence check before either appended, producing a duplicate `pageCalculator` section (Route Health read 82). Fixed with an in-flight `Set` guard (`window.__viewLoadsInFlight`) plus a re-check of `getElementById(section.id)` immediately before `appendChild`. Sections are now exactly 1 per page.
- **Boot "startup interrupted" fix (2026-06-23):** the boot UI-refresh ran the calculator recompute trio (`validateDays`/`autoCalcEligibleFridays`/`recalculate`) before the lazily-loaded page section was mounted → `null.value` ("Octagon startup interrupted" console error on every boot). Fixed defensively: null-guards in `validateDays`/`autoCalcEligibleFridays`, and the call site (~line 11041) now only runs the trio when `getElementById('inpAttendance')` exists. No payroll-logic change. Console is now clean on boot.
- **Cache-busting:** static assets are versioned by `?v=` query in index.html. When editing a long-cached file (e.g. `app.js`), bump its `?v=` or the dev server/browser may serve the stale copy (symptom: console stack-trace line numbers don't match your edited file).
- **Phase 6A core ERP gap slice (2026-06-23):** no new pages were added; Route Health remains 86/86. `modules/phase6a-core.js` and `modules/phase6a-core.css` inject three governed surfaces into existing pages: Bank Reconciliation inside `banking`, Storage Locations inside `inventory`, and Chart of Accounts inside `admin_panel`.
- **Phase 6A data policy:** bank matching writes metadata only under `omni.banking.*` and routes differences to Command Center requests; storage locations use `omni.warehouses[]`, `omni.storageLocations[]`, `omni.locationStock[]`, and `omni.locationMovements[]` without changing old material totals; Chart of Accounts reads `finance.accounts` and can add safe unused accounts without changing posted entries.
- **Phase 6A permissions:** `risk_compliance` and `banking` now have explicit `PAGE_PERMISSIONS`. Sensitive model mappings were added for `finance.accounts`, `omni.banking`, and `omni.locationStock`. This is intentionally minimal; full permission hardening for all 86 pages remains a future deployment gate.
- **Phase 6B action hardening (2026-06-23):** `services/permissionService.js` now exposes `ACTION_PERMISSIONS`, `checkAction()`, and `requireAction()` for sensitive Phase 6A/governance actions without changing page default-allow behavior. `modules/phase6a-core.js` guards bank reconciliation, storage-location movements, COA account creation, old direct banking finalize/create paths, and writes allowed/blocked/approval_requested audit events. `modules/risk-compliance.js` guards risk/control writes through `risk_compliance.write`.
- **Phase 6B deployment risk report:** explicit page mappings remain limited to sensitive/core pages; unmapped pages still default-allow for local/dev. Before live deployment the project must decide the login/current-user model, map all sensitive pages/actions, convert high-risk writes to deny-by-default, and test system/admin, manager, operator, finance, and ordinary user roles.
- **Phase 6C Admin audit + prefetch recovery (2026-06-23):** Admin Wire-Up now includes a live Button / Permission Audit panel that checks all 86 sidebar buttons for target sections, click wiring, explicit/default permission status, and guarded action count. The end-of-body dynamic view prefetch wrapper now starts immediately when `DOMContentLoaded` already fired, recovering the full 86/86 Route Health baseline on normal load. Latest browser smoke: Route Health 86/86 nav and 86/86 pages; Admin audit 86 OK, 0 warnings, 0 broken, 15 guarded actions.
- **Phase 6C role/action matrix + high-risk action policy (2026-06-23):** `PermissionService.explainAction(actionKey, context, userOrRole)` provides dry-run outcomes for sensitive actions. Page-level default-allow remains for local/dev, but high/critical unmapped actions are no longer silently allowed; they explain as blocked or approval-required. `modules/phase6c-security-matrix.js` injects a read-only matrix into the existing `security_center` page, covering banking reconciliation, inventory locations, Chart of Accounts, Risk Compliance, direct finance posting, and AI high-risk write keys. Approval requests from Phase 6A now carry action key, source page/module, user/role, target id, before/after, risk level, requested timestamp, status, and reason. Audit/history entries now include role, risk level, and reason alongside action/result/target.
