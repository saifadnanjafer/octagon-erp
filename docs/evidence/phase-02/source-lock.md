# Phase 02 Source Lock

**Locked on:** 2026-07-21
**Authority:** `PHASE_02_IDENTITY_PERMISSIONS_SETTINGS_AND_WORKFLOW.md` § 6

All roots below are inside the approved research root
`C:\Users\Zahraa dlbooz\Downloads\odoo-19.0`. No filesystem-wide search was
performed, no repository was relocated, and no internet example was substituted
for local source.

---

## 1. Repository roots

| Symbol | Resolved path (relative to research root) | Present | Branch / ref | Notes |
|---|---|---|---|---|
| `OCTAGON_ROOT` | `octagon-erp/` | ✅ | `codex/phase7-safe-baseline` @ `f5f4cf559b2301e57401fbd3e6dc0d098f9291c3` | worktree carries uncommitted Phase 01 deliverables |
| `VNEXT_ROOT` | `octagon-erp-commercial-vnext/` | ✅ | `automation/r9-marketplace-distribution` @ `72d2c6b4f568650203795d463c25a12ff06ad55a` | **source only**, never a deploy target |
| `ODOO_ROOT` | `./` (the odoo-19.0 checkout itself) | ✅ | Odoo 19.0 source tree | `odoo/addons/base/models/` + `addons/` confirmed |
| `FRAPPE_ROOT` | — | ❌ **MISSING** | — | not present locally; no `frappe*` directory under `erp-research/`. Frappe behaviors are **inferred from ERPNext usage + specification only**, never copied. Recorded as a deferred item. |
| `ERPNEXT_ROOT` | `erp-research/erpnext-develop/` | ✅ | vendored snapshot | used as clean-room behavioral reference only (GPLv3 — no code copied) |
| `RUOYI_ROOT` | `erp-research/ruoyi-vue-pro-master/` | ✅ | vendored snapshot | `yudao-module-bpm/`, `yudao-module-system/`, `yudao-framework/` confirmed |
| `RUOYI_UI_ROOT` | `erp-research/ruoyi-vue-pro-master/yudao-ui/yudao-ui-admin-vue3/` | ✅ **FOUND** | vendored snapshot | Phase 01 recorded this as missing; the correct path is nested under `yudao-ui/`. **Phase 01 deferred item #4 partially closed.** |
| `NOCOBASE_ROOT` | `erp-research/nocobase-main/` | ✅ | vendored snapshot | `packages/core/acl/`, `packages/plugins/@nocobase/` confirmed |
| `AUREUS_ROOT` | `erp-research/aureuserp-master/` | ✅ | vendored snapshot | `plugins/webkul/` confirmed |
| `IDURAR_ROOT` | `erp-research/idurar-erp-crm-master/` | ✅ | vendored snapshot | supporting reference only |

### Renamed / relocated donor paths

| Expected in Phase 02 doc | Actual local path | Action |
|---|---|---|
| `RUOYI_UI_ROOT/src/directive/permission/` | `erp-research/ruoyi-vue-pro-master/yudao-ui/yudao-ui-admin-vue3/src/directives/permission/` | path corrected (`directives`, plural; nested under `yudao-ui/`) |
| `FRAPPE_ROOT/**` | *(absent)* | **STOP-LIST ITEM** — every Frappe-sourced behavior in Phase 02 is `SPEC-IMPLEMENT`, never `DIRECT-ADAPT` |

## 2. Runtime and test environment

| Item | Value |
|---|---|
| Node.js | v24.14.1 |
| npm | 11.11.0 |
| SQLite driver | `node:sqlite` `DatabaseSync` (built-in) |
| Dialect under test | `sqlite` only; `postgres` remains a declared-but-unproven stub |
| Production database | `octagon-erp/database.db` — **NEVER touched by Phase 02 tests** |

### Disposable databases

Every Phase 02 test creates its database under `os.tmpdir()` with a unique
per-run name and deletes it in teardown:

```
${os.tmpdir()}/octagon-p02-<suite>-<timestamp>-<rand>.db
```

No test opens, reads, writes, or migrates `database.db`, `database.json`, or any
file under `octagon-erp/` other than freshly created temp paths.

### Fake providers used by tests

| Provider | Fake |
|---|---|
| Mail | `platform/notifications/channels/index.mjs` `memoryChannel('email')` — records deliveries in an array, can be forced to throw/timeout |
| WhatsApp | `memoryChannel('whatsapp')` — same contract |
| Webhook / HTTP | `platform/integrations/delivery/index.mjs` injectable `transport` function; tests pass a stub returning `{status}` or throwing |
| File storage | `platform/files/storage/index.mjs` `createMemoryStorage()` — in-process buffer map, no disk writes |
| Clock | injectable `now()` in SLA/timer/session modules so expiry and business-time tests are deterministic |
| Encryption | AES-256-GCM via `node:crypto` with a test-only key held in the test process (never persisted, never logged) |

