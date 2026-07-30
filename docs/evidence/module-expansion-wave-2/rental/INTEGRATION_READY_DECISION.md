# Integration Ready Decision — Rental and Equipment Hire (W2-M3)

## Status
- **Status:** INTEGRATION READY
- **Module ID:** `W2-M3`
- **Domain:** Rental and Equipment Hire Management
- **Date:** 2026-07-30

---

## 1. Executive Summary
The **Rental and Equipment Hire** module establishes a governed platform foundation for managing equipment rentals, rate schedules (daily/weekly/monthly), asset handovers, returns, maintenance holds, extensions, deposits, and double-booking availability protection.

---

## 2. Implemented Components

### Database Schema (Migration 069)
- `database/migrations/069_rental_and_equipment_hire.mjs`
- 14 Schema Entities:
  1. `rental_product_configs`: Rental configuration per product/asset (daily, weekly, monthly rates, deposit, serialization flag).
  2. `rental_rate_rules`: Tiered or seasonal rate rules.
  3. `rental_agreements`: Master rental agreement with customer/party, rental dates, total deposit, and lifecycle state.
  4. `rental_lines`: Itemized product/asset lines on an agreement.
  5. `rental_reservations`: Scheduled reservation windows per agreement line.
  6. `rental_availability_windows`: Aggregated availability status for rental products.
  7. `rental_handovers`: Outbound handover records (dispatch details, meter readings, initial condition).
  8. `rental_returns`: Inbound return records (return details, meter readings, fuel level).
  9. `rental_inspections`: Pre-rental and post-rental quality and safety inspection checklists.
  10. `rental_damage_records`: Damage assessments, repair cost tracking, customer liability.
  11. `rental_deposits`: Security deposit holds, refunds, and deductions.
  12. `rental_extensions`: Period extension requests and fee adjustments.
  13. `rental_late_fees`: Late return penalty calculations.
  14. `rental_maintenance_holds`: Equipment maintenance/servicing blackout windows blocking rental reservations.

### Domain Service (`platform/domains/rental/service.mjs`)
- `configureRentalProduct`: Configure pricing tiers & deposit for rental products/assets.
- `checkAvailability`: Availability guard checking overlapping reservations and maintenance holds to prevent double-booking.
- `createAgreement`: Create rental agreement (`RNT-2026-XXXX`) with automatic availability validation.
- `handoverEquipment`: Outbound handover state update with meter readings.
- `extendAgreement`: Period extension with end-date updates and double-booking checks.
- `returnEquipment`: Inbound return with condition notes and agreement closure (`completed`).
- `createMaintenanceHold`: Blackout period creation for asset maintenance.

### ActionExecutor & Permissions (`platform/domains/rental/index.mjs`)
- Registered Actions:
  1. `rental:configure-product`
  2. `rental:create-agreement`
  3. `rental:handover`
  4. `rental:extend`
  5. `rental:return`
  6. `rental:create-maintenance-hold`
- Granted Permissions:
  1. `rental.manage`
  2. `rental.create`
  3. `rental.read`
  4. `rental.handover`
  5. `rental.return`
  6. `rental.maintenance`

---

## 3. Verification Evidence
- **Test File:** `tests/module-wave-2/rental/rental.test.mjs`
- **Result:** 5/5 Passing Tests
  - `✔ 1. Migration 069: Up, rerun, and schema verification`
  - `✔ 2. Rental Product Configuration and Availability Check`
  - `✔ 3. Double Booking Prevention (Overlapping Reservations Refused)`
  - `✔ 4. Maintenance Hold Block`
  - `✔ 5. Full Lifecycle: Handover, Extension, Return`

---

## 4. Architectural & Governance Attestation
- Single Write Authority maintained for rental operations.
- Cross-company isolation enforced on all queries (`company_id`).
- All DB operations migration-backed and fully idempotent.
