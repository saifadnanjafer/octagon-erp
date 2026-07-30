# CRM Opportunity Write-Authority Map & Reachability Classification

## 1. Executive Summary

This document establishes the sole, canonical write authority for CRM Lead, Opportunity, Activity, and related domain mutations within Octagon ERP Wave 1.

Prior to Continuation 5, two competing implementations mutated CRM Opportunity tables:
1. `platform/sales/lifecycle.mjs` (Legacy Checkpoint C sales engine)
2. `platform/domains/crm/opportunity-service.mjs` (Wave 1 governed domain service)

Pursuant to the single-write-authority mandate, **`platform/domains/crm/*` services are the sole business authority** for CRM Lead, Opportunity, Pipeline, Stage, Activity, conversion, scoring, Sales integration, and Work Item integration. Legacy action IDs in `platform/sales/` are converted into compatibility adapters that delegate directly into Wave 1 domain services. No competing SQL writers remain.

---

## 2. Competing Writer Inventory and Reachability Map

| Legacy Export / Action ID | Caller / Route | Current Behavior | Replacement Service | Compatibility Requirement | Classification | Retirement Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `crm:lead:create` (`platform/sales/crm.mjs` `createLead`) | ActionExecutor / Legacy API | Direct `INSERT INTO crm_leads` without sequence, score, or audit | `createLead` (`platform/domains/crm/lead-service.mjs`) | Retain action ID `crm:lead:create`, map input payload to canonical Lead service | Compatibility Alias | Direct SQL retired; delegates to Wave 1 Lead Service |
| `crm:lead:update_stage` (`platform/sales/crm.mjs` `updateLeadStage`) | ActionExecutor / Legacy API | Direct `UPDATE crm_leads SET stage` without state machine checks | `qualifyLead`/`disqualifyLead` (`platform/domains/crm/lead-service.mjs`) | Retain action ID `crm:lead:update_stage`, validate stage transition rules | Compatibility Alias | Direct SQL retired; delegates to Wave 1 Lead Service |
| `crm:lead:convert` (`platform/sales/lifecycle.mjs` `convertLead`) | ActionExecutor / Legacy API | Direct `INSERT INTO crm_opportunities` + `crm_leads` update without Party reuse check | `convertLead` (`platform/domains/crm/conversion-service.mjs`) | Retain action ID `crm:lead:convert`, enforce Party reuse & conversion links | Compatibility Alias | Direct SQL retired; delegates to Wave 1 Conversion Service |
| `crm:opportunity:update_stage` (`platform/sales/lifecycle.mjs` `updateOpportunityStage`) | ActionExecutor / Legacy API | Direct `UPDATE crm_opportunities SET stage` without evidence check | `changeStage` (`platform/domains/crm/opportunity-service.mjs`) | Retain action ID `crm:opportunity:update_stage`, enforce stage history & rules | Compatibility Alias | Direct SQL retired; delegates to Wave 1 Opportunity Service |
| `crm:opportunity:add_activity` (`platform/sales/lifecycle.mjs` `addOpportunityActivity`) | ActionExecutor / Legacy API | Direct `INSERT INTO crm_activities` without subject_type check | `scheduleActivity` (`platform/domains/crm/activity-service.mjs`) | Retain action ID `crm:opportunity:add_activity`, enforce subject_type='opportunity' | Compatibility Alias | Direct SQL retired; delegates to Wave 1 Activity Service |
| `crm:opportunity:close` (`platform/sales/lifecycle.mjs` `closeOpportunity`) | ActionExecutor / Legacy API | Direct `UPDATE crm_opportunities SET status` bypassing evidence rules | `markWon` / `markLost` (`platform/domains/crm/opportunity-service.mjs`) | Retain action ID `crm:opportunity:close`, enforce evidence for Won and lost_reason for Lost | Compatibility Alias | Direct SQL retired; delegates to Wave 1 Opportunity Service |
| `getOpportunity` (`platform/sales/lifecycle.mjs`) | Legacy callers / Sales tests | Reads `crm_opportunities` + `crm_opportunity_activities` | `getOpportunity` (`platform/domains/crm/opportunity-service.mjs`) | Return opportunity object with activities populated from read-only view | Canonical Adapter | Direct SQL retired; delegates to Wave 1 Opportunity Service |

---

## 3. Canonical Service Mapping

| Domain Authority | Canonical Service Module | Primary Responsibilities |
| :--- | :--- | :--- |
| **Lead Authority** | `platform/domains/crm/lead-service.mjs` | Governed Lead CRUD, score calculation, duplicate detection, qualification, state machine |
| **Opportunity Authority** | `platform/domains/crm/opportunity-service.mjs` | Governed Opportunity CRUD, stage transitions, Won/Lost evidence rules, weighted revenue calculation |
| **Activity Authority** | `platform/domains/crm/activity-service.mjs` | Governed Activity scheduling, completion, Work Item linkage, subject unification |
| **Conversion Authority** | `platform/domains/crm/conversion-service.mjs` | Governed Lead → Party → Opportunity conversion with deterministic duplicate detection and transaction safety |
| **Scoring Authority** | `platform/domains/crm/scoring-service.mjs` | Deterministic scoring engine with rule evaluation and manual override policy |
| **Sales Linkage Authority** | `platform/domains/crm/sales-integration.mjs` | Linking opportunities with canonical Sales Orders and Quotations |

---

## 4. Verification and Governance Statements

1. **Zero Shadow SQL:** No direct CRM Opportunity/Lead/Activity mutation SQL remains outside `platform/domains/crm/`.
2. **Single Transaction & Idempotency Policy:** All legacy action aliases use the canonical `ActionExecutor` transaction context and `action_idempotency` table.
3. **No Duplicate Audit/Outbox:** Legacy wrapper delegation runs within the single ActionExecutor context so audit logs and outbox events are emitted exactly once per business action.
