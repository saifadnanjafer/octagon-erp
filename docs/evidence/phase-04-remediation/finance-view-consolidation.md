# Finance View Consolidation

Phase 03 remains the only canonical finance engine. This remediation added no second ledger and did not change payroll or attendance calculations.

Target view mapping:

- Expenses/Income -> fiscal-document source worklists;
- Cashbox/POS finance -> Phase 03 cashbox, shifts, payments, and GL;
- Customer/Supplier balances -> AR/AP;
- Workshop Ledger -> workshop-filtered GL;
- Receipt Creation -> fiscal/payment output;
- Installments -> payment schedules;
- Banking -> canonical reconciliation;
- Budgeting -> canonical commitment/spend controls.

Backend POS, sales, procurement, stock, and landed-cost integrations call Phase 03 commands/ports. The legacy page conversion and browser/UI parity were not completed because cutover is blocked.
