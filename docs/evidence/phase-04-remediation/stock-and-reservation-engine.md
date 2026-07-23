# Phase 04.5 — Canonical Stock & Reservation Engine Report

**Executing Model:** Gemini 3.6 Flash (High)  
**Date:** 2026-07-23  

---

## 1. Stock Engine Atomicity & Reservation Ledger

- **Immutable Stock Moves:** `stock_moves` table records all stock transactions in 'done' state.
- **Rebuildable Stock Quants:** `stock_quants` are projections dynamically rebuildable from `stock_moves` history via `rebuildStockQuants`.
- **Reservation Ledger:** `stock_reservations` manages stock allocations with state machine (`reserved`, `partial`, `released`, `consumed`, `expired`).
- **Concurrency & Availability Protection:** `available_quantity = on_hand - reserved`. Attempts to over-reserve or deduct below zero are rejected with machine-readable error codes.
