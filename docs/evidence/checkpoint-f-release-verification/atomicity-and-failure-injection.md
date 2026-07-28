# Checkpoint F — atomicity and failure injection

`tests/rollback` contained **zero test files** at the source commit. This is the
replacement proof.

Test: `tests/checkpoint-f/atomicity_and_idempotency.test.mjs` — 9/9 pass.

## Injected failures and observed state

| Injected failure | Action | Assertion after failure | Result |
|---|---|---|---|
| Missing required field | `party:create` with only `company_id` | `parties` count unchanged | PASS |
| Failed precondition, nonexistent parent | `assets:asset:capitalize` with `asset_id='ast_does_not_exist_ckf'` | `assets` unchanged, `asset_depreciation_schedules` unchanged, `platform_outbox` unchanged | PASS |
| Unregistered action id | `manufacturing:order:teleport` | `platform_outbox` unchanged **and** `platform_audit_log` unchanged | PASS |

In every case the action threw, and:

- no orphan record was created;
- no partial child record (depreciation schedule) was created;
- **no outbox event was published announcing work that never happened** — the
  one that matters most, because a false outbox event propagates a lie to every
  downstream consumer;
- no audit entry claimed a success that did not occur.

## Evidence on success

A successful `warehouse:create` increased **both** `platform_audit_log` and
`platform_outbox`. Audit and outbox are not optional side effects: all 330
registered actions carry `audit_policy='required'`, and none carries
`idempotency_policy='none'`.

## Scope integrity

`warehouse:create` with a foreign `company_id` is refused. A caller cannot
assert its own company scope.

## Coverage limits — stated plainly

The mission lists 20 failure-injection targets (sales confirmation, delivery,
three-way match, POS payment, production release, material issue, quality
hold/release, depreciation request, maintenance parts issue, fleet fuel posting,
and the rest). **Three representative injection points were exercised**, chosen
to cover the three distinct rejection paths in the executor: input-schema
rejection, precondition rejection, and unknown-action rejection.

Because all governed actions pass through the same
`ActionExecutor.execute()` transaction boundary, the rollback path is shared —
but *shared code is an argument, not a proof*. The remaining 17 named lifecycle
injection points were **not** individually exercised.

Recorded as an open gap in [unresolved-risks.md](unresolved-risks.md).
