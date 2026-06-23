# Octagon ERP - JARVIS Runtime V2 Status

Welcome to Octagon ERP V4.0 / V6. This sprint focuses on upgrading the AI Assistant into **JARVIS Runtime V2** — a fully integrated, hands-free ERP voice/text operator.

## Core Assistant Modules

1. **Voice Runtime** (`jarvis-voice-runtime.js`): Exposes `window.JarvisVoiceRuntime` for continuous hands-free voice control, strict state machine, fuzzy echo loop prevention, and voice interruption barge-in.
2. **Local System Map** (`modules/jarvis-system-map.js`): Deterministically scans the ERP DOM and registers actions, pages, and forms offline. Calculates a coverage score.
3. **DOM-lite Action Agent** (`modules/jarvis-action-agent.js`): Matches action IDs, highlights active targets visually, and executes actions or navigates.
4. **UI Integration & Control Panel** (`omni-ai-assistant.js`): Integrates the assistant layout and registers delegated event listeners for selecting provider models, modes, executing map rebuilds/retries/budget clears, wake-word activation, and diagnostics panel.
5. **Diagnostics Test Harness** (`modules/jarvis-test-harness.js`): Automates a 53-test matrix verifying boot, UI, language, navigation, actions, safety gating, budgeting, and voice runtime capabilities.

## Styling & Layouts
- **CSS Stylesheet** (`jarvis-visual-overlay.css`): Defines pulsing targets, floating execution bubbles, and the dark premium glassmorphism settings card.

## Current Build Status
- **Syntax validation**: Checked and passed cleanly for `app.js`, `omni-ai-assistant.js`, `jarvis-voice-runtime.js`, `omni-language-fix.js`, `server.js`, and all JARVIS modules.
- **Database validity**: `database.json` validated.
- **Diagnostics matrix**: Programmatic 53-item test matrix run completed. Total tests: 53. PASS: 42. FAIL: 6. WARN: 0. MANUAL REQUIRED: 5. Results exported to `jarvis-test-report.json`.

## Governance Freeze Baseline (2026-06-23)

Route/page reconciliation is frozen at **86/86 sidebar nav** and **86/86 page templates**. `appointments` is active and renders. `risk_compliance` is active and counted in Route Health.

Current canonical handover protocol:
- `MASTER_ROADMAP.md` remains the single source of truth for long-range roadmap and build rules.
- `HERE.md` is the short current-state handoff.
- `STRUCTURE.md` is the current route/page registry and architecture note.
- `CODEX_RUNBOOK.md` and `all into here file.md` are intentionally absent from the current root. The live `MASTER_ROADMAP.md` says those files were consolidated/replaced; no archive copy was found during this freeze pass, so they were not restored or regenerated.

Risk & Compliance safety classification:
- Page key: `risk_compliance`.
- Storage scope: `omni.riskCompliance` only.
- It is **not fully read-only**: user actions can create/update risk/control records and call `saveData()`.
- It does **not** post finance/accounting/payroll/stock/QC/price changes, send external messages, or mutate locked payroll/finance pages.
- It reads live system signals for context and writes only self-contained governance register data.
- It calls `PermissionService.checkPage('risk_compliance')`; because `risk_compliance` is not in `PAGE_PERMISSIONS`, it follows the current default-allow model.

Permissions note:
- `services/permissionService.js` explicitly maps 28 sensitive pages.
- Unmapped pages currently default-allow (`checkPage()` returns true when a page has no mapping). This is acceptable for local/dev but must be reviewed before live deployment.

Do not proceed to Phase 6 feature development until this 86/86 governance baseline remains green after validation.

## Phase 6A Core ERP Gap Slice (2026-06-23)

Scope completed without adding sidebar pages:
- `banking`: added a conservative Bank Reconciliation overlay inside the existing Banking / Treasury page. Statement lines and match metadata are stored under `omni.banking.reconciliations[]`, `omni.banking.statementLines[]`, and `omni.banking.reconciliationMatches[]`. Matches do **not** mutate finance transactions or post accounting entries. Any reconciliation difference is routed to `createOmniRequest()` / Command Center as a finance review request.
- `inventory`: added Storage Locations inside the existing Inventory page. It uses `omni.warehouses[]`, `omni.storageLocations[]`, `omni.locationStock[]`, and `omni.locationMovements[]`. Existing material totals remain unchanged and remain source of truth until a full reconciliation pass.
- `admin_panel`: added a Chart of Accounts surface inside the existing Admin Panel. It reads existing `finance.accounts`, shows usage/locking warnings, and allows adding a new unused account. It does not delete accounts, edit used code/type/parent values, or change posted journal data.

Permissions updated:
- `risk_compliance` is now explicitly mapped to `workshop.manager` / `finance.manager`.
- `banking` is now explicitly mapped to `finance.user`.
- New model mappings were added for `finance.accounts`, `omni.banking`, and `omni.locationStock`.
- Default-allow remains in place for unmapped pages. This is still local/dev acceptable only and must be hardened before live deployment.

