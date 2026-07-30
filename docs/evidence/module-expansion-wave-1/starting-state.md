# Module Expansion Wave 1 — Starting State, Isolation, and M1 Registry

**Date:** 2026-07-30
**Source commit:** `00e60a8d894ed5e4b9a613246fe1b46264e20550`
**Branch:** `build/octagon-module-expansion-wave-1`
**Worktree:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-module-expansion-wave-1`

## M0 — Isolated linked worktree

```
git worktree add -b build/octagon-module-expansion-wave-1 \
  "../octagon-module-expansion-wave-1" 00e60a8d894ed5e4b9a613246fe1b46264e20550
```

| Check | Result |
|---|---|
| Branch | `build/octagon-module-expansion-wave-1` |
| HEAD | `00e60a8d894ed5e4b9a613246fe1b46264e20550` — exact |
| Worktree clean | 0 entries |
| Origin | `https://github.com/saifadnanjafer/octagon-erp.git` |
| Pushed | `--set-upstream`, local = remote |

## Telegram-bot worktree isolation — verified both directions

The original worktree carries uncommitted Telegram-bot work belonging to another
session. It was fingerprinted before and after.

**Absent from this worktree** (never committed at the source SHA):

- `platform/integrations/telegram-bot.cjs` — absent ✓
- `tests/unit/telegram-bot.test.mjs` — absent ✓

`app.js` and `server.js` here are the **committed** versions
(`dd3d2ea0…`, `116fa995…`), not the dirty working copies
(`ac6c0881…`, `b4b0d419…`).

**Original worktree unchanged** after all Wave 1 work:

| File | SHA-256 | State |
|---|---|---|
| `platform/integrations/telegram-bot.cjs` | `5d90de8882835f9335f862605ed59a3b246cedab053d25d481a57084e37049d0` | identical |
| `app.js` (working copy) | `ac6c0881992a4a3b5182cde8b0bc44786dbb4b2d85959f5195a4f8ec45b74d96` | identical |
| `git status` | ` M app.js`, ` M server.js`, `?? telegram-bot.cjs`, `?? telegram-bot.test.mjs` | identical |

Nothing staged, modified, reverted, moved, or committed. The original worktree
remained on its own branch throughout.

## Operational data

`database.db` is gitignored and therefore **does not exist in this worktree at
all** — the strongest available isolation. A test asserts this
(`noOperationalDatabaseInThisWorktree`).

Original worktree operational database, unchanged:
`acfd3ab89e805abd49a724e2e177f75f14594b80861e3260639b387bca3a4683`

No migration, no server start, no credential change, no cutover activation.

---

## M1 — Module registry and permission namespaces

**Migration `064_module_expansion_wave1_registry`** — registry and entitlement
foundation only. It deliberately creates **no business tables**: registering the
modules first makes a half-finished wave visible and governable in Administration
rather than invisible.

### Eight modules registered

| Module | Arabic | License key | Nav group | Reuses |
|---|---|---|---|---|
| `crm` | إدارة علاقات العملاء | `octagon.crm` | crm | kernel, commercial_core, commercial_sales |
| `service_helpdesk` | خدمة العملاء والدعم | `octagon.service` | service | kernel, commercial_core, work_item_canonical |
| `documents` | إدارة الوثائق | `octagon.documents` | documents | kernel |
| `knowledge` | قاعدة المعرفة | `octagon.knowledge` | knowledge | kernel, documents |
| `appointments` | المواعيد والحجوزات | `octagon.appointments` | appointments | kernel, commercial_core, work_item_canonical |
| `field_service` | الخدمة الميدانية | `octagon.field_service` | field_service | work_item, stock_inventory, assets, maintenance, service |
| `customer_portal` | بوابة العملاء | `octagon.portal` | customer_portal | kernel, commercial_core, commercial_sales, finance |
| `ecommerce` | المتجر الإلكتروني | `octagon.ecommerce` | ecommerce | commercial_sales, stock_inventory, finance, portal |

