# Duplicate Authority Retirement

## Retired this wave: fabricated-reference "authorities"

The interrupted draft's `recordReceipt`/`recordInspection`/`recordDisposition`
functions silently caught real failures from canonical calls (or skipped
calling them at all for `refund`/`return_to_supplier`) and stored a locally
fabricated id (`rec_fallback_*`, `qncr_fallback_*`, `cn_req_*`,
`supp_ret_*`) as if it referenced a real record. That is a duplicate-truth
pattern in miniature: the RMA row would claim a Finance credit note or a
Procurement supplier return existed, when the actual authority for that fact
never created anything. Retired in this wave's rewrite — see
`returns-rma/current-gap-proof.md` and `returns-rma/lifecycle-proof.md` for
the specific tests (10, 11) that now prove the honest-refusal behavior
instead.

## Pre-existing duplication NOT touched this wave (still open, tracked)

The still-existing local/mock `omni.warrantyHub.claims` registry in
`modules/warranty-rma.js` is a **second**, older, simpler tracking model for
the same real-world event (a customer return/claim) that the new canonical
`returns_rma` authority now also covers. This wave did **not** migrate or
retire it — a new, separately-labelled "RMA (النظام المعتمد)" tab was added
to the same page, wired to the real backend, while the existing "claims"
tracking tab (labelled "محلي" — local) was left as-is. Full retirement
would require either migrating existing local claim data into the canonical
model or a deliberate deprecation decision, which is out of scope for a
single slice — see `returns-rma/deferred-hardening.md`.
