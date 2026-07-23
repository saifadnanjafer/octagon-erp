# Phase 04.5 — Valuation and Landed Cost Report

**Executing Model:** Gemini 3.6 Flash (High)  
**Date:** 2026-07-23  

---

## 1. Valuation & Landed Cost Execution

- **AVCO Valuation:** Append-only moving average valuation layers (`stock_valuation_layers`). Recalculates unit cost on incoming receipts and updates product variant `standard_price`.
- **FIFO Valuation:** Depletes oldest available layers (`remaining_qty > 0`) in chronological order. Preserves unit cost history and exact consumption lineage.
- **Landed Cost Allocation:** `landed_costs` and `landed_cost_lines` allocate shipping, customs, and handling expenses by quantity, volume, or value across stock pickings, adjusting valuation layers append-only.