A test asserts **every declared dependency resolves to an already-registered
module**, so a Wave 1 module cannot invent an authority. It also spot-checks that
`field_service` reuses Work Item / Inventory / Assets and that `ecommerce` reuses
Sales / Inventory / Finance rather than building its own.

### Honest lifecycle status

No Wave 1 module has domain schema yet, so none is advertised as installable:

- `module_expansion_registry.lifecycle` = **`planned`** for all eight
- `platform_modules.status` = **`available`** for all eight

`available` is the least-committed value permitted by migration 007's CHECK
constraint (`available|installed|licensed|enabled|visible|authorized`). 007 is
historical and immutable, so the precise state is carried in
`module_expansion_registry.lifecycle`, which this migration owns. A test asserts
the status is **not** `enabled` or `installed` — reporting a module as installed
before its tables exist would be a false green in Administration.

### 46 permissions across eight namespaces

`crm` 6 · `service` 6 · `documents` 7 · `knowledge` 5 · `appointments` 5 ·
`field_service` 6 · `portal` 6 · `ecommerce` 5

Every permission carries an Arabic and an English label. Sensitive operations —
those that move money, stock, or another party's data — are flagged
`sensitive = 1` and asserted by test: `crm:convert`, `service:resolve`,
`documents:share`, `knowledge:publish`, `appointments:cancel`,
`field_service:bill`, `portal:download`, `ecommerce:checkout`.

Portal permissions are **scoped by construction**: the namespace exposes
`read_own`, and a test asserts an unscoped `portal:read` does **not** exist.

### Tests — `tests/module-expansion/registry.test.mjs`

```
PASS: noOperationalDatabaseInThisWorktree
PASS: migrationAppliesToTip064 (64 applied)
PASS: allEightModulesRegistered
PASS: dependenciesReferenceExistingAuthorities (8 modules)
PASS: permissionNamespaces (46 permissions)
PASS: rollbackAndRerun
```

Rollback drops the registry table and removes all 46 permissions; re-apply
restores exactly 8 modules with no duplicates; a third run applies nothing.

---

## Defect found and fixed — migration checksums were not portable

**Severity: MEDIUM. Found by this worktree, affects every fresh clone.**

The historical manifest hashed **raw file bytes**. Git normalises line endings on
checkout, so 12 of the 62 migration files arrived in this linked worktree with
CRLF and produced different hashes — immutability failed for files with **zero
content changes**.

Proven by Git, not assumed:

```
git diff --stat 00e60a8d... -- database/migrations/   →  (empty)
```

The only difference versus the original accepted commit `5cdf68be` is the
addition of `063`, which is an expected forward migration.

**Fix:** manifest checksums are now computed over content normalised to LF. This
preserves the guarantee that matters (the source did not change) and drops an
assertion nobody intended (the file was checked out with identical line endings).
Both manifests record `checksumMethodRevisionReason` so the change is not
mistaken for a re-acceptance of modified content. 12 of 62 checksums were
re-derived; 063 was already identical.

**Second CRLF defect, same root cause:** the startup-policy test strips comments
with `//.*$` before scanning `server.js` for unguarded `runMigrations` calls.
With CRLF, `.` stops at the `\r` and `$` never matches, so comments survived and
the incident write-up quoting the old call was counted as a real call site. Fixed
by normalising before stripping.

Neither defect would have surfaced without building in a linked worktree.

## Regression

```
npm run test:migration        → 5 files, 5 pass, 0 fail
registry.test.mjs             → 6 cases, all pass
node scripts/precommit.js     → passed
```

## Scope status — honest

**M0 and M1 are complete. M2–M10 are not started.**

Wave 1 as specified is eight full ERP modules — roughly 100 entities, their
lifecycles, migrations 065–072, UI in the original shell, cross-module flows,
concurrency suites and 22 browser lifecycles. That is a multi-month programme,
not a single session. What exists is the governed foundation every one of those
modules needs; the domain schema, services, UI and proofs do not exist yet and
are not claimed.

**Classification: PARTIAL — REMEDIATION REQUIRED.**
