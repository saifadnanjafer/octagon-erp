# Octagon ERP — Final Page Catalog · FP-0 Starting Page Inventory

**Date:** 2026-07-31
**Repository:** `saifadnanjafer/octagon-erp`
**Selected source branch:** `build/octagon-module-expansion-wave-2`
**Selected source SHA:** `237febe23b4192542b4e43e54192c43f88540706`
**Final-page worktree:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-final-page-catalog`
**Final-page branch:** `build/octagon-final-page-catalog`
**Starting SHA (branch created at):** `237febe23b4192542b4e43e54192c43f88540706`

---

## 1. Source-branch selection

All Octagon worktrees present on this machine were inspected:

| Worktree | Branch | HEAD | Working tree | Disposition |
|---|---|---|---|---|
| `octagon-erp` | `cutover/octagon-operational-canonical-migration` | `00e60a8` | **dirty** (`app.js`, `server.js`, `platform/integrations/`, `tests/unit/telegram-bot.test.mjs`) | **Telegram-bot worktree — NOT TOUCHED.** Uncommitted work excluded from this wave. |
| `octagon-module-expansion-wave-1` | `build/octagon-module-expansion-wave-1` | `a0855ab` | clean | Ancestor of Wave 2. Superseded. |
| `octagon-module-expansion-wave-2` | `build/octagon-module-expansion-wave-2` | `237febe` | clean, `local == origin` | **SELECTED.** |

Remote branch tips compared by commit date; `build/octagon-module-expansion-wave-2`
(2026-07-31 02:21:10 +0300) is the newest. Ancestry verified:

```
git merge-base --is-ancestor origin/build/octagon-module-expansion-wave-1 \
                             origin/build/octagon-module-expansion-wave-2   -> YES
git merge-base --is-ancestor origin/cutover/octagon-operational-canonical-migration \
                             origin/build/octagon-module-expansion-wave-2   -> YES (contained)
