# Business Flow Map — Wave 3

Engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`
Catalog starting SHA: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`

Status vocabulary: **VERIFIED** = source/API/domain edge is explicit; **PARTIAL** = one side or lifecycle segment is evidenced; **NOT_VERIFIED** = no direct edge in the inspected reference; **MISSING** = required target contract has no identified authoritative edge.

| Flow | Source page/domain | Target page/domain | Status | Evidence / required next proof |
|---|---|---|---|---|
| Customer identity → commercial transaction | Parties / `platform/commercial/parties.mjs` | Sales / `platform/sales/orders.mjs` | VERIFIED | Party roles feed canonical sales queries/actions; prove customer/supplier isolation in browser. |
| Lead/opportunity → quotation/order | Sales / `platform/sales/lifecycle.mjs` | Sales orders / `platform/sales/orders.mjs` | VERIFIED | `crm:*` and `sales:quotation:*` actions create/update `crm_*` and `sale_orders`; add full direct lifecycle proof. |
| Accepted sale → delivery | Sales / `sale_orders` | Logistics/WMS / `stock_pickings`, `sale_fulfilment_demands` | VERIFIED | Confirm order creates picking/fulfilment demand and delivery post action; prove warehouse isolation. |
| Sale → customer invoice/AR | Sales / `createFiscalInvoiceRequest` | Finance / `commercial_fiscal_requests`, `finance_documents` | VERIFIED | Invoice request posts/links Finance source fact; prove idempotency and reversal. |
| Sale → workshop/service job | Sales | Workshop/Field Service | NOT_VERIFIED | No direct source link was established in inspected Sales lifecycle/order modules; owner must define manual or canonical service handoff. |
| Workshop readiness → setup | Readiness / `platform/workshop/readiness.mjs` | Workshop Pack Setup | PARTIAL | Readiness returns setup targets and route test proves navigation; remediation-to-rerun closure not verified. |
| Workshop assigned work → canonical execution | My Work / `platform/workshop/my-work-sources.mjs` | Work/Picking/Shopfloor/Quality targets | VERIFIED | Explicit source registry maps tables to target pages; prove completion state propagation across one source. |
| Workshop material shortage → procurement request | Workshop/material sources | Procurement / `purchase_requests`, requisitions | NOT_VERIFIED | No direct material-demand source link found in Wave 3 evidence; define source document and request creation contract. |
| Procurement request → requisition | Procurement / `platform/procurement/lifecycle.mjs` | Procurement governance | VERIFIED | Approval converts `purchase_requests` to requisitions with source_request_id. |
| Procurement order → receipt/quality/stock | Procurement | WMS/Inventory/Quality | VERIFIED | Receipt posts canonical stock operation, creates receipt event/quality checks/backorder. |
| Procurement receipt/match → AP | Procurement | Finance AP | PARTIAL | Bill-request and three-way-match actions exist; complete bill-posting browser evidence is required. |
| Project task → Work Item | Projects / `platform/projects/index.mjs` | Task Manager / canonical Work Items | VERIFIED | Source explicitly delegates project task creation to Work Item authority; retire legacy duplicate task writers. |
| Project billing → Finance | Projects / `platform/projects/billing.mjs` | Finance / `postSourceFact` | VERIFIED | Billing approval calls Finance posting dependency; prove source document and reversal. |
| Field visit → Finance | Field Service / local `omni.fieldService` | Finance | MISSING | Current bridge is local and not a verified canonical source fact; define service billing authority. |
| Workshop Ledger → Finance | Workshop Ledger / local migration data | Finance | MISSING | Local import/pay actions do not prove Finance document/journal persistence or period/company scope. |
| Installment plan → AR/payment allocation | Finance Installments / local plan | Finance AR | MISSING | No Finance API/action; migrate or retire before treating payment as a receivable fact. |
| Warranty claim → service/RMA/credit | Warranty / `platform/sales/warranty.mjs` | Field Service/RMA/Finance | PARTIAL | Warranty action authority exists; downstream service and financial outcome edges need explicit contracts/tests. |

# Business Flow Map — Wave 4

Engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`

| Flow | Source | Target | Status | Evidence / next proof |
|---|---|---|---|---|
| Legacy cashbox/expense/income row → Finance posted fact | app.js local helpers | Finance engine | MISSING | Local writer and canonical Finance exist, but no verified source-fact handoff for these pages. Freeze/migrate and prove idempotency. |
| Finance posted facts → cash position/liquidity forecast | Finance engine | Treasury/liquidity | PARTIAL | Treasury domain consumes planning inputs; page freshness, currency, and source references are not page-proven. |
| Treasury funding proposal → payment execution | Treasury planning | Finance payment/source fact | NOT_VERIFIED | Proposal domain exists; page-level approval/execution edge and resulting Finance reference are not verified. |
| Intercompany transaction → mismatch → reconciliation | Intercompany operations | Reconciliation/consolidation | PARTIAL | Domain and tests exist; page-level company-pair lifecycle is not proven. |
| Consolidation group → run → report/lineage | Consolidation domain | Consolidated Reports/Lineage | PARTIAL | Domain/test sources exist; individual page authority and read-only child boundaries remain unclear. |
| Tax calculation → report/submission → Finance lineage | Tax module | Finance tax/report authority | PARTIAL | Tax renderer and Finance domain coexist; submission/amendment/source lineage needs direct proof. |
| Workflow canvas → durable definition/version | app.js canvas | WorkflowRegistry | PARTIAL | Durable registry supports immutable versions; local canvas compatibility path must be proven as adapter-only. |
| Workflow definition → runtime instance → registered action | WorkflowRegistry/Runtime | action executor/outbox | VERIFIED | Runtime source enforces registered actions, leases, versions, idempotency, and frozen-zone checks; page lifecycle proof remains needed. |
| Kiosk registration/entitlement → service action | Kiosk/service domains | Service Kiosk | PARTIAL | Domain/tests cover registry, entitlement, signatures, and offline behavior; page route handoff not fully verified. |