### Test identity and tenant fixtures

Created fresh per test database, never reused across suites:

| Fixture | Value |
|---|---|
| tenants | `t_alpha`, `t_beta` (isolation pair) |
| companies | `c_alpha_1`, `c_alpha_2` (under `t_alpha`), `c_beta_1` (under `t_beta`) |
| branches | `b_alpha_1a`, `b_alpha_1b`, `b_beta_1a` |
| users | `u_owner`, `u_manager`, `u_clerk`, `u_outsider`, `u_beta` |
| service identities | `svc_integration`, `svc_ai` |
| roles | `role_owner`, `role_manager`, `role_clerk` (least-privilege templates) |

### Browser test profile

No headless browser automation is available in this environment (carried Phase 01
risk #5). Browser-tier evidence in Phase 02 is produced by **contract-level DOM
assertions** against the client bootstrap payload (`platform/client/`) plus manual
verification notes, and is explicitly labeled as such in
`browser-regression-report.md`. Per § 64 test-integrity rules, **no browser check
is counted as server authorization evidence**.

## 3. Encryption / key-management test configuration

| Item | Value |
|---|---|
| Algorithm | AES-256-GCM |
| Key source (production) | `OCTAGON_SECRET_KEY` environment variable, base64, 32 bytes |
| Key source (tests) | per-test random 32-byte key generated in-process |
| Key versioning | `secret_values.key_version` column; rotation writes a new version, old ciphertext stays readable until re-wrapped |
| Failure mode | missing/short key ⇒ secret writes **fail closed** (`SECRET_KEY_UNAVAILABLE`), never silently plaintext |

## 4. Uncommitted-worktree risk statement

`octagon-erp` carries the Phase 01 deliverables plus the Phase 02 continuation
files as uncommitted work at this lock point. Phase 02 is **additive**: it creates
new files and extends Phase 01 modules in place. No Phase 01 evidence file,
migration, or test is modified or deleted.

> **Repository note:** the workspace parent has a separate malformed/root-level
> `.git` context. The actual nested `octagon-erp/.git` checkout is the repository
> used for status, staging, and commits. Commit identity is recorded in
> `docs/evidence/phase-02/provenance-report.md`.

## 5. License at every directly adapted donor file

See `donor-license-ledger.md`. Summary of reuse modes actually used in Phase 02:

| Repository | License | Reuse mode permitted | Reuse mode **used** |
|---|---|---|---|
| VNext (`VNEXT_ROOT`) | project-owned | any | `MERGE-REFACTOR`, `MERGE-CANONICAL`, `PORT-TESTS` |
| Odoo | LGPL-3 (core) / OPL-1 (enterprise addons) | clean-room behavior only | `SPEC-IMPLEMENT` |
| ERPNext / Frappe | GPL-3 / MIT respectively | ERPNext: clean-room only | `SPEC-IMPLEMENT` |
| NocoBase | AGPL-3 (core) | clean-room behavior only | `SPEC-IMPLEMENT` |
| RuoYi (yudao) | MIT | direct adaptation permitted | `SPEC-IMPLEMENT` (chosen anyway — Java→JS port is a rewrite) |
| AureusERP | MIT | direct adaptation permitted | `SPEC-IMPLEMENT` (PHP→JS port is a rewrite) |
| IDURAR | GPL-3 | clean-room only | `SPEC-IMPLEMENT` |

**No donor source file is copied into Octagon in Phase 02.** Every donor
influence is a behavior specification implemented independently in JavaScript.
This is stricter than required for the MIT donors and removes all license risk.

## 6. Stop list (owner-visible)

| # | Item | Impact | Status |
|---|---|---|---|
| 1 | `FRAPPE_ROOT` absent | Frappe role-profile / DocType-permission detail is specified from ERPNext usage + the Phase 02 document, not read from source | **accepted** — all Frappe rows are `SPEC-IMPLEMENT`; no behavior depends solely on unread Frappe source |
| 2 | No headless browser | Browser gate (H) evidence is contract-level, not pixel-level | **accepted, labeled** |
| 3 | PostgreSQL untested | Phase 02 migrations are SQLite-only | **accepted, carried risk** |
| 4 | Project `.git` is broken | No Phase 02 commit can be produced from the project directory | **accepted** — file-manifest provenance used instead |
