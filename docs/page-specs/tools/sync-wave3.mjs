import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.resolve(ROOT, '..', '..');
const CATALOG_BASELINE = '3c047bb0d04985cd88a536d4dbb16b74d2d6405a';
const ENGINEERING_REFERENCE = '25c24df753962bbf3c13301eed71624bc0ee39b6';
const DATE = '2026-08-14';

const pages = {
  workshop_command_center: {
    goal: 'Supervisors open this page to see the scoped operational briefing, identify unavailable or blocked workshop capabilities, and drill into the canonical workspace that owns the next action.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'DASHBOARD',
    module: 'modules/workshop-command-center.js', view: 'views/workshop_command_center.html',
    api: 'GET /api/v1/workshop/command-center', domain: 'platform/workshop/command-center.mjs',
    tables: ['platform_companies', 'platform_branches', 'warehouses', 'work_items', 'wms_warehouse_tasks', 'wms_pick_tasks_v2', 'mfg_shopfloor_sessions', 'quality_ncrs', 'iot_device_alerts'],
    actions: ['Refresh -> workshop command-center query', 'Open canonical workspace -> switchPage(target)'],
    upstream: ['company/branch/warehouse context', 'workshop readiness'], downstream: ['task_manager', 'warehouse_task_queue', 'picking_execution', 'quality_checkpoint', 'device_health_monitor'],
    tests: ['tests/workshop/command-center-contract.test.mjs', 'tests/workshop/command-center-domain.test.mjs', 'tests/workshop/browser-flows.test.mjs'],
    states: 'READY, PARTIAL, UNAVAILABLE, DENIED, EMPTY, SERVER_ERROR', outputs: 'Scoped total/available/denied/unavailable/partial summary, sections, and target navigation.',
    gaps: [['P1','WORKFLOW_DISCONNECT','The briefing exposes several target pages, but direct action completion remains on the target workspace; no end-to-end supervisor-to-result browser proof is attributed to this page.','Attach a direct browser flow that drills from one non-empty briefing card through the target lifecycle and back.']],
    authority: 'Command-center aggregation is a read-only briefing; the target operational domain owns every mutation.',
    evidence: 'REAL_BROWSER_VISIBLE_UI plus workshop contract/domain tests; no direct mutation proof.',
  },
  my_work: {
    goal: 'Operators open My Work to see assigned, still-open work across canonical work, warehouse, picking, cycle-count, shop-floor, quality, and device-alert sources, then jump to the source workspace.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE',
    module: 'modules/workshop-my-work.js', view: 'views/my_work.html', api: 'GET /api/v1/workshop/my-work', domain: 'platform/workshop/my-work.mjs; platform/workshop/my-work-sources.mjs',
    tables: ['work_items', 'wms_warehouse_tasks', 'wms_pick_tasks_v2', 'wms_count_sessions_v2', 'mfg_shopfloor_sessions', 'quality_ncrs', 'iot_device_alerts', 'platform_saved_views'],
    actions: ['Refresh/filter/preset -> my-work query and saved-view query', 'Open source -> switchPage(source.target)'],
    upstream: ['actor/company/warehouse scope', 'assigned source records'], downstream: ['task_manager', 'warehouse_task_queue', 'picking_execution', 'mobile_cycle_count', 'shopfloor_terminal', 'quality_checkpoint', 'device_health_monitor'],
    tests: ['tests/workshop/my-work-contract.test.mjs', 'tests/workshop/my-work-domain.test.mjs', 'tests/workshop/browser-flows.test.mjs'],
    states: 'LOADING, READY, EMPTY, PARTIAL, DENIED, SERVER_ERROR', outputs: 'Unified assigned-work list with source, status, target page, and saved view state.',
    gaps: [['P1','WORKFLOW_DISCONNECT','The source registry is explicit, but cross-source completion and de-duplication are not proven in one browser lifecycle.','Prove one canonical work item and one warehouse/picking item retain scope and disappear or change state after completion.']],
    authority: 'My Work is an orchestration/read surface; work_items and each source domain remain authoritative.', evidence: 'Workshop contract/domain/browser test references; direct cross-source browser lifecycle NOT VERIFIED.',
  },
  workshop_readiness: {
    goal: 'A workshop manager opens Readiness to determine whether required organization, user, product, warehouse, production, quality, delivery, fleet, device, and governance prerequisites are ready before operational use.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE',
    module: 'modules/workshop-readiness.js', view: 'views/workshop_readiness.html', api: 'GET /api/v1/workshop/readiness', domain: 'platform/workshop/readiness.mjs; platform/workshop/readiness-catalog.mjs',
    tables: ['platform_companies', 'platform_branches', 'platform_identities', 'platform_roles', 'uoms', 'product_templates', 'stock_locations', 'work_centers', 'bom_versions', 'quality_plans', 'sales_orders', 'wms_pick_tasks_v2', 'assets', 'fleet_vehicles', 'iot_devices', 'schema_migrations', 'platform_audit_events'],
    actions: ['Refresh/filter -> readiness query', 'Open setup target -> switchPage(target)'],
    upstream: ['company context', 'readiness authority checks'], downstream: ['workshop_pack_setup', 'finance', 'procurement', 'sales', 'warehouse workspaces'],
    tests: ['tests/workshop/readiness-contract.test.mjs', 'tests/workshop/readiness-domain.test.mjs', 'tests/navigation/workshop-pack-setup-to-readiness.test.mjs'],
    states: 'READY, WARNING, MISSING, BLOCKED, OPTIONAL, PERMISSION_DENIED, NOT_SUPPORTED', outputs: 'Categorized readiness checks, formula, action plan, guidance, and setup navigation.',
    gaps: [['P1','AUTHORITY_CONFLICT','The readiness catalog checks delivery against sales_orders while canonical Sales order persistence uses sale_orders.','Align the check to the canonical table or document a deliberate compatibility view and add a regression test.'],['P1','WORKFLOW_DISCONNECT','Setup navigation is proven, but remediation completion from a readiness finding is not proven as a closed loop.','Add a browser contract that changes one prerequisite and re-runs readiness.']],
    authority: 'Read-only readiness evaluator; it must consume current canonical authorities and never mutate setup.', evidence: 'Workshop readiness contract/domain tests and route test; table-name conflict is source evidence.',
  },
  workshop_pack_setup: {
    goal: 'An authorized administrator opens Workshop Pack Setup to inspect and safely validate, approve, stage, or enable the workshop extension without treating the page as an operational transaction workspace.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'SETUP',
    module: 'modules/build12-workspaces.js', view: 'views/op_packs.html', api: 'POST /api/v1/action/packs:validate|packs:approve|packs:stage|packs:enable', domain: 'Build-12 pack lifecycle authority (exact domain source path NOT VERIFIED)',
    tables: ['platform_pack_installations', 'platform_pack_approval_events', 'platform_audit_events'],
    actions: ['Validate pack -> packs:validate', 'Approve pack -> packs:approve', 'Stage pack -> packs:stage', 'Enable pack -> packs:enable'],
    upstream: ['pack registry and approval context'], downstream: ['workshop_readiness', 'workshop_command_center'], tests: ['tests/build-12/build12-browser.test.mjs', 'tests/build-12/build12-acceptance-contract.test.mjs', 'tests/navigation/workshop-pack-setup-to-readiness.test.mjs'],
    states: 'LOADING, READY, VALIDATION_ERROR, DENIED, STAGED, ENABLED, SERVER_ERROR', outputs: 'Pack lifecycle state and safe extension notice; no workshop job or stock result.',
    gaps: [['P2','CREDIBILITY_GAP','The safe pack lifecycle is tested, but post-enable readiness impact is not asserted in the same browser run.','Add a bounded setup-to-readiness assertion for one enabled pack.']], authority: 'Pack lifecycle owns installation state; readiness consumes the result.', evidence: 'Build-12 acceptance/browser and navigation test sources; route activation is not operational proof.',
  },
  task_manager: {
    goal: 'An operator opens Task Manager to create, assign, prioritize, and advance a canonical work item, including a governed procurement or project reference when applicable.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE',
    module: 'modules/canonical-work-management.js', view: 'views/task_manager.html', api: 'GET /api/v1/work-items; POST /api/v1/action/work_item:*', domain: 'Canonical Work Item authority (exact domain source path NOT VERIFIED)',
    tables: ['work_items', 'work_item_assignments', 'work_item_comments', 'platform_audit_events'],
    actions: ['Create/update/assign/status -> canonical work item action executor', 'Open linked procurement/project -> governed switchPage target'],
    upstream: ['workshop/my-work', 'project task request'], downstream: ['my_work', 'projects', 'procurement', 'shopfloor_terminal'], tests: ['tests/workshop/my-work-domain.test.mjs', 'tests/checkpoint-d-e/projects_lifecycle.test.mjs', 'tests/navigation/workshop-pack-setup-to-readiness.test.mjs'],
    states: 'DRAFT, TODO, ASSIGNED, IN_PROGRESS, BLOCKED, DONE, CANCELLED, DENIED, VALIDATION_ERROR', outputs: 'Persisted work item, assignee/status timeline, and link references.',
    gaps: [['P1','AUTHORITY_OVERLAP','Legacy project-management and work-order surfaces also expose task/job-like records; only canonical project tasks are explicitly delegated to Work Items.','Name one canonical work-item authority and mark legacy task/job records as adapters or retired.']], authority: 'Canonical Work Items own task lifecycle; project page delegates task creation to this authority.', evidence: 'Canonical work-management module and project lifecycle source; direct task browser lifecycle NOT VERIFIED.',
  },
  work_orders: {
    goal: 'A workshop supervisor opens Work Orders to inspect and advance in-house workshop jobs, with clear separation from field visits and canonical generic work items.',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN', kind: 'TRANSACTION',
    module: 'modules/workshop-frontline.js', view: 'views/work_orders.html', api: 'NOT VERIFIED in page module; legacy/local work-order surface', domain: 'Legacy workshop job handlers (exact source path NOT VERIFIED)',
    tables: ['work_orders', 'work_order_lines', 'mfg_shopfloor_sessions'],
    actions: ['Open/update/complete work order -> handler and persistence NOT VERIFIED from page source'], upstream: ['customer/sales or workshop intake'], downstream: ['shop-floor, quality, delivery, finance'], tests: ['tests/workshop/browser-flows.test.mjs'],
    states: 'NOT_VERIFIED; page-level loading/empty/error contract requires recovery', outputs: 'Workshop job status and work instructions, persistence NOT VERIFIED.',
    gaps: [['P1','CREDIBILITY_GAP','The page is cataloged as a primary transaction, but the inspected page evidence does not establish its API/domain owner or lifecycle persistence.','Recover the renderer/domain contract and attach a direct create-to-complete lifecycle.'],['P1','AUTHORITY_OVERLAP','Work Orders, Work Items, and field-service visits use overlapping job language.','Publish a business glossary and explicit ownership boundary.']], authority: 'UNKNOWN; do not treat this page as authoritative until source and persistence are recovered.', evidence: 'Static/navigation evidence only; NOT_VERIFIED for API, domain, persistence, and direct browser action.',
  },
  service_queue_board: {
    goal: 'A service manager opens the queue board to prioritize and route service work using visible status, ownership, and exception signals.',
    status: 'CONNECTED', usability: 'STRONG', disposition: 'KEEP_PRIMARY', kind: 'QUEUE',
    module: 'Service queue renderer (source path NOT VERIFIED)', view: 'Service queue view (source path NOT VERIFIED)', api: 'GET /api/v1/service/queue; POST /api/v1/action/service:*', domain: 'Service queue authority (source path NOT VERIFIED)',
    tables: ['service_jobs', 'service_queue_events', 'work_items'], actions: ['Refresh/filter -> service queue query', 'Assign/status action -> service action executor'], upstream: ['service intake, customer, workshop job'], downstream: ['task_manager', 'field_service', 'finance'], tests: ['tests/phase03/service_queue.test.mjs', 'tests/navigation/run-click-audit.mjs'],
    states: 'LOADING, READY, EMPTY, BLOCKED, DENIED, SERVER_ERROR', outputs: 'Prioritized queue, assignment/status updates, and exception reason.', gaps: [['P1','WORKFLOW_DISCONNECT','A queue handoff to canonical workshop, field-service, and finance completion is not proven as one lifecycle.','Add one direct browser flow for assignment through completion and financial handoff.']], authority: 'Queue owns routing state; service/workshop/finance domains own downstream effects.', evidence: 'Page/module and focused service test references; downstream persistence not fully verified.',
  },
  parties: {
    goal: 'A commercial or procurement user opens Parties to search, create, update, archive, and restore the canonical customer/supplier party record and role.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'LIST', module: 'modules/customers-and-suppliers.js', view: 'views/customers_and_suppliers.html', api: 'GET /api/v1/commercial/parties; POST /api/v1/action/party:*', domain: 'platform/commercial/parties.mjs', tables: ['parties', 'party_roles', 'party_addresses', 'platform_audit_events'],
    actions: ['Create -> party:create', 'Update -> party:update', 'Archive/restore -> party:archive/party:restore', 'Search/include archived -> commercial parties query'], upstream: ['organization/company scope'], downstream: ['sales', 'procurement', 'finance', 'customer_portal', 'warranty'], tests: ['tests/phase04-finalization/customers_and_suppliers.test.mjs', 'tests/checkpoint-canonical-parties.test.mjs'], states: 'LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SUCCESS, SERVER_ERROR', outputs: 'Canonical party identity, roles, addresses, archive state.', gaps: [['P1','WORKFLOW_DISCONNECT','Customer and supplier role transitions are read by several domains, but cross-domain role-isolation proof is not attributed here.','Add a browser/API isolation test for customer-only and supplier-only visibility.']], authority: 'Parties domain and parties tables are canonical identity authority.', evidence: 'Canonical module, commercial API, party domain and finalization tests.',
  },
  customers: {
    goal: 'A finance user opens Customers to inspect customer balances and customer-facing financial context without creating a second customer identity authority.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'CONSOLIDATE_WITH_PARTIES_REVIEW', kind: 'LIST', module: 'modules/canonical-sales.js', view: 'views/customers_and_suppliers.html', api: 'GET /api/v1/commercial/parties?role=customer; GET /api/v1/finance/*', domain: 'platform/commercial/parties.mjs; platform/finance/engine.mjs', tables: ['parties', 'party_roles', 'finance_documents', 'finance_journal_entries'],
    actions: ['Filter customer -> parties query', 'Open finance context -> finance/customer open-items query'], upstream: ['parties', 'posted finance documents'], downstream: ['sales', 'ar_ap', 'customer_portal'], tests: ['tests/phase04-finalization/customers_and_suppliers.test.mjs', 'tests/phase04-finalization/canonical_sales.test.mjs'], states: 'LOADING, READY, EMPTY, DENIED, SERVER_ERROR', outputs: 'Customer list and finance-linked open-item context.', gaps: [['P2','CONSOLIDATION_CANDIDATE','Customers and Parties expose overlapping identity surfaces; ownership is not clear from navigation names alone.','Owner decision: make Customers a finance-filtered view of Parties or document its distinct finance goal.']], authority: 'Parties owns identity; Finance owns balances/open items.', evidence: 'Manifest page mapping plus canonical commercial/sales/finance sources; dedicated Customers renderer boundary needs confirmation.',
  },
  sales: {
    goal: 'A sales user opens Sales to manage leads/opportunities through quotation, approval, acceptance, order confirmation, reservation, delivery, return, and invoice-request handoffs.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE', module: 'modules/canonical-sales.js', view: 'views/sales.html', api: 'GET /api/v1/commercial/sales/*; POST /api/v1/action/{crm,sales}:*', domain: 'platform/sales/index.mjs; platform/sales/lifecycle.mjs; platform/sales/orders.mjs', tables: ['crm_leads', 'crm_opportunities', 'crm_opportunity_activities', 'sale_orders', 'sale_order_lines', 'sale_fulfilment_demands', 'stock_pickings', 'commercial_fiscal_requests', 'finance_documents'],
    actions: ['CRM convert/activity/close -> crm:*', 'Quotation submit/approve/revise/accept -> sales:quotation:*', 'Order confirm/reserve/delivery/return/cancel -> sales:order:* and sales:delivery:*', 'Invoice request -> sales:invoice_request:create'], upstream: ['parties', 'products', 'price lists', 'warehouse'], downstream: ['logistics/delivery', 'finance/ar_ap', 'warranty/rma', 'customer_portal'], tests: ['tests/checkpoint-c/canonical_sales_ui.test.mjs', 'tests/checkpoint-c/sales_lifecycle.test.mjs', 'tests/phase04/canonical_sales.test.mjs', 'tests/phase04-finalization/canonical_sales.test.mjs'], states: 'LEAD, OPPORTUNITY, QUOTATION_DRAFT, SENT, APPROVED, ACCEPTED, SALE, RESERVED, DELIVERED, RETURNED, CANCELLED, DENIED, VALIDATION_ERROR, SERVER_ERROR', outputs: 'Canonical sales order, fulfilment demand/picking, return, and finance invoice request references.', gaps: [['P1','WORKFLOW_DISCONNECT','The canonical sales flow links delivery and finance, but direct linkage from an accepted sale to workshop job/service execution is not verified.','Define and test the commercial-to-workshop handoff or explicitly mark it external/manual.']], authority: 'Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.', evidence: 'Canonical UI, sales lifecycle/order domain and checkpoint/phase04 tests.',
  },
  sales_contracts: {
    goal: 'A user opens Sales Contracts expecting a governed contract lifecycle tied to customer, commercial terms, service obligations, and downstream billing.',
    status: 'SIMULATED_BY_DESIGN', usability: 'THIN', disposition: 'CONSOLIDATE_WITH_CANONICAL_SALES', kind: 'PAGE', module: 'modules/sales-contracts.js', view: 'views/sales_contracts.html', api: 'No /api/v1 call in module; browser/local storage save()', domain: 'platform/sales/contracts.mjs (canonical source exists but is not consumed by this renderer)', tables: ['localStorage sales contracts object', 'sale_contracts (canonical domain candidate)'],
    actions: ['Create/edit/approve/activate/complete/cancel -> local object lifecycle', 'switchPage(sales_contracts) -> route only'], upstream: ['customer/quotation context NOT VERIFIED'], downstream: ['billing/service obligations NOT VERIFIED'], tests: ['tests/navigation/run-click-audit.mjs'], states: 'DRAFT, ACTIVE, COMPLETED, CANCELLED (local only)', outputs: 'Browser-local contract object; canonical persistence NOT VERIFIED.', gaps: [['P0','AUTHORITY_CONFLICT','A localStorage contract workspace is presented beside canonical sales contract actions: sales:contract:create/activate/suspend/terminate.','Disable or migrate the local renderer; bind the page to platform/sales/contracts.mjs and prove persistence/isolation.'],['P1','WORKFLOW_DISCONNECT','No verified link from contract to quotation, service delivery, warranty, or finance.','Define contract source, terms, obligation schedule, and billing handoff.']], authority: 'Canonical contract domain is the intended authority; current page is not connected.', evidence: 'Direct module source shows localStorage and no API; canonical action registry provides the conflicting authority.',
  },
  sales_price_lists: {
    goal: 'A sales administrator opens Price Lists to maintain governed product pricing and provide the price context consumed by quotations and orders.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'LIST', module: 'modules/sales-price-lists.js', view: 'views/sales_price_lists.html', api: 'GET /api/v1/commercial/price-lists; POST /api/v1/action/price_list:*', domain: 'platform/commercial/pricing.mjs; platform/sales/orders.mjs', tables: ['product_price_lists', 'product_price_list_items', 'product_variants', 'sale_order_lines'], actions: ['Create/update/activate price list -> price list action boundary', 'Select price list -> quotation/order pricing query'], upstream: ['products/UOMs', 'company/currency'], downstream: ['sales quotations/orders', 'customer portal'], tests: ['tests/phase04/canonical_sales.test.mjs', 'tests/phase04-finalization/canonical_sales.test.mjs'], states: 'DRAFT, ACTIVE, ARCHIVED, DENIED, VALIDATION_ERROR, SERVER_ERROR', outputs: 'Effective price list/item values used by commercial transactions.', gaps: [['P1','CREDIBILITY_GAP','Exact action IDs and precedence when multiple price lists apply are not fully attributed in page evidence.','Attach price resolution tests for customer, product, currency, and validity date.']], authority: 'Commercial pricing domain owns price-list records; Sales consumes resolved prices.', evidence: 'Canonical sales module/API and phase04 tests; exact renderer action wiring should be confirmed.',
  },
  customer_portal: {
    goal: 'A customer-facing user opens the portal to view permitted commercial documents, delivery status, balances, contracts, and service/warranty requests without exposing another company’s data.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE', module: 'Customer portal renderer (source path NOT VERIFIED)', view: 'views/customer_portal.html', api: 'GET /api/v1/commercial/portal/*; POST /api/v1/action/portal:*', domain: 'Customer portal authority (source path NOT VERIFIED); platform/sales/orders.mjs; platform/finance/engine.mjs', tables: ['portal_users', 'portal_access_grants', 'sale_orders', 'stock_pickings', 'finance_documents', 'sales_contracts'], actions: ['View/download/request -> portal read/action boundary; exact mutation set requires server proof'], upstream: ['party/portal identity', 'sales and finance documents'], downstream: ['sales support', 'warranty', 'finance requests'], tests: ['tests/phase04-finalization/canonical_sales.test.mjs'], states: 'LOADING, READY, EMPTY, DENIED, EXPIRED, SERVER_ERROR', outputs: 'Scoped customer document/status view and permitted request reference.', gaps: [['P1','ISOLATION_GAP','Cross-company and delegated-portal isolation is not proven by navigation evidence.','Add browser/API assertions for direct object access, expired grants, and customer-to-party mapping.']], authority: 'Portal grants control visibility; source sales/finance domains own records.', evidence: 'Customer portal view plus sales/finance source boundaries; direct lifecycle/isolation evidence remains bounded.',
  },
  warranty: {
    goal: 'A service or sales user opens Warranty to register, submit, approve, and close customer warranty coverage or claim state linked to a sale or service record.',
    status: 'CONNECTED', usability: 'THIN', disposition: 'STRENGTHEN', kind: 'PAGE', module: 'Warranty renderer (source path NOT VERIFIED)', view: 'views/warranty.html', api: 'GET /api/v1/commercial/warranty; POST /api/v1/action/sales:warranty:*', domain: 'platform/sales/warranty.mjs', tables: ['sales_warranties', 'sales_warranty_events', 'sale_orders', 'parties'], actions: ['Create/submit/approve/close -> sales:warranty:create/submit/approve/close'], upstream: ['party', 'sale order/product/serial evidence'], downstream: ['field service/RMA', 'finance credit or service charge'], tests: ['tests/checkpoint-c/sales_lifecycle.test.mjs', 'tests/phase04/canonical_sales.test.mjs'], states: 'DRAFT, SUBMITTED, APPROVED, CLOSED, DENIED, VALIDATION_ERROR', outputs: 'Warranty record, decision/event history, downstream claim reference.', gaps: [['P1','WORKFLOW_DISCONNECT','The warranty authority exists, but linkage to field service and finance charge/credit outcomes is not verified.','Define accepted claim to service/RMA and financial outcome edges.']], authority: 'Sales warranty domain owns warranty state; service/RMA/Finance own effects.', evidence: 'Sales warranty domain/action registry and canonical sales test references.',
  },
  contracts: {
    goal: 'A resource or service administrator opens Contracts to understand the organization’s contract records and obligations, including whether this is the same authority as Sales Contracts.',
    status: 'THIN', usability: 'THIN', disposition: 'OWNER_DECISION_REQUIRED', kind: 'PAGE', module: 'Contracts renderer (source path NOT VERIFIED)', view: 'views/contracts.html', api: 'NOT VERIFIED in page-specific evidence', domain: 'Contracts authority NOT VERIFIED; platform/sales/contracts.mjs is a competing candidate', tables: ['contracts (candidate)', 'sale_contracts (candidate)'], actions: ['List/create/update -> API/domain/persistence NOT VERIFIED'], upstream: ['customer/vendor/service context NOT VERIFIED'], downstream: ['sales_contracts', 'procurement', 'projects', 'finance'], tests: [], states: 'NOT_VERIFIED', outputs: 'Contract records and obligations NOT VERIFIED.', gaps: [['P0','AUTHORITY_CONFLICT','Contracts and Sales Contracts are separate primary navigation destinations while canonical ownership and persistence are not resolved.','Owner must choose one canonical contract home and classify the other as a view, child workflow, or retired alias.']], authority: 'UNKNOWN; do not allow parallel writes.', evidence: 'Navigation/page inventory only plus canonical sales contract action registry; no recovered page API.',
  },
  procurement: {
    goal: 'A procurement user opens Procurement to create and govern requests/requisitions, source suppliers, place orders, receive goods, match bills, and record returns.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE', module: 'modules/canonical-procurement.js', view: 'views/procurement.html', api: 'GET /api/v1/procurement/*; POST /api/v1/action/procurement:*', domain: 'platform/procurement/index.mjs; platform/procurement/governance.mjs; platform/procurement/lifecycle.mjs; platform/procurement/orders.mjs; platform/procurement/matching.mjs', tables: ['purchase_requests', 'purchase_request_lines', 'purchase_requisitions', 'purchase_orders', 'purchase_order_lines', 'purchase_fulfilment_demands', 'stock_pickings', 'purchase_receipt_events', 'purchase_quality_checks', 'purchase_bill_requests', 'purchase_returns', 'finance_documents'], actions: ['Create/submit/approve request/requisition -> procurement:request:* / procurement:requisition:*', 'Create RFQ/record/award supplier quote -> procurement:rfq:* / procurement:supplier_quotation:*', 'Create/approve/confirm order -> procurement:order:*', 'Receive/match/bill/return/score -> procurement:receipt:post, procurement:threewaymatch:perform, procurement:bill_request:create, procurement:return:create, procurement:score:record'], upstream: ['parties supplier role', 'products', 'warehouse', 'approval'], downstream: ['warehouse receiving/quality', 'finance AP', 'material availability'], tests: ['tests/checkpoint-c/canonical_procurement_ui.test.mjs', 'tests/checkpoint-c/procurement_lifecycle.test.mjs', 'tests/phase04/canonical_procurement.test.mjs'], states: 'DRAFT, SUBMITTED, APPROVED, RFQ, AWARDED, PURCHASE, RECEIVED, QUALITY_HOLD, MATCHED, BILLED, RETURNED, CLOSED, DENIED, VALIDATION_ERROR', outputs: 'Requisition/RFQ/order/receipt/match/bill/return records with stock and Finance references.', gaps: [['P1','WORKFLOW_DISCONNECT','Workshop material demand is visible in operational sources, but a direct canonical material-demand-to-purchase-request edge is not verified.','Define the source document/link and prove one shortage-to-request flow.']], authority: 'Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.', evidence: 'Canonical procurement UI, action registry, lifecycle/order/matching sources, and checkpoint/phase04 tests.',
  },
  supplier_portal: {
    goal: 'A supplier user opens the portal to view permitted sourcing/order/receipt requests and submit supplier-side responses without becoming the purchasing or AP authority.',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN', kind: 'PAGE', module: 'Supplier portal renderer (source path NOT VERIFIED)', view: 'views/supplier_portal.html', api: 'NOT VERIFIED in page-specific evidence', domain: 'platform/procurement authority is the canonical candidate', tables: ['portal_users', 'portal_access_grants', 'purchase_orders', 'supplier_quotations', 'purchase_receipt_events'], actions: ['View/respond -> API/domain/persistence NOT VERIFIED'], upstream: ['supplier party/portal grant', 'RFQ or purchase order'], downstream: ['procurement award/order/receipt', 'AP'], tests: [], states: 'NOT_VERIFIED', outputs: 'Supplier response/status NOT VERIFIED.', gaps: [['P1','CREDIBILITY_GAP','Primary supplier portal navigation is not connected to the canonical procurement action boundary in the inspected evidence.','Recover portal API, supplier isolation, and submit-to-procurement lifecycle.']], authority: 'Procurement remains authoritative; portal is a constrained participant.', evidence: 'Page/view/navigation inventory; canonical procurement actions are known but not linked by this renderer.',
  },
  logistics: {
    goal: 'A logistics user opens Logistics to coordinate warehouse operations, deliveries, receipts, reservations, and stock movement references generated by canonical Sales and Procurement workflows.',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN', kind: 'PAGE', module: 'Logistics renderer (source path NOT VERIFIED)', view: 'views/logistics.html', api: 'GET /api/v1/commercial/warehouse/* and procurement/stock resources; exact page wiring NOT VERIFIED', domain: 'Inventory/WMS authority (source paths NOT VERIFIED); platform/api/commercial.mjs', tables: ['stock_pickings', 'stock_moves', 'stock_locations', 'stock_reservations', 'sale_fulfilment_demands', 'purchase_fulfilment_demands'], actions: ['View/operate receipt/delivery/reservation -> exact page actions NOT VERIFIED'], upstream: ['sales delivery demands', 'purchase receipt demands', 'warehouse scope'], downstream: ['customer delivery', 'supplier receipt', 'finance valuation'], tests: ['tests/checkpoint-c/canonical_procurement_ui.test.mjs', 'tests/checkpoint-c/canonical_sales_ui.test.mjs'], states: 'NOT_VERIFIED; canonical WMS states are source-specific', outputs: 'Warehouse execution state and canonical move/picking references.', gaps: [['P1','CREDIBILITY_GAP','The page is primary but its exact renderer-to-WMS action boundary is not established; source-level downstream evidence exists elsewhere.','Recover page-specific actions and prove one Sales delivery and one Procurement receipt lifecycle.']], authority: 'Inventory/WMS owns stock movement; Logistics should orchestrate or present it.', evidence: 'Commercial API and canonical sales/procurement domain sources; page-specific proof incomplete.',
  },
  approvals: {
    goal: 'An approver opens Approvals to review governed requests and apply maker-checker decisions with an auditable result that downstream domains consume.',
    status: 'CONNECTED', usability: 'STRONG', disposition: 'KEEP_PRIMARY', kind: 'PAGE', module: 'Approvals renderer (source path NOT VERIFIED)', view: 'views/approvals.html', api: 'GET /api/v1/approvals; POST /api/v1/action/approval:*', domain: 'Governance approval authority (source path NOT VERIFIED)', tables: ['approval_requests', 'approval_steps', 'approval_events', 'platform_audit_events'], actions: ['Submit/approve/reject -> approval action boundary; exact IDs require source verification'], upstream: ['sales/procurement/project/finance request'], downstream: ['quotation/order/requisition/budget/finance state'], tests: ['tests/checkpoint-c/canonical_procurement_ui.test.mjs', 'tests/phase04/canonical_procurement.test.mjs'], states: 'DRAFT, SUBMITTED, PENDING, APPROVED, REJECTED, CANCELLED, DENIED', outputs: 'Approval decision/event and target record transition reference.', gaps: [['P1','WORKFLOW_DISCONNECT','Approval UI and domain are shared across workflows, but target-specific maker-checker and delegation rules are not mapped here.','Publish action-to-target matrix and prove separation of requester/approver.']], authority: 'Governance approval events are authoritative for decision; target domain owns the business record.', evidence: 'Approval navigation/source and procurement/sales approval consumers; exact page action wiring bounded.',
  },
  projects: {
    goal: 'A project manager opens Projects to manage projects, phases, milestones, tasks, budgets, commitments, risks, issues, effort, billing, and profitability through canonical project authority.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE', module: 'modules/canonical-projects.js', view: 'views/projects.html', api: 'GET /api/v1/projects/*; POST /api/v1/action/projects:*', domain: 'platform/projects/index.mjs; platform/projects/projects.mjs; platform/projects/budget.mjs; platform/projects/billing.mjs; platform/projects/effort.mjs; platform/projects/costing.mjs', tables: ['projects', 'project_phases', 'project_milestones', 'project_tasks', 'project_cost_codes', 'project_budgets', 'project_commitments', 'project_change_orders', 'project_risks', 'project_issues', 'project_effort', 'project_billing_requests', 'finance_documents'], actions: ['Project/template/phase/milestone/task -> projects:*', 'Budget/commitment/change/risk/issue/effort -> projects:*', 'Billing request/approve -> projects:billing:* with Finance postSourceFact'], upstream: ['customer/contract/sales context', 'work items'], downstream: ['task_manager', 'procurement commitments', 'finance billing', 'delivery'], tests: ['tests/checkpoint-d-e/projects_lifecycle.test.mjs', 'tests/checkpoint-d-e/projects_lifecycle.test.mjs'], states: 'DRAFT, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED, APPROVED, REJECTED, AT_RISK, INVOICED, DENIED', outputs: 'Project lifecycle, canonical Work Item task, budget/commitment/change records, effort, and Finance billing reference.', gaps: [['P1','AUTHORITY_OVERLAP','Legacy project-management fixtures/localStorage remain navigable beside canonical Projects.','Retire or explicitly mark legacy project surface and keep canonical Projects as sole project write authority.'],['P1','WORKFLOW_DISCONNECT','Project billing is Finance-linked, but customer contract/sales-origin and delivery completion edges are not proven end to end.','Add source-document and browser proof for project-to-billing handoff.']], authority: 'Projects owns project records; Work Items own tasks; Finance is the only GL writer.', evidence: 'Canonical project module/API/domain and lifecycle tests; duplicate legacy source is a known boundary.',
  },
  field_service: {
    goal: 'A field-service coordinator opens Field Service to schedule and close customer visits, capture technician work and charge context, and hand off any financial result through a canonical authority.',
    status: 'PARTIALLY_CONNECTED', usability: 'THIN', disposition: 'CONSOLIDATE_WITH_SERVICE_REVIEW', kind: 'PAGE', module: 'modules/field-service.js', view: 'views/field_service.html', api: 'No canonical field-service API shown; local omni.fieldService state and finance bridge', domain: 'local omni.fieldService; platform/finance engine is a downstream candidate', tables: ['omni.fieldService.visits', 'omni finance transaction bridge', 'parties/customers (read candidate)'], actions: ['Create/update/complete visit -> local visits action', 'Record charge -> addFinanceTransaction bridge', 'Audit/history -> local audit helper'], upstream: ['customer/site/technician', 'service queue'], downstream: ['finance', 'warranty/RMA', 'work orders'], tests: ['tests/phase03/field_service.test.mjs', 'tests/navigation/run-click-audit.mjs'], states: 'PLANNED, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED (local/partially connected)', outputs: 'Local field visit and possible finance transaction; canonical invoice/GL result NOT VERIFIED.', gaps: [['P0','AUTHORITY_CONFLICT','Field Service writes local visit state and calls a finance bridge while canonical Projects/Sales/Finance authorities exist.','Choose canonical field-service/service-job authority and route financial effects through Finance source facts.'],['P1','WORKFLOW_DISCONNECT','No verified link from field visit to warranty, sales order, project task, or posted finance document.','Define service completion and billing source-document contract.']], authority: 'Current authority is local/unclear; Finance must remain the only GL writer.', evidence: 'Module comments and source show local omni state, AuditService, and addFinanceTransaction; no canonical API route shown.',
  },
  fleet_operations_board: {
    goal: 'A fleet or operations manager opens the board to monitor vehicle/asset readiness, assignments, and exceptions that affect delivery or field execution.',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN', kind: 'BOARD', module: 'Fleet operations renderer (source path NOT VERIFIED)', view: 'Fleet operations view (source path NOT VERIFIED)', api: 'GET /api/v1/fleet/*; exact page wiring NOT VERIFIED', domain: 'Fleet domain candidate; platform/workshop/readiness.mjs', tables: ['fleet_vehicles', 'assets', 'maintenance_work_orders', 'fleet_assignments'], actions: ['Refresh/assign/status -> exact action boundary NOT VERIFIED'], upstream: ['fleet/asset/maintenance state'], downstream: ['delivery', 'field_service', 'workshop readiness'], tests: ['tests/workshop/readiness-domain.test.mjs'], states: 'NOT_VERIFIED; readiness states may be consumed', outputs: 'Fleet board and exception/readiness signals.', gaps: [['P2','CREDIBILITY_GAP','The page is in delivery operations but its API/action persistence is not evidenced at the selected reference.','Recover direct renderer/domain contract and one assignment-to-delivery exception flow.']], authority: 'Fleet domain candidate; readiness consumes fleet checks but does not own fleet mutations.', evidence: 'Navigation and readiness source; page-specific lifecycle NOT_VERIFIED.',
  },
  finance: {
    goal: 'A finance user opens Finance to manage documents, journals, periods, payments, reconciliation, budgets, source facts, and reports with Finance as the sole accounting authority.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE', module: 'Finance renderer (source path NOT VERIFIED)', view: 'views/finance.html', api: 'GET /api/v1/finance/*; POST /api/v1/action/finance:*', domain: 'platform/finance/index.mjs; platform/finance/engine.mjs', tables: ['finance_documents', 'finance_document_lines', 'finance_journal_entries', 'finance_journal_lines', 'finance_periods', 'finance_locks', 'finance_payments', 'finance_reconciliations', 'finance_source_facts'], actions: ['Create/submit/approve/post/reverse/amend/cancel/write_off -> finance:document:*', 'Periods/payments/reconciliation/budgets/source facts -> finance:* action families'], upstream: ['sales invoice requests', 'procurement bills', 'project billing', 'payments'], downstream: ['AR/AP reports', 'customer/supplier balances', 'tax/compliance', 'management reporting'], tests: ['tests/phase04/canonical_finance.test.mjs', 'tests/phase04-finalization/canonical_finance.test.mjs'], states: 'DRAFT, SUBMITTED, APPROVED, POSTED, REVERSED, CANCELLED, WRITTEN_OFF, OPEN, SOFT_CLOSED, HARD_CLOSED, DENIED', outputs: 'Finance document/journal/hash-chain and source-fact references.', gaps: [['P1','WORKFLOW_DISCONNECT','Several legacy pages still claim finance-like writes; their migration to source facts is not complete.','Inventory and block non-Finance GL writes, then prove source-document idempotency.']], authority: 'Finance engine is the sole GL writer and canonical AR/AP authority.', evidence: 'Finance API/index/engine and canonical finance test sources.',
  },
  ar_ap: {
    goal: 'A finance user opens AR/AP to review customer and supplier open items, aging, holds, releases, and payment allocation without editing source transactions outside Finance.',
    status: 'CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY', kind: 'PAGE', module: 'AR/AP renderer (source path NOT VERIFIED)', view: 'views/ar_ap.html', api: 'GET /api/v1/finance/ar|ap/*; POST /api/v1/action/finance_ar|finance_ap:*', domain: 'platform/finance/engine.mjs; platform/finance/index.mjs', tables: ['finance_documents', 'finance_document_lines', 'finance_payments', 'finance_payment_allocations', 'parties'], actions: ['Open items/aging -> finance_ar:open_items/aging and finance_ap:open_items/aging', 'Hold/release -> finance_ap:hold/release_hold', 'Payment allocation -> finance:payment:*'], upstream: ['posted sales invoices', 'posted supplier bills', 'payments'], downstream: ['collections', 'supplier payment', 'reconciliation', 'reports'], tests: ['tests/phase04/canonical_finance.test.mjs', 'tests/phase04-finalization/canonical_finance.test.mjs'], states: 'OPEN, PARTIAL, PAID, OVERDUE, ON_HOLD, RELEASED, RECONCILED, DENIED', outputs: 'Scoped balances/aging and allocation/hold state.', gaps: [['P1','CREDIBILITY_GAP','Exact page-specific permission and direct browser action evidence are not separated from Finance engine tests.','Attach AR/AP role-isolation and payment-allocation browser proof.']], authority: 'Finance engine owns AR/AP open items, aging, holds, and allocations.', evidence: 'Finance engine/index action registry and finance test sources; page renderer direct proof bounded.',
  },
  workshop_ledger: {
    goal: 'A workshop finance user opens Workshop Ledger expecting a trustworthy ledger, cashbox, advances, attendance, and payroll-related view tied to canonical Finance.',
    status: 'SIMULATED_BY_DESIGN', usability: 'THIN', disposition: 'RETIRE_OR_MIGRATE', kind: 'PAGE', module: 'modules/workshop-ledger.js', view: 'views/workshop_ledger.html', api: 'Fetch /workshop_migration_data.json plus local import/actions; no canonical Finance API shown', domain: 'local workshop_migration_data and local finance transaction helpers', tables: ['workshop_migration_data.json', 'local finance transactions', 'attendance/advances local collections'], actions: ['Run import/pay salary/audit -> local data mutation and local finance helper'], upstream: ['workshop migration JSON', 'attendance/advance local state'], downstream: ['cashbox/payroll/finance reports NOT VERIFIED'], tests: ['tests/phase03/workshop_ledger.test.mjs', 'tests/navigation/run-click-audit.mjs'], states: 'IMPORTED, EDITABLE, PAID, AUDITED (local)', outputs: 'Local ledger/import result; canonical journal/posting reference NOT VERIFIED.', gaps: [['P0','AUTHORITY_CONFLICT','Workshop Ledger presents a unified financial table and local pay/import actions while Finance is the canonical GL authority.','Freeze new writes, define migration/source-fact mapping, and replace local posting with Finance actions.'],['P1','CREDIBILITY_GAP','No tenant/company/period isolation or idempotent migration proof is attributed to the page.','Add migration rehearsal evidence and source-document idempotency.']], authority: 'Current local authority conflicts with canonical Finance; page must not be treated as posted accounting.', evidence: 'Module source explicitly reads migration JSON and uses local finance helpers; no canonical Finance API wiring shown.',
  },
  finance_installments: {
    goal: 'A finance user opens Installment Plans to create and monitor a customer payment schedule, register payments, and reconcile the schedule to a canonical receivable rather than a browser-local balance.',
    status: 'SIMULATED_BY_DESIGN', usability: 'THIN', disposition: 'RETIRE_OR_MIGRATE', kind: 'PAGE', module: 'modules/finance-installments.js', view: 'views/finance_installments.html', api: 'No /api/v1 call; omni.finance.installmentPlans and saveData/local state', domain: 'local browser finance object; Finance AR is canonical candidate', tables: ['omni.finance.installmentPlans', 'local installment lines', 'finance_documents candidate'], actions: ['Create plan/pay/complete/delete -> local object mutation; no Finance action ID'], upstream: ['local customer list and manually entered total'], downstream: ['local late view; canonical AR/payment allocation NOT VERIFIED'], tests: ['tests/navigation/run-click-audit.mjs'], states: 'ACTIVE, COMPLETED, DEFAULTED, PENDING, PAID, LATE (local)', outputs: 'Browser-local plan/line status and KPI strip.', gaps: [['P0','AUTHORITY_CONFLICT','Installment plans and payments are local while Finance owns AR documents, payments, and allocations.','Migrate schedules to a canonical Finance receivable/payment contract or retire this writer.'],['P1','WORKFLOW_DISCONNECT','No source invoice, currency, company, period, idempotency, or payment allocation reference is present.','Define required source document and post/allocate lifecycle before reuse.']], authority: 'Current local authority is not acceptable for financial posting; Finance AR must own result.', evidence: 'Full module source shows omni/local state, prompt-based payment, saveData, and no API call.',
  },
};

const q = (value) => JSON.stringify(value);
const safe = (value) => String(value).replace(/\\/g, '/');
const replaceSection = (file, marker, content) => {
  const target = path.join(ROOT, file);
  const existing = fs.readFileSync(target, 'utf8');
  const start = existing.indexOf(marker);
  const prefix = start >= 0 ? existing.slice(0, start).trimEnd() : existing.trimEnd();
  fs.writeFileSync(target, `${prefix}\n\n${content.trim()}\n`);
};
const readFrontMatter = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  const result = {};
  for (const line of (block?.[1] || '').split('\n')) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    try { result[match[1]] = JSON.parse(value); } catch { result[match[1]] = value.replace(/^"|"$/g, ''); }
  }
  return result;
};
const sourceExists = (source) => {
  try { execFileSync('git', ['cat-file', '-e', `${ENGINEERING_REFERENCE}:${source}`], { cwd: CATALOG, stdio: 'ignore' }); return true; } catch { return false; }
};
const exactSourcePath = (source) => /^(modules|views|platform|tests|services|docs)\/[^\s*]+\.(?:mjs|js|html|json)$/.test(source);
const specFiles = fs.readdirSync(ROOT, { recursive: true }).filter((file) => file.endsWith('.md') && !/^(README|INDEX|COVERAGE|CROSS_PAGE_CONTRADICTIONS|ENGINEERING_HANDOFF|STALE_SPEC_RECONCILIATION)\.md$/.test(path.basename(file)));
const existingById = new Map();
for (const file of specFiles) {
  const fm = readFrontMatter(path.join(ROOT, file));
  if (fm.page_id) existingById.set(fm.page_id, { file, fm });
}

for (const [id, entry] of Object.entries(pages)) {
  const prior = existingById.get(id);
  if (!prior) throw new Error(`Missing existing spec for ${id}`);
  const fm = prior.fm;
  const sources = [entry.module, entry.view, entry.api.split(';')[0].replace(/^GET |^POST /, '').trim(), ...entry.domain.split(';').map((x) => x.trim()).filter((x) => x.includes('/'))];
  const verifiedSources = sources.filter((source) => !source.startsWith('No ') && !source.startsWith('NOT ') && !source.includes('local ') && !source.includes('candidate') && !source.includes('exact page') && sourceExists(source));
  const sourceEvidence = [...new Set([...verifiedSources, ...entry.tests])];
  const actions = entry.actions.map((action) => `- ${action}`).join('\n');
  const gaps = entry.gaps.map(([severity, type, finding, target], index) => `- **${id}-W3-${String(index + 1).padStart(2, '0')}** (${severity}, ${type}) — ${finding} **Required next step:** ${target}`).join('\n');
  const actionRows = entry.actions.map((action) => `- ${action} — permission: declared page gate plus server action authorization; persistence: ${entry.authority}`).join('\n');
  const sourceRows = sourceEvidence.map((source) => `- \`${source}\``).join('\n');
  const pagePath = safe(`./${prior.file}`);
  const text = `---
page_id: ${q(id)}
title_en: ${q(fm.title_en || entry.title || id)}
title_ar: ${q(fm.title_ar || '')}
domain: ${q(fm.domain || 'unknown')}
navigation_group: ${q(fm.navigation_group || 'unknown')}
kind: ${q(entry.kind || fm.kind || 'PAGE')}
canonical_status: ${q(fm.canonical_status || 'PRIMARY')}
canonical_home: ${q(fm.canonical_home || id)}
parent_page: ${q(fm.parent_page ?? null)}
aliases: ${q(fm.aliases || [])}
roles: ${q(fm.roles || ['workshop.user'])}
permission: ${q(fm.permission || 'server action authorization required')}
entitlement: ${q(fm.entitlement || 'none/global')}
renderer_type: "page-specific"
renderer_sources: ${q([entry.module])}
view_sources: ${q([entry.view])}
api_sources: ${q([entry.api])}
domain_sources: ${q(entry.domain.split(';').map((x) => x.trim()))}
tables_or_entities: ${q(entry.tables)}
test_sources: ${q(entry.tests)}
catalog_baseline_sha: ${q(CATALOG_BASELINE)}
last_verified_sha: ${q(ENGINEERING_REFERENCE)}
engineering_reference_sha: ${q(ENGINEERING_REFERENCE)}
deep_review_wave: 3
evidence_confidence: ${q(entry.status === 'CONNECTED' ? 'HIGH' : 'MEDIUM')}
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: ${q(entry.status)}
usability_status: ${q(entry.usability)}
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: \`${id}\`; English: ${fm.title_en || id}; domain: \`${fm.domain || 'unknown'}\`; navigation group: \`${fm.navigation_group || 'unknown'}\`.
- Route: \`switchPage('${id}')\`; page-specific renderer: \`${entry.module}\`; view: \`${entry.view}\`.
- Canonical status: ${fm.canonical_status || 'PRIMARY'}; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

${entry.goal}

# 3. Primary Users

- Declared client gate: ${q(fm.permission || 'server action authorization required')}.
- Business roles: owner/operator/reviewer/approver/manager split is ${entry.status === 'CONNECTED' ? 'partly evidenced by the cited domain boundary but requires direct role-isolation proof.' : 'NOT VERIFIED from the page-specific evidence.'}

# 4. Primary User Goal

USER OPENS THIS PAGE TO: ${entry.goal}

# 5. AS-IS Runtime Surface

- Renderer/view: \`${entry.module}\` and \`${entry.view}\`.
- Query/action boundary: ${entry.api}.
- Current classification: **${entry.status}**; usability: **${entry.usability}**.
- Visible primary actions:
${actions}
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: \`${entry.api}\`.
- Domain authority: \`${entry.domain}\`.
- Persisted entities/tables where source evidence permits: ${entry.tables.map((x) => `\`${x}\``).join(', ')}.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

${actionRows}

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For ${entry.status === 'SIMULATED_BY_DESIGN' ? 'the current local surface, inputs are browser-local and must not be treated as posted business facts.' : 'connected actions, the server must derive scope and validate stale state before persistence.'}

# 9. Outputs

${entry.outputs}

# 10. Workflow Position

- Upstream: ${entry.upstream.join('; ')}.
- Downstream: ${entry.downstream.join('; ')}.
- Workflow classification: ${entry.status === 'CONNECTED' ? 'CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.' : 'PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.'}

# 11. States

- ${entry.states}.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: ${entry.authority}

# 12. Permissions & Scope

- Client navigation gate: ${fm.permission || 'server action authorization required'}.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is ${entry.status === 'CONNECTED' ? 'partly evidenced, not fully proven here.' : 'NOT VERIFIED.'}
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: ${fm.title_en || id}; Arabic label source: ${fm.title_ar || 'NOT VERIFIED'}.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is ${entry.usability === 'STRONG' ? 'partly evidenced' : 'NOT VERIFIED'}.

# 15. AS-IS Functional Assessment

**${entry.status} / ${entry.usability}** — ${entry.evidence}. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

${entry.goal} The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **${entry.authority}**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

${gaps}

# 18. Consolidation Analysis

- Recommended disposition: **${entry.disposition}**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: ${entry.authority}

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: ${entry.goal}

# 20. Test Evidence

- Evidence class: **${entry.evidence}**
- Cited source/tests:
${entry.tests.map((x) => `- \`${x}\``).join('\n')}
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: \`${CATALOG_BASELINE}\`; engineering reference: \`${ENGINEERING_REFERENCE}\`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

${sourceRows}

# 23. Change History

- ${DATE} — Wave 3 deep review from engineering reference \`${ENGINEERING_REFERENCE}\`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- ${entry.authority}

## CAPABILITIES CONSUMED

- ${entry.upstream.concat(entry.downstream).join('; ')}
`;
  fs.writeFileSync(path.join(ROOT, prior.file), text);
}

const allSpecFiles = fs.readdirSync(ROOT, { recursive: true }).filter((file) => file.endsWith('.md') && !/^(README|INDEX|COVERAGE|CROSS_PAGE_CONTRADICTIONS|ENGINEERING_HANDOFF|STALE_SPEC_RECONCILIATION)\.md$/.test(path.basename(file)));
const parsePage = (file) => {
  const fm = readFrontMatter(path.join(ROOT, file));
  const id = fm.page_id;
  const wave = pages[id] ? 3 : fm.deep_review_wave === 2 || fm.catalog_baseline_sha === 'aa730dd23462aab3e90b70ad2db1bf6cc945ca99' ? 2 : null;
  return { pageId: id, title: fm.title_en || id, domain: fm.domain || 'unknown', kind: fm.kind || 'PAGE', canonicalStatus: fm.canonical_status || 'PRIMARY', parent: fm.parent_page ?? null, specPath: `./${safe(file)}`, functionalStatus: fm.functional_status || 'NOT_VERIFIED', usabilityStatus: fm.usability_status || 'THIN', recommendedDisposition: pages[id]?.disposition || 'Retain and reconcile', upstream: pages[id]?.upstream || [], downstream: pages[id]?.downstream || [], aliases: fm.aliases || [], capabilitiesOwned: pages[id] ? [pages[id].authority] : [`${id}:workspace`], capabilitiesConsumed: pages[id] ? pages[id].upstream.concat(pages[id].downstream) : ['Existing catalog evidence'], sourceFiles: pages[id] ? [pages[id].module, pages[id].view, pages[id].api] : [], catalogBaselineSha: fm.catalog_baseline_sha || CATALOG_BASELINE, lastVerifiedSha: fm.last_verified_sha || ENGINEERING_REFERENCE, engineeringReferenceSha: fm.engineering_reference_sha || ENGINEERING_REFERENCE, deepReviewWave: wave, deepReviewStatus: wave ? 'DEEP_REVIEWED' : 'SHALLOW' };
};
const manifestPages = allSpecFiles.map(parsePage).filter((page) => page.pageId).sort((a, b) => a.pageId.localeCompare(b.pageId));
const manifest = { schemaVersion: 3, catalogBaselineSha: CATALOG_BASELINE, lastVerifiedSha: ENGINEERING_REFERENCE, engineeringReferenceSha: ENGINEERING_REFERENCE, generatedAt: new Date().toISOString(), primaryWorkspaceCount: manifestPages.length, embeddedTabs: ['calculator', 'kanban', 'locations', 'workshop_tv'], compatibilityAliases: ['pos_deepening'], pages: manifestPages };
fs.writeFileSync(path.join(ROOT, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const countBy = (items, key) => items.reduce((out, item) => { const value = item[key] || 'UNKNOWN'; out[value] = (out[value] || 0) + 1; return out; }, {});
const domainRows = Object.entries(manifestPages.reduce((out, page) => { const item = out[page.domain] ||= { presence: 0, deep: 0 }; item.presence++; if (page.deepReviewStatus === 'DEEP_REVIEWED') item.deep++; return out; }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([domain, value]) => `| \`${domain}\` | ${value.presence} | ${value.deep} | ${value.presence - value.deep} |`).join('\n');
const indexRows = manifestPages.map((page) => `| \`${page.pageId}\` | ${page.title} | ${page.domain} | ${page.kind} | ${page.canonicalStatus} | SPEC_EXISTS | ${page.deepReviewStatus === 'DEEP_REVIEWED' ? `DEEP_REVIEWED_WAVE_${page.deepReviewWave}` : 'SHALLOW'} | ${page.functionalStatus} | ${page.usabilityStatus} | ${page.recommendedDisposition} | [spec](${page.specPath}) |`).join('\n');
const deepCount = manifestPages.filter((page) => page.deepReviewStatus === 'DEEP_REVIEWED').length;
const wave2Count = manifestPages.filter((page) => page.deepReviewWave === 2).length;
const wave3Count = Object.keys(pages).length;
fs.writeFileSync(path.join(ROOT, 'INDEX.md'), `# Octagon Page Specification Catalog\n\nCatalog baseline: \`${CATALOG_BASELINE}\`\nEngineering reference: \`${ENGINEERING_REFERENCE}\`\nPrimary workspaces: **${manifestPages.length}**\nSpec presence: **${manifestPages.length}/${manifestPages.length}**\nDeep review: **${deepCount}/${manifestPages.length}** (${wave2Count} Wave 2 + ${wave3Count} Wave 3)\n\n## Coverage interpretation\n\nEvery primary destination has a spec. \`SPEC_EXISTS\` means a catalog artifact exists; \`DEEP_REVIEWED_WAVE_2\` and \`DEEP_REVIEWED_WAVE_3\` mean the page has the corresponding forensic deep review; \`SHALLOW\` means the spec remains inventory-level. Functional/usability labels are evidence classifications, not release acceptance.\n\n## Primary pages\n\n| Page ID | Title | Domain | Kind | Canonical status | Spec presence | Deep review | Functional | Usability | Disposition | Spec |\n|---|---|---|---|---|---|---|---|---|---|---|\n${indexRows}\n`);

const wave3Rows = Object.entries(pages).map(([id, entry]) => `| \`${id}\` | ${entry.status} | ${entry.usability} | ${entry.disposition} | ${entry.api} | ${entry.domain} | [spec](./${safe(existingById.get(id).file)}) |`).join('\n');
const classificationCounts = Object.entries(countBy(Object.entries(pages).map(([id, entry]) => ({ id, functional: entry.status })), 'functional')).map(([key, value]) => `\`${key}\` ${value}`).join(', ');
fs.writeFileSync(path.join(ROOT, 'COVERAGE.md'), `# Coverage and Forensic Deep Review — Wave 3\n\n## Evidence boundary\n\n- Wave 3 catalog starting SHA: \`${CATALOG_BASELINE}\` (Wave 2 expected SHA).\n- Moving engineering reference SHA: \`${ENGINEERING_REFERENCE}\`.\n- Primary catalog population: **${manifestPages.length}/${manifestPages.length}** specs present; embedded tabs and compatibility aliases remain outside the primary count.\n- Deep review before Wave 3: **${wave2Count}/${manifestPages.length}** pages.\n- Wave 3 deep review: **${wave3Count}** pages.\n- Total deep review after Wave 3: **${deepCount}/${manifestPages.length}**; shallow remaining: **${manifestPages.length - deepCount}**.\n- Wave 3 functional classifications: ${classificationCounts}.\n\n## Coverage by domain\n\n| Domain | Specs present | Deep reviewed | Shallow remaining |\n|---|---:|---:|---:|\n${domainRows}\n\n## Wave 3 deep-reviewed pages\n\n| Page | AS-IS classification | Usability | Disposition | Query/action boundary | Domain authority | Spec |\n|---|---|---|---|---|---|---|\n${wave3Rows}\n\n## Wave 2 historical record\n\nWave 2 deepened 32 BUILD-09 operational pages. Their specifications and findings remain in this catalog unchanged except for manifest/index deep-review labeling. The Wave 2 source baseline, page list, and contradictions remain preserved in the prior catalog history and in each Wave 2 spec change history. Wave 3 did not redo those pages.\n\n## Interpretation\n\nA page is documented when its manifest entry and spec exist. Deep review means source/API/domain/table/action/workflow evidence was examined at the recorded engineering reference and the 23-section specification was refreshed. \`CONNECTED\` means a page-to-domain edge is evidenced; it does not mean every target behavior, role/isolation path, responsive flow, or browser lifecycle is accepted. \`SIMULATED_BY_DESIGN\`, \`THIN\`, and \`PARTIALLY_CONNECTED\` identify recovery or ownership risk.\n\n## Not covered by this wave\n\n- No source/product/test implementation was changed.\n- No engineering worktree files were written.\n- Build-12 commercial remediation, unrelated intelligence/admin pages, and unresolved owner decisions remain for later waves.\n`);

const contradictions = `\n## Wave 3 findings\n\n| ID | Boundary | Evidence | Required reconciliation | Severity |\n|---|---|---|---|---|\n| C-009 | Workshop readiness delivery authority | \`platform/workshop/readiness-catalog.mjs\` checks \`sales_orders\`, while canonical Sales order persistence and commercial reads use \`sale_orders\`. | Align the readiness check to the canonical authority or document a compatibility view; add a regression test. | P1 |\n| C-010 | Sales Contracts versus canonical contract actions | \`modules/sales-contracts.js\` stores local objects and has no \`/api/v1\` call; \`platform/sales/index.mjs\` registers canonical \`sales:contract:create/activate/suspend/terminate\`. | Retire/migrate the local writer and choose one contract authority. | P0 |\n| C-011 | Contracts versus Sales Contracts navigation | Two primary pages imply contract ownership, but their API/domain/table authority and business distinction are not recovered. | Owner decision required: one canonical contract home, one read view, or an explicit distinct contract taxonomy. | P0 |\n| C-012 | Field Service financial handoff | \`modules/field-service.js\` writes local \`omni.fieldService.visits\` and calls an \`addFinanceTransaction\` bridge; canonical Finance owns documents/journals/source facts. | Route service completion through a canonical service source fact and Finance posting; prove customer/contract/warranty links. | P0 |\n| C-013 | Workshop Ledger financial authority | \`modules/workshop-ledger.js\` imports \`workshop_migration_data.json\` and uses local finance helpers; Finance engine owns GL/journal/hash-chain persistence. | Freeze local financial writes and migrate legacy facts through an idempotent Finance source-document path. | P0 |\n| C-014 | Installments versus AR | \`modules/finance-installments.js\` creates and pays browser-local plans; Finance exposes canonical AR open items, payments, and allocations. | Choose a canonical installment schedule model or retire the local writer; require source invoice and allocation references. | P0 |\n| C-015 | Project task authority versus legacy job/task surfaces | Canonical Projects explicitly delegates task creation to Work Items, while legacy project-management/work-order surfaces expose task/job-like local records. | Mark legacy surfaces as adapters/retired and keep Work Items as the task authority. | P1 |\n| C-016 | Sales-to-workshop handoff | Canonical Sales proves fulfilment and Finance invoice-request edges, but inspected sales lifecycle/order sources do not prove a workshop job/service source link. | Define and test accepted-sale-to-workshop/service creation or label the handoff manual/external. | P1 |\n| C-017 | Workshop-to-procurement handoff | My Work aggregates operational sources and Procurement owns purchase requests/orders, but a direct material-shortage-to-purchase-request link was not verified in this wave. | Define source document/link and prove shortage-to-request-to-receipt flow. | P1 |\n| C-018 | Procurement-to-finance handoff | Procurement exposes bill-request and three-way-match actions and Finance owns AP posting, but page-level bill lifecycle proof is incomplete. | Attach one receipt/match/bill/post flow with idempotency and supplier isolation. | P1 |\n| C-019 | Field Service versus Work Orders | Field Service comments distinguish visits from in-house workshop jobs, but both remain adjacent operational pages with unclear canonical service-job vocabulary. | Publish glossary and ownership map before adding more actions. | P1 |\n\n## Duplicate or consolidation candidates\n\n- **High confidence:** local \`sales_contracts\`, \`workshop_ledger\`, and \`finance_installments\` are migration/retirement candidates because their write surfaces conflict with canonical domains.\n- **Owner decision:** \`contracts\` versus \`sales_contracts\`; \`customers\` versus \`parties\` if Customers is only a finance-filtered party view.\n- **Do not consolidate solely on shared tables:** Sales, Procurement, Projects, WMS, and Finance intentionally share handoff entities while retaining separate lifecycle ownership.\n`;
replaceSection('CROSS_PAGE_CONTRADICTIONS.md', '## Wave 3 findings', contradictions);

const handoff = `\n# Wave 3 — Engineering Handoff\n\n## Reference and scope\n\n- Catalog start SHA: \`${CATALOG_BASELINE}\`.\n- Engineering reference SHA: \`${ENGINEERING_REFERENCE}\`.\n- Deep-reviewed pages: **${wave3Count}**; previous Wave 2 pages preserved.\n- Documentation-only scope: files under \`docs/page-specs/**\` in the catalog worktree.\n\n## Highest-value findings\n\n1. **P0 authority conflicts:** local Sales Contracts, Workshop Ledger, Finance Installments, and Field Service surfaces can imply or perform writes outside canonical Sales/Finance/Service authorities. Freeze or migrate before adding workflow breadth.\n2. **P1 readiness mismatch:** Workshop Readiness checks \`sales_orders\` while canonical Sales uses \`sale_orders\`; this can produce false readiness.\n3. **P1 commercial-to-operations gap:** Sales delivery and Finance invoice-request edges are evidenced, but Sales-to-workshop/service and Workshop-to-Procurement edges are not verified.\n4. **P1 duplicate task/job vocabulary:** canonical Project tasks delegate to Work Items, while legacy project/task/work-order surfaces remain visible.\n5. **P1 procurement closure proof:** canonical requisition → RFQ → order → receipt → match → bill actions exist; one complete browser/API evidence chain with Finance posting is still required.\n\n## Recommended implementation order\n\n- Establish canonical authority decisions for contracts, field service, workshop ledger, installments, and task/job vocabulary.\n- Correct and regression-test the readiness table authority.\n- Prove the three high-value flow chains in \`BUSINESS_FLOW_MAP.md\` before creating more pages.\n- Keep Finance as the sole GL writer and require source-document/idempotency references for every operational handoff.\n`;
replaceSection('ENGINEERING_HANDOFF.md', '# Wave 3 — Engineering Handoff', handoff);

fs.writeFileSync(path.join(ROOT, 'BUSINESS_FLOW_MAP.md'), `# Business Flow Map — Wave 3\n\nEngineering reference: \`${ENGINEERING_REFERENCE}\`  \nCatalog starting SHA: \`${CATALOG_BASELINE}\`\n\nStatus vocabulary: **VERIFIED** = source/API/domain edge is explicit; **PARTIAL** = one side or lifecycle segment is evidenced; **NOT_VERIFIED** = no direct edge in the inspected reference; **MISSING** = required target contract has no identified authoritative edge.\n\n| Flow | Source page/domain | Target page/domain | Status | Evidence / required next proof |\n|---|---|---|---|---|\n| Customer identity → commercial transaction | Parties / \`platform/commercial/parties.mjs\` | Sales / \`platform/sales/orders.mjs\` | VERIFIED | Party roles feed canonical sales queries/actions; prove customer/supplier isolation in browser. |\n| Lead/opportunity → quotation/order | Sales / \`platform/sales/lifecycle.mjs\` | Sales orders / \`platform/sales/orders.mjs\` | VERIFIED | \`crm:*\` and \`sales:quotation:*\` actions create/update \`crm_*\` and \`sale_orders\`; add full direct lifecycle proof. |\n| Accepted sale → delivery | Sales / \`sale_orders\` | Logistics/WMS / \`stock_pickings\`, \`sale_fulfilment_demands\` | VERIFIED | Confirm order creates picking/fulfilment demand and delivery post action; prove warehouse isolation. |\n| Sale → customer invoice/AR | Sales / \`createFiscalInvoiceRequest\` | Finance / \`commercial_fiscal_requests\`, \`finance_documents\` | VERIFIED | Invoice request posts/links Finance source fact; prove idempotency and reversal. |\n| Sale → workshop/service job | Sales | Workshop/Field Service | NOT_VERIFIED | No direct source link was established in inspected Sales lifecycle/order modules; owner must define manual or canonical service handoff. |\n| Workshop readiness → setup | Readiness / \`platform/workshop/readiness.mjs\` | Workshop Pack Setup | PARTIAL | Readiness returns setup targets and route test proves navigation; remediation-to-rerun closure not verified. |\n| Workshop assigned work → canonical execution | My Work / \`platform/workshop/my-work-sources.mjs\` | Work/Picking/Shopfloor/Quality targets | VERIFIED | Explicit source registry maps tables to target pages; prove completion state propagation across one source. |\n| Workshop material shortage → procurement request | Workshop/material sources | Procurement / \`purchase_requests\`, requisitions | NOT_VERIFIED | No direct material-demand source link found in Wave 3 evidence; define source document and request creation contract. |\n| Procurement request → requisition | Procurement / \`platform/procurement/lifecycle.mjs\` | Procurement governance | VERIFIED | Approval converts \`purchase_requests\` to requisitions with source_request_id. |\n| Procurement order → receipt/quality/stock | Procurement | WMS/Inventory/Quality | VERIFIED | Receipt posts canonical stock operation, creates receipt event/quality checks/backorder. |\n| Procurement receipt/match → AP | Procurement | Finance AP | PARTIAL | Bill-request and three-way-match actions exist; complete bill-posting browser evidence is required. |\n| Project task → Work Item | Projects / \`platform/projects/index.mjs\` | Task Manager / canonical Work Items | VERIFIED | Source explicitly delegates project task creation to Work Item authority; retire legacy duplicate task writers. |\n| Project billing → Finance | Projects / \`platform/projects/billing.mjs\` | Finance / \`postSourceFact\` | VERIFIED | Billing approval calls Finance posting dependency; prove source document and reversal. |\n| Field visit → Finance | Field Service / local \`omni.fieldService\` | Finance | MISSING | Current bridge is local and not a verified canonical source fact; define service billing authority. |\n| Workshop Ledger → Finance | Workshop Ledger / local migration data | Finance | MISSING | Local import/pay actions do not prove Finance document/journal persistence or period/company scope. |\n| Installment plan → AR/payment allocation | Finance Installments / local plan | Finance AR | MISSING | No Finance API/action; migrate or retire before treating payment as a receivable fact. |\n| Warranty claim → service/RMA/credit | Warranty / \`platform/sales/warranty.mjs\` | Field Service/RMA/Finance | PARTIAL | Warranty action authority exists; downstream service and financial outcome edges need explicit contracts/tests. |\n`);

fs.writeFileSync(path.join(ROOT, 'CANONICAL_AUTHORITY_MAP.md'), `# Canonical Authority Map — Wave 3\n\nEngineering reference: \`${ENGINEERING_REFERENCE}\`  \nConfidence is bounded by direct source evidence at that SHA.\n\n| Business object / capability | Canonical authority | Primary page(s) | Tables/entities | Evidence | Conflict / unknown |\n|---|---|---|---|---|---|\n| Customer/supplier party identity | \`platform/commercial/parties.mjs\` | Parties; Customers | \`parties\`, \`party_roles\`, addresses | Commercial API and canonical party module/actions | Customers may be a duplicate view; owner decision for write surface. |\n| Quotation/sales order | \`platform/sales/orders.mjs\` and lifecycle | Sales | \`sale_orders\`, lines, fulfilment demands | Sales action registry and persistence source | Readiness uses plural \`sales_orders\` mismatch. |\n| Sales contract | \`platform/sales/contracts.mjs\` intended | Sales Contracts | canonical contract candidate tables | Canonical action registry exists | Current page writes local objects; P0 conflict. |\n| Generic task/work item | canonical Work Items | Task Manager; Projects | \`work_items\`, assignments/comments | Projects source explicitly delegates task creation | Legacy project/task/job surfaces overlap. |\n| Project | \`platform/projects/*\` | Projects | projects, phases, milestones, budgets, billing | Canonical project API/domain | Legacy project-management local fixtures remain visible. |\n| Workshop assigned work aggregation | \`platform/workshop/my-work-sources.mjs\` | My Work | seven explicit source tables | Source registry and scope predicates | Completion/de-duplication across sources needs proof. |\n| Workshop job/work order | NOT RESOLVED | Work Orders; service/workshop pages | \`work_orders\`, shop-floor sessions, possible work items | Page title and adjacent modules only | P1 vocabulary/ownership conflict. |\n| Material requirement | Build-09 material-flow authority candidate | Workshop/production and Procurement | material request/shortage entities | Existing Build-09 evidence and procurement domain | Direct procurement request edge not verified. |\n| Purchase request/requisition | \`platform/procurement/governance.mjs\` and lifecycle | Procurement | purchase requests, requisitions, lines | Approval conversion source | Supplier Portal participant boundary incomplete. |\n| Purchase order/receipt/return | \`platform/procurement/orders.mjs\` and lifecycle | Procurement; Logistics | purchase orders, fulfilment demands, pickings, receipts, returns | Exact lifecycle persistence source | Complete AP posting proof pending. |\n| Stock movement | Inventory/WMS canonical operations | Logistics; Sales; Procurement | stock pickings/moves/locations/reservations | Sales/procurement call canonical stock operations | Logistics page-specific wiring incomplete. |\n| Quality receipt/checkpoint | Quality operational authority | Procurement; Workshop readiness | quality checks/plans/checkpoints | Procurement receipt creates quality checks; readiness consumes catalog | Cross-page browser proof pending. |\n| Delivery | Sales fulfilment + WMS picking | Sales; Logistics; Customer Portal | sale fulfilment demands, stock pickings | Sales order confirmation/delivery source | Workshop/service delivery link unknown. |\n| Project billing | Projects request; Finance posting | Projects; Finance | project billing requests, finance source facts/documents | Billing approve injects \`postSourceFact\` | Customer contract/source origin needs proof. |\n| AR/AP/GL | \`platform/finance/engine.mjs\` | Finance; AR/AP | finance documents/journals/payments/reconciliation | Finance engine and action registry | Legacy finance-like writers conflict. |\n| Field visit/service job | NOT RESOLVED; current local \`omni.fieldService\` | Field Service | local visits and finance bridge | Module source | P0 authority conflict. |\n| Workshop ledger/payroll-like fact | Finance intended; current local migration writer | Workshop Ledger; Finance | migration JSON/local transactions vs finance documents | Module source and Finance engine | P0 authority conflict. |\n| Installment schedule/payment | Finance AR intended; current local plan | Finance Installments; AR/AP | local plans vs finance documents/payments | Module source and Finance actions | P0 authority conflict. |\n| Workshop readiness | Read-only evaluator | Workshop Readiness | readiness catalog authorities | readiness.mjs/catalog | Table-name mismatch for Sales delivery. |\n`);

const missingSources = [];
for (const [id, entry] of Object.entries(pages)) for (const source of [entry.module, entry.view, ...entry.domain.split(';').map((x) => x.trim()).filter((x) => x.includes('/'))]) if (exactSourcePath(source) && !sourceExists(source)) missingSources.push(`${id}: ${source}`);
if (missingSources.length) throw new Error(`Missing engineering source evidence:\n${missingSources.join('\n')}`);
console.log(JSON.stringify({ wave: 3, catalogBaseline: CATALOG_BASELINE, engineeringReference: ENGINEERING_REFERENCE, wave3Pages: wave3Count, manifestPages: manifestPages.length, deepReviewTotal: deepCount, missingSources }, null, 2));
