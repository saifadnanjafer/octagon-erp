# Phase 04.5 — Current Authority Map

**Executing Model:** Gemini 3.6 Flash (High)  
**Date:** 2026-07-23  

---

## 1. Single Business Authorities

| Business Fact | Single Canonical Authority | Governing Service / Module | Storage Table |
| :--- | :--- | :--- | :--- |
| **Party Identity** | Canonical Party Engine | `platform/commercial/parties.mjs` | `parties`, `party_roles`, `contacts`, `addresses` |
| **Product Master** | Canonical Product Engine | `platform/commercial/products.mjs` | `product_templates`, `product_variants`, `uoms` |
| **Pricing & Discount** | Canonical Pricing Engine | `platform/commercial/pricing.mjs` | `price_lists`, `price_list_items` |
| **Stock Ledger** | Canonical Stock Ledger | `platform/inventory/ledger.mjs` | `stock_moves`, `stock_quants` |
| **Stock Reservations** | Canonical Reservation Ledger | `platform/inventory/ledger.mjs` | `stock_reservations` |
| **Valuation Layers** | Canonical Valuation Engine | `platform/inventory/valuation.mjs` | `stock_valuation_layers` |
| **Sales Lifecycle** | Canonical Sales Engine | `platform/sales/orders.mjs` | `sale_orders`, `sale_order_lines` |
| **Procurement Lifecycle** | Canonical Procurement Engine | `platform/procurement/orders.mjs` | `purchase_orders`, `purchase_order_lines`, `three_way_matches` |
| **POS Transactions** | Canonical POS Engine | `platform/pos/session.mjs` | `pos_sessions`, `pos_orders`, `pos_payments` |
| **Work Items / Tasks** | Canonical Work Item Engine | `platform/work_items/work_items.mjs` | `work_items` |
| **General Ledger** | Canonical Phase 03 Finance Engine | `platform/finance/engine.mjs` | `account_moves`, `account_move_lines`, `fiscal_documents` |
