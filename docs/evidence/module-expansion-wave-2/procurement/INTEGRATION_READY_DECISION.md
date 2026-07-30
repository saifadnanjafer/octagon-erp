# Integration Ready Decision — Advanced Procurement and Supplier Portal (W2-M5)

## Status
- **Status:** INTEGRATION READY
- **Module ID:** `W2-M5`
- **Domain:** Advanced Procurement and Supplier Portal Management
- **Date:** 2026-07-30

---

## 1. Executive Summary
The **Advanced Procurement and Supplier Portal** module establishes a governed platform foundation for managing internal purchase requisitions (`PR-2026-XXXX`), request for quotations (`RFQ-2026-XXXX`), supplier portal invitations, competitive multi-line supplier bidding (`BID-2026-XXXX`), RFQ evaluation & awarding, framework contracts, non-conformance reports (NCRs), and supplier performance scorecard ratings.

---

## 2. Implemented Components

### Database Schema (Migration 071)
- `database/migrations/071_advanced_procurement_and_supplier_portal.mjs`
- 11 Schema Entities:
  1. `supplier_qualifications`: Onboarding qualification requirements, compliance checks, and expiry dates.
  2. `supplier_evaluations`: Weighted supplier performance ratings (quality, delivery, price competitiveness).
  3. `purchase_requisitions`: Internal purchase demand request headers (`PR-2026-XXXX`) with approval workflow and RFQ conversion tracking.
  4. `purchase_requisition_lines`: Itemized product demand lines.
  5. `rfq_headers`: Request for Quotation headers (`RFQ-2026-XXXX`), submission deadlines, and terms.
  6. `rfq_suppliers`: Supplier invitation list per RFQ.
  7. `supplier_bids`: Multi-line bids submitted by suppliers (`BID-2026-XXXX`), lead times, and validity dates.
  8. `supplier_bid_lines`: Itemized unit prices and specifications matching.
  9. `procurement_contracts`: Framework purchase agreements and ceiling limits.
  10. `supplier_portal_access`: Vendor portal credentials, tokens, and login tracking.
  11. `vendor_non_conformances`: Quality non-conformance reports (NCRs) and corrective action tracking.

### Domain Service (`platform/domains/procurement/service.mjs`)
- `createRequisition`: Requisition creation (`PR-2026-XXXX`).
- `addRequisitionLine`: Line item additions and automated total cost recalculation.
- `approveRequisition`: Department manager approval.
- `createRFQ`: Conversion of approved requisitions into RFQs (`RFQ-2026-XXXX`).
- `inviteSupplierToRFQ`: Inviting qualified suppliers to bid.
- `publishRFQ`: Publishing RFQ for supplier submissions.
- `submitSupplierBid`: Multi-line supplier bid submission (`BID-2026-XXXX`).
- `awardRFQ`: Evaluating and awarding winning bids (winning bid set to `accepted`, competing bids set to `rejected`, RFQ set to `awarded`).
- `evaluateSupplierPerformance`: Weighted scorecard calculation `(Quality*0.4) + (Delivery*0.4) + (Price*0.2)`.

### ActionExecutor & Permissions (`platform/domains/procurement/index.mjs`)
- Registered Actions:
  1. `procurement:create-requisition`
  2. `procurement:add-requisition-line`
  3. `procurement:approve-requisition`
  4. `procurement:create-rfq`
  5. `procurement:invite-supplier`
  6. `procurement:publish-rfq`
  7. `procurement:submit-bid`
  8. `procurement:award-rfq`
  9. `procurement:evaluate-supplier`
- Granted Permissions:
  1. `procurement.manage`
  2. `procurement.requisition`
  3. `procurement.rfq`
  4. `procurement.bid`
  5. `procurement.award`
  6. `supplier.portal`

---

## 3. Verification Evidence
- **Test File:** `tests/module-wave-2/procurement/procurement.test.mjs`
- **Result:** 4/4 Passing Tests
  - `✔ 1. Migration 071: Up, rerun, and schema verification`
  - `✔ 2. Purchase Requisition Lifecycle`
  - `✔ 3. RFQ Creation, Supplier Bidding, and Award Workflow`
  - `✔ 4. Supplier Performance Evaluation Rating`

---

## 4. Architectural & Governance Attestation
- Single Write Authority maintained for procurement requisitions, RFQs, and bid awards.
- Cross-company isolation enforced via `company_id`.
- All database modifications migration-backed and fully idempotent.
