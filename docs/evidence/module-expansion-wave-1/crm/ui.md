# CRM original-shell UI

CRM is mounted inside the existing `sales` page; no standalone SPA was created.

Visible areas:

- CRM/Sales dashboard
- Leads list, create form, and detail drawer
- Opportunities list and detail drawer
- Pipeline Kanban
- Activities list/calendar and schedule form
- Customer 360
- Pipeline, conversion, and activity reports
- CRM settings for pipelines/stages and scoring rules
- Existing quotation, order, reservation, delivery, return, invoice-request,
  balance, and Sales-report areas

The UI reads through `CanonicalClient.crm` and mutates only through
ActionExecutor commands. It includes loading, empty, error, authorization, and
module-disabled behavior. Arabic RTL, English LTR, desktop, and a 375px mobile
baseline are proven by `browser-smoke.json` and `browser-smoke.png`.