git rev-list --count wave-1..wave-2                                          -> 16
```

Wave 2 therefore contains Wave 1, the Phase 05 checkpoints, and the cutover
branch. It is the latest clean, pushed, coherent module-expansion commit.

Branches **not** selected and why: `build/octagon-original-shell-visible-expansion`
(2026-07-28), `review/octagon-unified-release-candidate` (2026-07-29),
`integration/octagon-unified-platform-expansion` (2026-07-26) — all older than
Wave 2. `main` (`8815b00`, 2026-07-14) — not merged, per instruction.

---

## 2. How this inventory was produced

Not by reading a roadmap. `scripts/page-catalog-inventory.mjs` reads the ten
actual registration surfaces of the original shell and reports only what has a
real file or registration behind it:

| # | Surface | File | What it proves |
|---|---|---|---|
| 1 | `ensurePageTemplateLoaded` `pageMap` | `app.js:~37288` | page id → DOM section id (authoritative, 100 entries) |
| 2 | `switchPage` `pageMap` | `app.js:4179` | core synchronous page map (38 entries) |
| 3 | `navGroupPages` | `app.js:3103` | sidebar navigation registry (13 groups) |
| 4 | `prefetchAllViews` | `app.js:37457` | background template prefetch list |
| 5 | `.nav-btn[data-page]` | `index.html` | sidebar buttons |
| 6 | `id="pageXxx"` | `index.html` | inline page sections |
| 7 | `views/*.html` | `views/` | view fragments (103 files) |
| 8 | `PAGE_PERMISSIONS` | `services/permissionService.js:264` | page permission registry |
| 9 | `getElementById('pageXxx')` | `modules/*.js` | page controllers (105 modules) |
| 10 | `registerAction` / `.register` | `platform/domains/*/index.mjs` | backend modules + declared actions |

Re-run at any time:

```bash
node scripts/page-catalog-inventory.mjs
```

---

## 3. Headline counts at entry

| Metric | Count |
|---|---|
| Pages discovered (registered page IDs) | **108** |
| View fragments (`views/*.html`) | **103** |
| Navigation groups | **13** |
| Client modules (`modules/*.js`) | **105** |
| Backend domain modules (`platform/domains/*`) | **17** |
| Backend domain modules **wired into the running runtime** | **1** (`crm` only) |
| Declared backend actions in **unwired** domains | **106** |
| View fragments with no registered page ID (orphans) | **0** |

---

## 4. Disposition of every discovered page

Full per-page table: [`_inventory-table.md`](_inventory-table.md)
(108 rows: page ID · section ID · view fragment · nav group · nav button ·
permission · controller · status).
Raw scanner output: [`_inventory-summary.txt`](_inventory-summary.txt).

| Classification | Count | Meaning |
|---|---|---|
| `COMPLETE` | 87 | Section ID + view/controller + nav group + nav button + permission all present |
| `EXISTING — NEEDS UPGRADE` | 19 | Real page, but missing navigation, permission, or both |
| `BLOCKED` | 2 | Page ID referenced but has no DOM section and no asset |

### 4.1 `EXISTING — NEEDS UPGRADE` (19)

| Page ID | Missing |
|---|---|
| `home` | not in any navigation group (it is the boot landing — reached by logo/home button, deliberate) |
| `canonical_console` | not in any navigation group |
| `canonical_inventory` | not in any navigation group |
| `products` | not in any navigation group |
| `parties` | not in any navigation group |
| `warehouses` | not in any navigation group |
| `locations` | not in any navigation group |
| `telegram` | not in any navigation group |
| `knowledge_base` | not in any navigation group |
| `finance_installments` | not in any navigation group |
| `omni_communications` | not in any navigation group |
| `pos_deepening` | not in any navigation group |
| `sales_commission` | not in any navigation group |
| `sales_contracts` | not in any navigation group |
| `sales_price_lists` | not in any navigation group |
| `import_center` | no permission, no nav group, no nav button (JS-rendered shell) |
| `system_settings` | no permission, no nav group, no nav button (JS-rendered shell) |
| `manager_approvals` | no permission, no nav group, no nav button |
| `mobile_inventory_count` | no permission, no nav group, no nav button |

> Note: `rebuildSidebarNavigation()` (`app.js:3172`) sweeps any `data-page`
> button not present in `navGroupPages` into `admin_org` at runtime. That is a
> safety net, not a registration — it dumps unrelated pages into the governance
> group. Pages above are recorded as needing real group assignment.

### 4.2 `BLOCKED` (2)

| Page ID | Reason |
|---|---|
| `settings` | Present in `PAGE_PERMISSIONS` only. No section id, no view, no controller. Legacy permission key with no page behind it. |
| `system_check` | Present in `PAGE_PERMISSIONS` only. `modules/system-check.js` exists but does not own a `pageSystemCheck` section. |

---

## 5. The dominant finding — Wave 2 has **no visible surface at all**

Wave 2 (`W2-M1` … `W2-M16`) shipped **migrations + services + tests** for 16
business domains. It shipped **zero pages, zero queries, and zero runtime
wiring**. Verified per domain:

| Domain | Declared actions | `query-service.mjs` | Wired into `platform-runtime-bridge.mjs` | Page |
|---|---:|---|---|---|
| `crm` (Wave 1) | 30 | **yes** | **yes** | `sales` (Customer 360) |
| `contracts` | 8 | no | **no** | none |
| `subscriptions` | 6 | no | **no** | `subscriptions` (legacy `omni.*` page, unrelated) |
| `rental` | 6 | no | **no** | `rental` (legacy page, unrelated) |
| `expenses` | 8 | no | **no** | `expenses` (legacy page, unrelated) |
| `procurement` | 9 | no | **no** | `procurement` (canonical page, different authority) |
| `human_capital` | 9 | no | **no** | none |
| `financial_planning` | 7 | no | **no** | none |
| `treasury` | 6 | no | **no** | none |
| `wms` | 8 | no | **no** | none |
| `plm` | 6 | no | **no** | none |
| `grc` | 7 | no | **no** | none |
| `hse` | 6 | no | **no** | none |
| `bi` | 5 | no | **no** | none |
| `integration` | 5 | no | **no** | `integration_hub` (legacy page, unrelated) |
| `iraq_localization` | 5 | no | **no** | none |
| `ai_copilot` | 5 | no | **no** | none |

**Consequence:** all 16 Wave 2 modules are `MODULE NOT IMPLEMENTED` from the
application's point of view. Their tables exist in migrations `067`–`082`; nothing
in the running product can read or write them.

### 5.1 Two incompatible registration dialects were shipped

A second defect found during inventory. Wave 2 domains use two different and
mutually incompatible registration APIs, and **only one of them matches the real
kernel**:

```js
// platform/domains/contracts/index.mjs  — plausible, but still not the kernel API
executor.registerAction('contracts:create', { permission, handler })

// platform/domains/wms/index.mjs        — different API again
actionRegistry.register('wms:create-warehouse', async (ctx, params) => ...)
```

The real kernel contract (`platform/kernel/actions/index.mjs`) is:

```js
actionExecutor.registerHandler(actionId, fn)      // runtime handler
// + a row in platform_actions (id, module_id, entity_id, kind, required_permission, …)
```

seeded exactly as `ensureCrmActionDefinitions(dialect)` does. Neither Wave 2
dialect would execute. This is recorded as a **defect to correct in this wave**,
not deferred: it is the "nonfunctional primary action" class, which §81 forbids
deferring.

---

## 6. Navigation model at entry

13 groups under 6 domain tabs. Group sizes:

| Group | Domain | Pages |
|---|---|---:|
| `core_daily` | core | 6 |
| `core_records` | core | 4 |
| `ops_control` | ops | 5 |
| `ops_production` | ops | 7 |
| `ops_frontline` | ops | 2 |
| `finance_accounts` | finance | 10 |
| `commercial_sales` | commercial | 10 |
| `commercial_verticals` | commercial | 8 |
| `resources_org` | resources | 8 |
| `resources_supply` | resources | 6 |
| `intelligence_core` | intelligence | 6 |
| `intelligence_ai` | intelligence | 5 |
| `admin_org` | admin | 10 |
| | | **87** |

87 of 108 page IDs are in a navigation group. The remaining 21 are either
deliberately unlisted (`home`, `kiosk`-style surfaces reached another way) or
missing registration (§4.1).

---

## 7. Target-catalog mapping decisions taken from this inventory

The §7–§71 target catalog names 65 page families. This inventory shows Octagon
already owns most of the *domain* surface. The wave therefore does **not**
create 65 new sidebar entries. Governing decisions:

1. **No duplicate page for an existing owner.** `operations_command_center` →
   the existing `command_center` page is upgraded, not replaced.
   `quality_workspace` → existing `qc_center`. `mrp_planning` → existing `mrp`.
   Full mapping in `page-consolidation-register.md`.
2. **The real gap is Home & Work and Control Plane.** Octagon has no
   `enterprise_home` (the `home` page is a resume-launcher, not a work surface),
   no `my_work`, no `unified_inbox`, no `global_search` page, no
   `executive_cockpit`, no `module_pack_center`, no `permission_center`.
3. **The second real gap is Wave 2's 16 invisible domains.** Connecting them —
   runtime wiring, action definitions, governed queries, then pages — is the
   single highest-value work in this wave and is sequenced first.
4. **`settings` and `system_check` page IDs are dispositioned**, not left dangling.

---

## 8. Operational safety at entry

- No operational database was opened, started against, or migrated.
- `octagon-erp/` (Telegram-bot worktree) was read for `git status` only; **not modified**.
- `octagon-erp-commercial-vnext/` and `octagon-analysis/` were **not read and not modified**.
- No credential was read, changed, printed, or committed.
- `main` was not merged.
- The new branch was created from the exact Wave 2 SHA and pushed before any edit:

```
git rev-parse HEAD                                    -> 237febe23b4192542b4e43e54192c43f88540706
git rev-parse origin/build/octagon-final-page-catalog -> 237febe23b4192542b4e43e54192c43f88540706
```
