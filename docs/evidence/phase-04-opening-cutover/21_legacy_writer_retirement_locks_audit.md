# Legacy Writer Retirement Locks Audit Evidence

## Authority Retirement Governance Locks (`authority_retirement_locks`)

| Lock Key | Canonical Target Domain | Lock Status | Governance Requirement | Audit Verification |
|---|---|---|---|---|
| `INVENTORY_CANONICAL_AUTHORITY_REQUIRED` | `stock_inventory` | `RETIRED` | Legacy inventory stock writers retired; canonical stock quants and stock moves required | **ENFORCED** |
| `RESERVATION_CANONICAL_AUTHORITY_REQUIRED` | `stock_inventory` | `RETIRED` | Legacy reservation writers retired; canonical `stock_reservations` ledger required | **ENFORCED** |
| `VALUATION_CANONICAL_AUTHORITY_REQUIRED` | `stock_inventory` | `RETIRED` | Legacy cost/valuation writers retired; canonical `stock_valuation_facts` and `stock_valuation_layers` required | **ENFORCED** |
| `COMMERCIAL_CANONICAL_AUTHORITY_REQUIRED` | `commercial_cutover` | `RETIRED` | Legacy customer/supplier/pricing writers retired; canonical Action Executor required | **ENFORCED** |