Validation checkpoint:
- Route Health before Phase 6A: 86/86 nav, 86/86 pages.
- Route Health after Phase 6A browser smoke: 86/86 nav, 86/86 pages, console error log clean.
- No locked payroll/finance page was modified directly. `database.json` was not reset or overwritten.

## Phase 6C Admin Audit + View Prefetch Recovery (2026-06-23)

Continued launch-readiness work without reviving the old combined handoff file.

Built:
- `app.js`: Admin Wire-Up now includes a live Button / Permission Audit panel. It scans all sidebar `data-page` buttons, resolves target page sections, checks click wiring, checks explicit/default permission policy status, and reports guarded action count from `PermissionService.actionPermissions`.
- `style.css`: reused Admin audit KPI styling for the new audit panel.
- `index.html`: fixed the dynamic view prefetch bootstrap. The end-of-body wrapper now runs `prefetchAllViews()` immediately if `DOMContentLoaded` already fired, instead of only registering a late listener that never runs.
- `index.html`: bumped `app.js` and `style.css` cache tokens to `20260623-admin-audit-v1`.

Validation:
- `node --check app.js` PASS.
- `node --check server.js` PASS.
- `node --check services/permissionService.js` PASS.
- JSON parse for `database.json`, `claude-status.json`, and `claude-review-pointer.json` PASS.
- Chrome-backed Playwright smoke on `localhost:8080`: Route Health returned 86/86 nav and 86/86 pages. Admin Wire-Up audit returned 86 OK, 0 warnings, 0 broken, and 15 guarded actions. Only observed console issue was the existing 404 resource noise.

Remaining:
- Dead-code deletion still requires explicit go-ahead.
- Final live stabilization re-check remains.

## Phase 6B Permission + Approval Hardening (2026-06-23)

Sensitive action inventory:
- Banking: statement-line create = sensitive local write; match/unmatch = sensitive metadata write; final reconciliation = manager/admin only and approval-routed; adjustment/write-off = approval request only; old direct finance movement path remains blocked/approval-routed.
- Inventory locations: transfer/receive/issue = guarded local write with movement history; insufficient/negative source stock = blocked; adjustment = manager/admin direct with audit or approval-routed for non-manager; delete location/movement is not exposed in Phase 6A and remains blocked by absence.
- Chart of Accounts: create unused account = guarded; edit/deactivate/delete used account is not exposed and remains blocked by absence; used-account warnings stay visible.
- Risk Compliance: add/update/close risk and add/update control = guarded by `risk_compliance.write`.

Action permissions added:
- `banking.reconciliation.create`, `.match`, `.unmatch`, `.finalize`, `.adjustment_request`
- `inventory.location.create`, `.transfer`, `.adjust`, `.issue`, `.receive`
- `accounting.coa.create`, `.edit_safe`, `.edit_used`, `.deactivate`
- `risk_compliance.write`

Approval and audit behavior:
- Guarded actions call `PermissionService.checkAction()` in addition to page checks.
- Allowed, blocked, and approval-routed outcomes are written to `recordOmniHistoryEvent()` and `addOmniSystemLog()` where available.
- Approval-routed actions create Command Center requests through `createOmniRequest()`.
- The page-level default-allow model remains unchanged for local/dev usability; full deployment hardening is still pending.

## Phase 6C Role Matrix + High-Risk Action Policy (2026-06-23)

Scope completed without adding sidebar pages and without changing `database.json` schemas:
- Added `PermissionService.explainAction(actionKey, context, userOrRole)` as a dry-run permission explanation helper.
- Page access remains default-allow for unmapped local/dev pages, but high/critical unmapped action keys now resolve to deny-by-default or approval-required instead of silent allow.
- Added explicit metadata for banking reconciliation, inventory location, Chart of Accounts, Risk Compliance, direct finance posting, and AI high-risk write actions.
- Added `modules/phase6c-security-matrix.js`, injected into the existing `security_center` page, showing role/action outcomes for system admin, finance manager/user, workshop manager/user, and ordinary user profiles.
- Strengthened Phase 6A approval payloads with `actionKey`, source page/module, user/role, target id, before/after, risk level, requested timestamp, status, and reason.
- Strengthened guarded audit logs with action key, user/role, page, target, result, timestamp, reason, and risk level.

Governance notes:
- Current explicit page mappings remain intentionally limited to sensitive/core pages while unmapped pages default-allow for local/dev.
- Sensitive action mappings are explicit and the new high-risk action metadata prevents unmapped high/critical writes from becoming silent allows.
- Jarvis/AI direct-write paths were inspected only for safety confirmation; existing high-risk/sensitive AI tools remain approval-gated through the AI governance/approval queue rather than direct writes.
- Before live deployment: decide the final login/current-user model, map all sensitive pages/actions, convert high-risk execution to deny-by-default everywhere, and test system admin, manager, operator, finance user, and ordinary user roles.
