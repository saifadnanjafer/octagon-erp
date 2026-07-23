# Phase 04.5 — Compatibility Adapters Register

**Executing Model:** Gemini 3.6 Flash (High)  
**Date:** 2026-07-23  

---

## 1. Retained Read-Only Compatibility Projections

| Legacy Key | Projection Source | Purpose | Removal Criterion |
| :--- | :--- | :--- | :--- |
| `omni.materials` | `SELECT * FROM product_templates` | Render material view in legacy workshop components | Phase 05 full workshop cutover |
| `customers[]` | `SELECT * FROM parties JOIN party_roles` | Render legacy customer dropdowns | Complete frontend JS refactoring |
| `suppliers[]` | `SELECT * FROM parties JOIN party_roles` | Render legacy supplier dropdowns | Complete frontend JS refactoring |
| `tasks[]` | `SELECT * FROM work_items` | Compatibility layer for legacy task readers | Retain as read-only projection |
