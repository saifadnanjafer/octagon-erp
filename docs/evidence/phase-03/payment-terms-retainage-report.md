# Payment Terms & Retainage Report — Phase 03 Final Cutover

**Executing Model**: Gemini 3.6 Flash (High)  
**Date**: 2026-07-23  
**Branch**: `remediation/phase-03-final-cutover`  

---

## 1. Retainage Release Workflow

Commercial and construction contracts require holding back a percentage of invoice amounts as retainage until final acceptance.
- **`releaseRetainage` Action**:
  - Registered as `finance_retainage:release` in `platform/finance/index.mjs`.
  - Creates a balancing retainage release document moving retained funds from retainage payable/receivable to active AP/AR balances.
  - Links directly to origin contract/document lineage.

---

## 2. Payment Term Early Discounts

- Payment terms define installment due dates and early payment discount policies (e.g. 2/10 Net 30).
- When a payment is allocated within the discount window:
  - Computed early discount is automatically applied to reduce residual balance.
  - Posts a discount expense/income line in the General Ledger.

---

## 3. Verification Results

- Verified by `tests/phase03/finance-final-cutover.test.mjs`:
  - `Early Discount & Retainage Release Workflow` — **PASSED**.
