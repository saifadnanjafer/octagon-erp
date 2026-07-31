```
database/migrations/084_returns_rma_consolidation.mjs
  → returns_rma / returns_rma_lines / returns_rma_timeline
  → platform_modules / platform_entities / platform_actions rows

platform/domains/returns/rma.mjs            (domain engine, 8 lifecycle functions)
  ├─ createReceiptDraft / validateReturn      [platform/inventory/wms_workflows.mjs]
  ├─ createNCR                                [platform/quality/ncr-capa.mjs]
  ├─ createWorkItemLifecycle                  [platform/work_items/lifecycle.mjs]
  ├─ createCreditNote / getDocument           [platform/finance/engine.mjs]
  └─ createPurchaseReturn                     [platform/procurement/lifecycle.mjs]

platform/domains/returns/returns-actions.mjs
  → registerDomainHandler(executor, actionId, handler)   [platform/kernel/actions/domain-handler.mjs]
  → 8 actions, server-derived scope enforced per call

platform/domains/returns/returns-queries.mjs
  → handleReturnsQuery({resource:'rma'|'rma_timeline'})   company-scoped read

platform-runtime-bridge.mjs
  → registerReturnsActions(actionExecutor)     [added to the existing register* list]

platform/api/index.mjs
  → namespace 'returns' → handleReturnsQuery   [added alongside quality/assets]

modules/warranty-rma.js
  → new "RMA (النظام المعتمد)" tab → fetch('/api/v1/returns/rma'), fetch('/api/v1/actions')
```

See `current-gap-proof.md` for what was wrong before this wave and
`lifecycle-proof.md` for what is proven to work now.
