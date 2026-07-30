# W2-M2 Subscriptions & Recurring Billing — Integration Ready Decision

**Status:** INTEGRATION READY
**Date:** 2026-07-31
**Module ID:** `subscriptions`
**Migration:** `068_subscriptions_and_recurring_billing`

## Verification Summary
- **Migration 068:** Applied, rerun verified, rollback verified.
- **Canonical Reuse:** Direct linkage to `parties`, `sale_orders` (creates canonical confirmed Sale Orders on billing cycle run), `platform_modules`. No direct GL posting or duplicate payment engine.
- **Entities (13):** Subscription Plan, Subscription, Subscription Line, Billing Cycle, Recurring Schedule, Usage Metric, Renewal Policy, Upgrade/Downgrade (Plan Change), Pause Record, Cancellation Record, Billing Attempt, Dunning Policy, Subscription Entitlement.
- **Lifecycle:** Draft -> Active -> Billing -> Renewing -> Renewed (Pause / Cancel support).
- **Idempotency Proof:** `generateBillingCycle` uses `idempotency_key = ${subId}_${pStart}_${pEnd}`. Replaying a billing cycle returns the existing cycle and creates NO duplicate Sale Order or Invoice!
- **Tests:** 4/4 passing in `tests/module-wave-2/subscriptions/subscriptions.test.mjs`.
- **Permissions:** 6 registered runtime permissions (`subscriptions.view`, `subscriptions.create`, `subscriptions.billing.run`, etc.).
