# Integration Ready Decision — HSE, Safety, Permits, and Incident Management (W2-M12)

## Status
- **Status:** INTEGRATION READY
- **Module ID:** `W2-M12`
- **Domain:** HSE, Safety, Permits, and Incident Management
- **Date:** 2026-07-30

---

## 1. Executive Summary
The **HSE, Safety, Permits, and Incident Management** module establishes a governed platform foundation for workplace incident reporting (`INC-2026-XXXX`), root cause investigation, Corrective & Preventive Action tracking (`CAPA-2026-XXXX`), Safety Permit to Work (PTW) issuance (`PTW-2026-XXXX`), site safety inspection auditing (`INSP-XXXX`), and worker hazard observations.

---

## 2. Implemented Components

### Database Schema (Migration 078)
- `database/migrations/078_hse_and_safety_management.mjs`
- 7 Schema Entities:
  1. `hse_incidents`: Incident reports (`INC-2026-XXXX`), categories (injury, near miss, environmental spill, property damage), severity, location, reporter, and status.
  2. `hse_incident_investigations`: Root cause analyses, immediate containment actions, and investigator assignments.
  3. `hse_corrective_actions`: CAPA action items (`CAPA-2026-XXXX`), target dates, assignees, and verification stamps.
  4. `hse_safety_permits`: Permits to Work (`PTW-2026-XXXX`), permit types (hot work, confined space, working at height, electrical), validity windows, and issuance tracking.
  5. `hse_permit_checklists`: Pre-issuance safety isolation and hazard checklist items.
  6. `hse_safety_inspections`: Site walkthrough inspections (`INSP-XXXX`), passed/failed checklist tallies, and percentage compliance scores.
  7. `hse_hazard_reports`: Unsafe act / unsafe condition hazard observations.

### Domain Service (`platform/domains/hse/service.mjs`)
- `reportIncident`: Incident submission (`INC-2026-XXXX`).
- `investigateIncident`: Root cause investigation logging.
- `createCAPA`: Corrective action creation (`CAPA-2026-XXXX`).
- `requestSafetyPermit`: Permit to Work request (`PTW-2026-XXXX`).
- `issueSafetyPermit`: Permit authorization and issuance (`requested` -> `issued`).
- `recordSafetyInspection`: Safety inspection scoring `(passed_items / total_items) * 100`.

### ActionExecutor & Permissions (`platform/domains/hse/index.mjs`)
- Registered Actions:
  1. `hse:report-incident`
  2. `hse:investigate-incident`
  3. `hse:create-capa`
  4. `hse:request-permit`
  5. `hse:issue-permit`
  6. `hse:record-inspection`
- Granted Permissions:
  1. `hse.manage`
  2. `hse.incident.report`
  3. `hse.incident.investigate`
  4. `hse.permit.issue`
  5. `hse.inspection.record`

---

## 3. Verification Evidence
- **Test File:** `tests/module-wave-2/hse/hse.test.mjs`
- **Result:** 4/4 Passing Tests
  - `✔ 1. Migration 078: Up, rerun, and schema verification`
  - `✔ 2. Incident Reporting, Investigation, and CAPA Creation`
  - `✔ 3. Safety Permit to Work (PTW) Request & Issuance`
  - `✔ 4. Safety Inspection Score Calculation`

---

## 4. Architectural & Governance Attestation
- Single Write Authority maintained for incident reports, CAPAs, PTW permits, and safety inspections.
- Cross-company isolation enforced via `company_id`.
- All database operations migration-backed and fully idempotent.
