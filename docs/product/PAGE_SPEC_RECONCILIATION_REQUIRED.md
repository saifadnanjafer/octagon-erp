# Page Specification Reconciliation Required

This document records engineering changes landed during **Kimi Full Product Checkup & Page Recovery** that require documentation update/reconciliation in `octagon-page-spec-catalog` when the documentation agent resumes.

Reference Engineering SHA: `CURRENT_HEAD` (Post Product Recovery 1 Closure)  
Catalog Reference SHA: `f2fc82c60394ef0755369fd72f1dc68362c2a9a8`

---

## Reconciled Items

### 1. `finance` (Finance Dashboard & Double-Entry Authority)
- **Spec Path**: `docs/page-specs/finance/income.md`, `expenses.md`, `cashbox.md`
- **Engineering Change**: 
  - Fixed client contract bug on page load: resolved `ON CONFLICT` constraint on `organization_memberships` (`ux_membership`) in `platform/server/governance-collections.mjs`.
  - Enforced `Array.isArray(afterCol)` guard in `services/auditService.js` before issuing `/api/collection` POST requests.
- **New Verified Behavior**: `finance` page loads cleanly with 0 network error signatures (`failedRequests: []`) and passes all 7 assertions in `tests/functional-pages/functional-pages.test.mjs`.
- **Recommended Spec Update**: Record `finance` runtime status as `USABLE` (0 failed requests on load) and verify canonical GL posting handoffs.

### 2. `workshop_readiness` (Workshop Order Delivery Authority)
- **Spec Path**: `docs/page-specs/ops/workflow.md` (C-009 boundary)
- **Engineering Change**: Reconciled table reference in `platform/workshop/readiness-catalog.mjs` from legacy `sales_orders` to canonical `sale_orders`.
- **New Verified Behavior**: Workshop readiness checks inspect canonical `sale_orders` table correctly.
- **Recommended Spec Update**: Update C-009 boundary status in `CROSS_PAGE_CONTRADICTIONS.md` to `RESOLVED_IN_CODE`.

### 3. WMS & Operational Fixtures (`dock_checkin`, `dock_schedule`, `expiration_queue`, `wave_execution`, `cycle_count_plans`, `count_session`, `variance_review`)
- **Spec Path**: `docs/page-specs/ops/warehouse_kiosk.md`, `kiosk_device_registry.md`
- **Engineering Change**: Deepened deterministic review fixtures in `scripts/review/fixtures/warehouse.mjs` to populate:
  - Inbound docks (`REV-DOCK-01`)
  - Scheduled and checked-in dock appointments (`rev_wms_dock_appt_in_01`, `rev_wms_dock_appt_out_01`)
  - Staging allocations & candidate cross-dock matches (`rev_wms_crossdock_match_01`)
  - Released pick waves & wave tasks (`rev_wms_wave_01`)
  - Active cycle count plans, sessions, and variance count lines (`rev_wms_count_session_01`).
- **New Verified Behavior**: All 17 review suite tests pass cleanly in `tests/review/*.test.mjs`.
- **Recommended Spec Update**: Transition spec readiness for WMS kiosk and warehouse operations pages to `FIXTURE_VERIFIED`.

### 4. Production & Quality Fixtures (`production_material_requests`, `production_receipt`, `work_orders`, `shopfloor_terminal`, `quality_hold_queue`, `rework_workspace`, `scrap_approval`)
- **Spec Path**: `docs/page-specs/ops/workflow.md`, `employee_kiosk.md`
- **Engineering Change**: Deepened review fixtures in `scripts/review/fixtures/production.mjs` and `quality.mjs` with Al-Warsha main warehouse ID (`rev_wh_alwarsha_main`).
- **New Verified Behavior**: Work orders, material flows, shopfloor sessions, quality checkpoints, rework requests, and scrap approvals align to the active warehouse context.
- **Recommended Spec Update**: Update inventory/quality authority handoffs in `CANONICAL_AUTHORITY_MAP.md` to reflect warehouse-scoped canonical persistence.
