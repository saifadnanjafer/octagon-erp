# CRM architecture

CRM extends the existing `crm_leads`, `crm_opportunities`, and
`crm_activities` authorities. It does not create a second customer, quotation,
Sales Order, or Work Item authority.

- Business writes: `platform/domains/crm/*`
- Compatibility adapters: `platform/sales/crm.mjs` and
  `platform/sales/lifecycle.mjs`
- Runtime registration: `platform-runtime-bridge.mjs`
- Governed reads: `platform/domains/crm/query-service.mjs` through
  `platform/api/commercial.mjs`
- Browser transport: `services/canonicalClient.js`
- Original-shell UI: `modules/canonical-sales.js`

The runtime registers Wave 1 handlers after legacy Sales compatibility handlers,
so overlapping legacy action IDs resolve to the Wave 1 services. A repository
scan test rejects direct CRM mutation SQL outside the domain authority.

Canonical authorities reused: Party, Sales, Work Item, permissions, module
control, audit, and outbox.
