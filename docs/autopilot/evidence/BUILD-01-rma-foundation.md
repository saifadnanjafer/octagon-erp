# BUILD-01 — RMA Foundation Evidence

## Scope

Clean-room implementation on the selected cutover baseline. The RMA case
workflow owns intake, submit, approve, and orchestration state. Posted stock
and finance returns remain exclusively delegated to the existing
`sales:return:create` authority.

## Delivered

- Migration `064_commercial_rma_foundation`.
- `commercial_rma_cases` and `commercial_rma_lines` with company scope,
  idempotency, state transitions, and sale-order lineage.
- Governed actions: `sales:rma:create`, `sales:rma:submit`,
  `sales:rma:approve`, and `sales:rma:post_return`.
- `sales:rma:post_return` delegates to `createSalesReturn`; it does not write
  stock moves, credit notes, or commissions directly.

## Validation

- `npm.cmd run test:build-01` — 1/1 pass on a disposable database.
- `node --check platform/sales/rma.mjs` — pass.
- `npm.cmd run test:autopilot` — pass.
- Operational database, VNext, and expansion worktrees were not opened or
  modified.

## Completion gate

The end-to-end disposable lifecycle test covers confirmed sale → RMA case →
approval → posted return through the existing sales authority. BUILD-01 is
complete. Idempotent replay and over-return refusal remain regression coverage
owned by the existing sales lifecycle suite; no production activation is
implied.
