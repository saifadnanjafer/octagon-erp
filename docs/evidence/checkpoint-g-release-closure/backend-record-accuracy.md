# Checkpoint G — backend record accuracy

## Canonical registry (unchanged from Checkpoint F, re-verified)

| Metric | Value |
|---|---|
| Modules | 18 |
| Actions | 330, **0 duplicate ids** |
| Entities | 158, **0 owned by two modules** |
| Actions without required audit | 0 |
| Actions with idempotency `none` | 0 |

## One store per business fact

`parties` (+`party_roles`), `product_templates`/`product_variants`, `uoms`,
`stock_quants`, `work_items`, `assets`. No `customers`, `suppliers`,
`products`, `tasks` or `vendors` table exists alongside them.

## Accuracy facts added by Checkpoint G

| Fact | Evidence |
|---|---|
| A valued receipt produces move + line + quant + valuation fact + stock-to-GL link | backup/restore suite staging |
| Those links survive a backup/restore into a different path | `cross-domain source links survive the round trip` |
| A dual-role party is ONE row plus role rows | Checkpoint F, re-verified |
| Reserved + available always equals on-hand, even under 4-process contention | `simultaneous stock reservation does not oversubscribe` |
| A rejected command leaves zero residue across 24 tables | 22-workflow failure injection |
| **Warehouse code had no uniqueness constraint** | found by concurrency suite; **fixed** by migration 062 |

## Not proven

Numeric agreement across a full posted lifecycle — see
cross-domain-lifecycle-proof.md.
