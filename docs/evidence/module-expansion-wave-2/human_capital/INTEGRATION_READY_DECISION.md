# Integration Ready Decision — Human Capital Development (W2-M6)

## Status
- **Status:** INTEGRATION READY
- **Module ID:** `W2-M6`
- **Domain:** Human Capital Development (Recruitment, Onboarding, Training, Performance, Leave)
- **Date:** 2026-07-30

---

## 1. Executive Summary
The **Human Capital Development** module establishes a governed platform foundation for managing recruitment requisitions (`JOB-2026-XXXX`), applicant tracking (`APP-2026-XXXX`), onboarding checklists, corporate training course enrollments and certifications, performance appraisal cycles (`APR-2026-XXXX`), leave type quotas, and leave request balance management (`LR-2026-XXXX`).

---

## 2. Implemented Components

### Database Schema (Migration 072)
- `database/migrations/072_human_capital_development.mjs`
- 12 Schema Entities:
  1. `job_openings`: Position requisitions (`JOB-2026-XXXX`), headcount targets, employment types, and opening status.
  2. `job_applications`: Applicant submissions (`APP-2026-XXXX`), candidate contacts, resume URLs, and hiring status.
  3. `interview_schedules`: Interview rounds, scheduled times, ratings, and interviewer feedback.
  4. `job_offers`: Employment offer letters, salary details, start dates, and acceptance tracking.
  5. `onboarding_checklists`: Employee onboarding task lists assigned to HR/IT/Safety teams.
  6. `training_courses`: Corporate course catalog, instructors, duration, and pass score thresholds.
  7. `training_enrollments`: Employee course enrollments, progress, scores, pass/fail status, and certificates.
  8. `performance_appraisals`: Periodic appraisal review cycles (`APR-2026-XXXX`), self/manager ratings, and feedback summaries.
  9. `performance_kpis`: Key Performance Indicators, weights, and achieved target scores per appraisal.
  10. `leave_types`: Vacation, Sick, Parental leave types with annual quota definitions.
  11. `leave_requests`: Employee leave requests (`LR-2026-XXXX`), dates, total days, and approval status.
  12. `leave_balances`: Yearly remaining leave days tracking with automatic deductions.

### Domain Service (`platform/domains/human_capital/service.mjs`)
- `createJobOpening`: Job position creation (`JOB-2026-XXXX`).
- `submitApplication`: Applicant submission (`APP-2026-XXXX`).
- `hireCandidate`: Transitioning candidate status to `hired`.
- `createCourse`: Course catalog definition.
- `enrollEmployeeInCourse`: Training enrollment.
- `recordCourseCompletion`: Automated pass/fail grading against course `pass_score`.
- `createLeaveType`: Leave quota configuration.
- `requestLeave`: Leave request initiation (`LR-2026-XXXX`) with quota balance pre-validation.
- `approveLeave`: Leave approval and automatic `leave_balances` remaining days deduction.

### ActionExecutor & Permissions (`platform/domains/human_capital/index.mjs`)
- Registered Actions:
  1. `human_capital:create-job-opening`
  2. `human_capital:submit-application`
  3. `human_capital:hire-candidate`
  4. `human_capital:create-course`
  5. `human_capital:enroll-employee`
  6. `human_capital:record-course-completion`
  7. `human_capital:create-leave-type`
  8. `human_capital:request-leave`
  9. `human_capital:approve-leave`
- Granted Permissions:
  1. `human_capital.manage`
  2. `recruitment.manage`
  3. `training.manage`
  4. `performance.manage`
  5. `leave.request`
  6. `leave.approve`

---

## 3. Verification Evidence
- **Test File:** `tests/module-wave-2/human_capital/human_capital.test.mjs`
- **Result:** 5/5 Passing Tests
  - `✔ 1. Migration 072: Up, rerun, and schema verification`
  - `✔ 2. Recruitment Lifecycle: Job Opening -> Application -> Hired`
  - `✔ 3. Training Lifecycle: Course Creation -> Enrollment -> Pass/Fail Score Recording`
  - `✔ 4. Leave Request Lifecycle & Balance Deduction`
  - `✔ 5. Over-quota Leave Request Rejection`

---

## 4. Architectural & Governance Attestation
- Single Write Authority maintained for recruitment, training, appraisals, and leave approvals.
- Cross-company isolation enforced via `company_id`.
- All database operations migration-backed and fully idempotent.
