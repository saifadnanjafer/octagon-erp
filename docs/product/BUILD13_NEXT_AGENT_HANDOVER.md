# BUILD-13 Next-Agent Handover

## Verified working state

- Repository: `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-feature-page-expansion-marathon`
- Branch: `codex/octagon-feature-page-expansion-marathon`
- Local and `origin` SHA: `3e65a17ac26e1804bea42a3a96b5a41d0dd5b6d3`
- Worktree: clean when this handover was created.
- Queue: `BUILD-13` remains **PENDING**. Do not mark it complete: the owner
  decision below has not been made.

## What this continuation completed

1. Replaced BUILD-10 generic illustrative rows with company-scoped,
   read-only projections at `/api/v1/build10/:page`.
2. Removed visible demo seeders from Budgeting, Fleet, and Subscriptions while
   retaining their genuine entry paths.
3. Replaced Enterprise Suite demo seeding with operator-selected bank CSV and
   DMS contract PDF input. The contract flow now asks the operator for the
   source document metadata rather than inventing it.
4. Removed the shared Finance/Cashbox demo transaction seeder from Cashbox,
   Finance, Income, Expenses, Customer Balances, and Receipts. Their real
   transaction and customer entry paths remain.
5. Regenerated the runtime, functional, reality, overlap, and product ledgers
   after authenticated Chromium inspection of the changed primary pages.

Published commits, oldest to newest:

- `25f50b3` — BUILD-10 source-truth recovery.
- `be2e27c`, `77d4792`, `e3e1132` — remove Budgeting, Fleet, and
  Subscription demo seeders.
- `e3d2844` — Fleet source-authority decision record.
- `433814f` — Enterprise Suite real input recovery.
- `3e65a17` — P0 Finance/Cashbox demo-seeder removal.

## Current evidence

- `npm.cmd run test:build-13`: **PASS, 13/13** at `3e65a17`.
- `node --check app.js` and `node --check modules/enterprise-suite.js`: PASS.
- Authenticated Chromium reinspection completed for Banking, Contracts,
  Cashbox, Finance, Expenses, Income, Customers, and Receipts using the
  disposable review database only.
- Current functional ledger: 221 primary workspaces; **75 STRONG, 138 USABLE,
  8 THIN**. P0/P1 THIN, persistence-failure, BROKEN, and DISCONNECTED counts
  remain zero.

## Non-negotiable owner gate

Do **not** merge, redirect, migrate, retire, or otherwise treat the legacy
Fleet page as equivalent to BUILD-10 without an explicit owner choice. The
legacy page retains manual vehicle/fuel/trip records in `omni.fleet`, while
BUILD-10 governs telemetry tables and actions. The complete map and approved
options are in [BUILD13_FLEET_TELEMETRY_CONSOLIDATION.md](BUILD13_FLEET_TELEMETRY_CONSOLIDATION.md).

No production or operational database was changed in this continuation. The
temporary review server was stopped after each inspection run.

## Safe continuation protocol

1. Confirm the nested repository root, branch, clean status, local SHA, and
   `origin` SHA before editing.
2. Read [FINAL_PAGE_READINESS_REPORT.md](FINAL_PAGE_READINESS_REPORT.md), this
   handover, and the Fleet decision record.
3. Take one bounded retained page/workflow at a time. First identify its real
   persistence path and authority. Removing a visible demo loader is safe only
   when it preserves real entry paths and does not create a second authority.
4. Do not perform a canonical data migration, legacy-writer retirement, or
   source-of-truth cutover without the owner’s explicit mapping, date, and
   retention decision.
5. For any runtime-visible change, use the disposable review fixture and
   regenerate product evidence:

   ```powershell
   cmd /c "set PORT=8091&&npm.cmd run review:start"
   $env:INSPECT_IDS='page_a,page_b'
   npm.cmd run product:inspect-pages
   npm.cmd run product:ledger
   npm.cmd run product:reality-ledger
   npm.cmd run product:product-map
   npm.cmd run test:build-13
   ```

   Stop only the review processes started for that run after evidence is
   written. Never use the review launcher against production data.
6. Before publication, run `git diff --check`, commit the code/tests/evidence
   together, push this branch, and verify local SHA equals the remote SHA.

## Likely next safe work

The remaining visible demo loaders are mostly lower-priority retained legacy
surfaces (for example Approvals, Asset Maintenance, Documents, Field Service,
Helpdesk, Marketing, People Ops, Procurement, Rental, Project Management,
Warranty, and vertical packs). Do not bulk-delete them. Audit one workflow at
a time, preserve real entry/persistence behavior, and update the relevant
runtime evidence after any removal.
