# Wave E — Asset-Accounting Interface Report

**Scope:** Packet 03.26 — Asset-accounting interface for Phase 05.
**Evidence date:** 2026-07-22

## What was implemented (Phase 03 scope only, per the packet's own "Implement in Phase 03" list)

- `finance_asset_categories` — account mapping only (asset, depreciation-expense, accumulated-depreciation, disposal-gain, disposal-loss accounts, default method). **No asset register table was created** — deliberately, matching the packet's own "Defer to Phase 05: asset register UX, asset components, operational depreciation scheduler..." list.
- Three posting **command contracts**, each posting through the existing single `finance_document` pipeline (create→submit→approve→post) — none of them writes GL data outside that pipeline, so none of them is a second posting authority:
  - `capitalizeAsset` — debits the category's asset account, credits a caller-supplied source account.
  - `postAssetDepreciation` — debits depreciation expense, credits accumulated depreciation.
  - `disposeAsset` — computes gain/loss from `proceeds - net_book_value` and posts a correctly balanced 2-4 line entry (proceeds account, asset account, and a gain or loss line only when one applies); requires the category to have the corresponding gain/loss account configured, or refuses to post.
- All three flow through the standard period-lock check inherited from `postDocument` — proven directly: a locked period rejects a capitalization attempt with the same "locked" error every other document type produces, confirming the asset interface does not bypass the shared posting gate.

## Files changed

- `database/migrations/032_asset_accounting_interface.mjs`
- `platform/finance/engine.mjs` (+5 exported functions: `createAssetCategory`, `postAssetContract` helper, `capitalizeAsset`, `postAssetDepreciation`, `disposeAsset`)
- `platform/finance/index.mjs` (+4 handler registrations)
- `tests/phase03/finance-wave-e.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Capitalization posts a balanced, posted document | PASS |
| Depreciation posts a balanced, posted document | PASS |
| Disposal with a gain computes and posts the correct gain line | PASS |
| Disposal with a loss computes and posts the correct loss line | PASS |
| Missing disposal-gain-account configuration blocks posting | PASS |
| Period lock blocks asset posting exactly like every other document type | PASS |

Command:

```bash
node tests/phase03/finance-wave-e.test.mjs
# finance-wave-e: 15/15 passed (6 of the 15 are asset-interface-specific)
```

## Fixture evidence

Capitalized a vehicle at 10,000, posted 500 of depreciation, then disposed of it: `net_book_value: 9500, proceeds: 9800` → `gain: 300, loss: 0` (proceeds exceed book value). A second disposal fixture with `net_book_value: 4000, proceeds: 3200` → `gain: 0, loss: 800` (book value exceeds proceeds). Both postings balance exactly (proceeds + loss = net_book_value + gain in every case, verified algebraically and by the shared `validateDocumentBalanced` gate every document already passes through).

## Source composition

- **Current Octagon:** the existing asset/maintenance module tracks fixed assets and depreciation figures in its own store; it does not post to `finance_documents` today. Nothing to preserve structurally — this packet is the finance-side contract that module (or its Phase 05 successor) will call once wired up.
- **VNext:** searched for an asset-accounting engine; none exists. `migrations/705_r7_maintenance.mjs` is a maintenance-scheduling migration, not a depreciation-accounting one. No VNext code was available to port for this packet.
- **ERPNext** Asset / Depreciation Schedule doctypes: clean-room reference for the category→account-mapping and capitalize/depreciate/dispose contract shape; no code copied.

## Scope boundary (explicit, per the packet's own text)

Deferred to Phase 05, as instructed: asset register UX, asset components, operational depreciation scheduler (this Phase 03 interface posts a depreciation amount when called — it does not compute or schedule that amount), maintenance integration, physical location/custody, transfer/disposal workflows, and final lifecycle reports. Phase 03's job was the stable finance contract; that contract is built, tested, and does not duplicate any future asset-accounting engine.
