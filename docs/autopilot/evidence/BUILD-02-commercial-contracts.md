# BUILD-02 evidence — Commercial contract authority

Implemented on the selected cutover baseline without importing the divergent
`contracts` model. The existing `sale_contracts` table remains the sole
commercial contract storage authority.

Delivered:

- migration `065_commercial_contract_authority` adds branch scope, idempotency,
  lifecycle timestamps, and the registered contract entity/actions;
- create is idempotent and lifecycle transitions are guarded:
  `draft -> active -> suspended -> terminated`;
- disposable coverage proves migration registration, absence of a parallel
  `contracts` table, replay safety, and the full lifecycle.

Validation: `npm.cmd run test:build-02` passed (1/1).
No operational database, VNext, Telegram worktree, or destructive Git action
was used.
