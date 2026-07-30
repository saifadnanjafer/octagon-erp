# CRM actions

Twenty-nine Wave 1 domain actions are registered in the real runtime:

- Leads: create, update, assign, contact, qualify, disqualify, reopen, archive,
  restore, merge, override score, convert.
- Opportunities: create, update, assign, change stage, change pipeline, mark
  won, mark lost, reopen, archive, restore, add/remove competitor, create
  quotation.
- Activities: create, complete, reschedule, cancel.

Every action uses the shared ActionExecutor transaction, audit, outbox, and
required-idempotency policies. Server-derived company, branch, and actor scope
is applied by `registerDomainHandler`.

Legacy Sales CRM action IDs remain compatibility adapters only and delegate to
the Wave 1 services.
