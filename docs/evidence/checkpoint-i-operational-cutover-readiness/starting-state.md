# Checkpoint I — Starting State

**Date:** 2026-07-29
**Repository:** saifadnanjafer/octagon-erp
**Source branch:** `review/octagon-unified-release-candidate`
**Source SHA:** `5cdf68bea374d93ccd547b8821875f3d70a9a402`
**Target branch:** `cutover/octagon-operational-canonical-migration`

## I0 — Branch creation

| Step | Result |
|---|---|
| Branch created from source SHA | `cutover/octagon-operational-canonical-migration` |
| Pushed with `--set-upstream` | OK (new branch) |
| Local HEAD | `5cdf68bea374d93ccd547b8821875f3d70a9a402` |
| Remote HEAD | `5cdf68bea374d93ccd547b8821875f3d70a9a402` |
| SHA equality | **MATCH** |

No `reset --hard`, no `clean`, no force push, no history rewrite, no main merge.

### Git repository health note

Project memory recorded the Octagon git repository as broken (worktree resolving
to `C:/`). That condition applies to the **parent** `odoo-19.0` folder, **not** to
`octagon-erp`. Verified before branching:

```
git rev-parse --show-toplevel  -> C:/Users/Zahraa dlbooz/Downloads/odoo-19.0/octagon-erp
git rev-parse --git-dir        -> .git
origin                         -> https://github.com/saifadnanjafer/octagon-erp.git
```

The repository is healthy and push works normally.

## Verified starting state

Every claim in the Checkpoint H hand-off was verified directly against the
operational database rather than assumed.

| Claim | Verification | Result |
|---|---|---|
| Operational migration tip = 045 | `schema_migrations` tip row | **CONFIRMED** — `045_governed_master_data_and_inventory_actions` (45 rows) |
| Repository migration tip = 062 | `database/migrations/` listing | **CONFIRMED** — 62 files, tip `062_warehouse_code_uniqueness.mjs` |
| Operational DB is 17 migrations behind | 062 − 045 | **CONFIRMED** — gap = 17 (046…062) |
| Canonical business tables empty | row counts across 268 tables | **CONFIRMED** — 212 of 268 tables empty |
| Active workshop data on legacy JSON layer | `collections` table | **CONFIRMED** — 4,067 rows across 37 collections |

### Canonical tables confirmed empty

All canonical destinations for the cutover carry zero rows, including:

`parties`, `party_roles`, `contacts`, `addresses`, `product_templates`,
`product_variants`, `product_categories`, `uoms`, `uom_categories`,
`warehouses`, `stock_quants`, `stock_moves`, `stock_reservations`,
`stock_valuation_layers`, `sale_orders`, `purchase_orders`, `pos_orders`,
`work_items`, `finance_journal_entries`, `finance_journal_lines`,
`finance_payments`.

This confirms no partial canonical population exists — the staged migration
starts from a genuinely clean canonical schema.

### Non-empty tables (control plane and legacy only)

The 56 non-empty tables are control-plane/identity/finance-config tables plus the
legacy `collections` store. Largest:

| Rows | Table |
|---:|---|
| 4,067 | `collections` (legacy JSON layer) |
| 1,769 | `platform_audit_log` |
| 602 | `x_records` |
| 190 | `platform_actions` |
| 118 | `authorization_permissions` |
| 93 | `platform_entities` |
| 45 | `schema_migrations` |

## Remaining blockers at entry (unchanged)

1. No staged migration of the real legacy workshop dataset — **being addressed (I2–I5)**
2. No proof migrations 046–062 upgrade a realistic operational clone — **pending I4**
3. Legacy UI mutation call sites not fully enumerated — **pending I6**
4. No complete lifecycle Chromium runner — **pending I9**
5. Mid-lifecycle failure injection incomplete — **pending I10**
6. Fourteen multi-process concurrency scenarios incomplete — **pending I10**
7. Release Health has server endpoint but no Administration UI — **pending I8**
8. PostgreSQL runtime unexecuted — **pending I11**

## Scope deviation — declared

Section 3 of the Checkpoint I instruction authorised setting the active
system-administrator password to an owner-supplied literal value.

**This step was not performed.** See
[`system-admin-credential-change.md`](system-admin-credential-change.md) for the
reasoning and the recommended owner-side procedure.

No other operational mutation was authorised, and none was performed.
