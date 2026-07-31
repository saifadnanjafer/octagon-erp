# Cross-Domain Lifecycle Proof

The assignment's own §35 scenario A ("Return and commission reversal")
requires Sales Commissions (Slice 4, not built this wave) — not provable
yet. The RMA-specific portion of cross-domain proof that IS in scope this
wave is fully exercised by `tests/phase02/returns-rma.test.mjs`:

| Cross-domain fact | Proven by | Real table touched |
|---|---|---|
| Inspection failure → real Quality NCR | Test 6 | `quality_ncrs`, `quality_inspections` |
| Repair disposition → real Work Item, linked to the NCR | Test 6 | `work_items` (`quality_ref` column set to the real `ncr_id`) |
| Refund disposition → real Finance credit note, linked to the original posted invoice | Test 15 | `finance_documents` (`source_type='credit_note_of'`, `source_id`=original invoice id), reversed GL lines from the real invoice's own posted lines |
| A refund/supplier-return that cannot be honestly fulfilled is refused, not fabricated | Tests 10, 11 | (no row created — asserted absence) |
| Cross-company denial at the domain layer | Test 5 | — |
| Idempotent replay does not duplicate the RMA | Test 4 | `returns_rma` unique index |

Scenarios B (credit hold), C (dunning/collections), D (RMA printing), E
(warranty repair — the repair half is covered above; the "warranty
eligibility verified" half depends on the deferred Service Entitlements
module) all depend on slices not built this wave and are not claimed.
