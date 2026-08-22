# Role-Based Review Scenarios — Octagon ERP Review Freeze 2

Generated from the scenario source in `scripts/review/functional-matrix.mjs`.
This document is the reviewer-facing handoff; the generated functional matrix
is the recording surface for actual results, status, screenshots, and findings.

## Review rules

- Use only the disposable identities and fictional `[DEMO]` fixtures created by `npm run review:setup`.
- Record the exact role login, tenant/company, language, viewport, snapshot SHA/tag, and evidence for every step.
- A denied-action step is a server-enforcement check. A successful unauthorized mutation is a P0 security-scope finding.
- Missing BUILD-13 capability is a deferred-scope note, not a bug in this snapshot.
- Keep all rows `NOT REVIEWED` until a human reviewer actually performs the step.

## Scenarios

### Workshop Manager — `review.workshop_manager`

Scenario domain: **WSM**

1. **REV-WSM-001 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: Review the Today/Urgent panel: confirm due-today job rev_wsjob_due_today_01 and breached-SLA job rev_wsjob_overdue_01 both surface with correct priority/SLA badges.
   - Expected: Both jobs appear in the urgent/overdue view; the overdue job shows slaStatus=breached.
   - Severity: **P0**
2. **REV-WSM-002 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: Open blocked job rev_wsjob_blocked_01 ("Blocked Staircase Job (Awaiting Client Decision)").
   - Expected: Detail view shows status=blocked, stage=blocked, assignee=Operations Coordinator, and a visible blocked reason.
   - Severity: **P0**
3. **REV-WSM-003 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: Inspect shortage job rev_wsjob_material_shortage_01 ("Material-Shortage Fence Panel Job").
   - Expected: Job shows status=short, stage=material_shortage, with an indication of the missing material.
   - Severity: **P0**
4. **REV-WSM-004 Â· Quality Hold Queue** (`quality_hold_queue`)
   - Check: Review quality-hold job rev_wsjob_quality_hold_01 ("Quality-Hold Security Door Job"), cross-referencing quality checkpoint rev_qoc_failed / NCR rev_ncr_1.
   - Expected: Job is listed with a quality-hold reason and a traceable link/reference to the quality case.
   - Severity: **P0**
5. **REV-WSM-005 Â· Workshop Readiness** (`workshop_readiness`)
   - Check: Inspect delivery readiness for rev_wsjob_ready_for_delivery_01 ("Ready-for-Delivery Pergola Job") on Workshop Command Center, then cross-check Workshop Readiness.
   - Expected: Job shows progress ~0.95 and status=ready_for_delivery; Workshop Readiness reflects it in a ready/delivery bucket.
   - Severity: **P1**
6. **REV-WSM-006 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: Verify the Approve control is available for design-approval-pending job rev_wsjob_design_approval_01 (workshop manager holds task:approve); if approving, confirm the job leaves waiting_approval.
   - Expected: Approve control is visible and enabled; on submit, job status changes and a server audit entry is recorded.
   - Severity: **P0**
7. **REV-WSM-007 Â· AI Proposal Inbox** (`ai_proposal_inbox`)
   - Check: DENIED-ACTION TEST: attempt to approve AI proposal rev_ai_proposal_awaiting_review (use the button if visible, otherwise replay the approve API call from DevTools Network tab) — workshop manager’s grants (task:write, task:approve, quality:disposition_approve; scripts/review/roles.mjs) do not include ai:proposal_approve.
   - Expected: Server rejects with 403/permission-denied; proposal status is unchanged regardless of its current state. If the mutation succeeds, file a P0 security-scope finding per KNOWN_LIMITATIONS.md.
   - Severity: **P0**

### Operations Coordinator — `review.ops_coordinator`

Scenario domain: **OPS**

1. **REV-OPS-001 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: Confirm the jobs owned by Operations Coordinator are visible and correctly attributed: rev_wsjob_blocked_01, rev_wsjob_material_shortage_01, rev_wsjob_ready_for_delivery_01.
   - Expected: All three jobs show assignee=Operations Coordinator with correct status/stage.
   - Severity: **P0**
2. **REV-OPS-002 Â· Pick Task Queue** (`pick_task_queue`)
   - Check: Confirm pick task rev_wms_pick_task_01 (status=ready) is visible, then confirm the pick using the wms:pick_confirm grant.
   - Expected: Pick confirmation succeeds server-side; task status advances from ready.
   - Severity: **P0**
3. **REV-OPS-003 Â· Dock Schedule** (`dock_schedule`)
   - Check: Using the wms:dock_assign grant, create/assign a dock appointment.
   - Expected: Dock assignment action succeeds and the appointment appears on the schedule.
   - Severity: **P0**
4. **REV-OPS-004 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: Record whether blocked job rev_wsjob_blocked_01 shows any visible linkage to a pick/material dependency, or only an opaque "blocked" state.
   - Expected: Observation only — record whichever is true for the next reviewer under Notes.
   - Severity: **P0**
5. **REV-OPS-005 Â· QC center** (`qc_center`)
   - Check: DENIED-ACTION TEST: attempt to decide/accept open quality checkpoint rev_qoc_open (button if visible, otherwise replay the API call) — coordinator’s grants (task:write, wms:pick_confirm, wms:dock_assign) do not include quality:checkpoint_conditional_accept or quality:disposition_approve.
   - Expected: Server rejects with 403/permission-denied regardless of the checkpoint’s current state. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Warehouse Operator — `review.warehouse_operator`

Scenario domain: **WMS**

1. **REV-WMS-001 Â· Mobile Receiving** (`mobile_receiving`)
   - Check: Open receiving session rev_wms_receiving_session_01 ("REV-PO-1001 Gate Hinge Delivery", status=discrepancy_review) and its line rev_wms_receiving_line_01 (expected 40, received 36).
   - Expected: Session and line render with the expected/received quantity mismatch visible.
   - Severity: **P0**
2. **REV-WMS-002 Â· Receiving Discrepancies** (`receiving_discrepancies`)
   - Check: Open discrepancy rev_wms_receiving_discrepancy_01 (type=under, expected 40 vs actual 36, status=open).
   - Expected: Discrepancy detail shows type=under, the reason text, and an open resolution workflow.
   - Severity: **P0**
3. **REV-WMS-003 Â· Putaway Task Queue** (`putaway_task_queue`)
   - Check: Confirm putaway recommendation rev_wms_putaway_reco_01 (36 units of the gate-hinge lot from Receiving Dock A, status=suggested) and action it.
   - Expected: Putaway recommendation is actionable and, once confirmed, changes status away from suggested.
   - Severity: **P2**
4. **REV-WMS-004 Â· Replenishment Proposals** (`replenishment_proposals`)
   - Check: Review replenishment proposal rev_wms_replenishment_proposal_01 (steel tube, 60 units, status=proposed) generated from rule rev_wms_replenishment_rule_01.
   - Expected: Proposal shows source/destination bins and proposed quantity, and is actionable.
   - Severity: **P2**
5. **REV-WMS-005 Â· Mobile Picking** (`mobile_picking`)
   - Check: Confirm assigned pick task rev_wms_pick_task_01 (ready, no lot, FIFO) using wms:pick_confirm.
   - Expected: Pick confirms successfully; picked_quantity updates.
   - Severity: **P0**
6. **REV-WMS-006 Â· Pick Task Queue** (`pick_task_queue`)
   - Check: Confirm the FEFO lot-tracked pick task rev_wms_pick_task_02 (status=picked, lot rev_lot_gate_hinges_01) is visible with its lot reference.
   - Expected: Task shows strategy=fefo and lot rev_lot_gate_hinges_01 attached.
   - Severity: **P0**
7. **REV-WMS-007 Â· Lot / Serial Traceability** (`lot_serial_traceability`)
   - Check: Trace lot rev_lot_gate_hinges_01 end-to-end: receiving line rev_wms_receiving_line_01 -> trace profile rev_wms_trace_profile_01 -> pick task rev_wms_pick_task_02, and confirm the near-expiration date (~6 days out) is flagged.
   - Expected: Full receipt-to-pick lineage is visible for the lot, and the near-expiration flag is shown.
   - Severity: **P2**
8. **REV-WMS-008 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: DENIED-ACTION TEST: attempt to approve workshop job rev_wsjob_blocked_01 (button if visible, otherwise replay the API call) — warehouse operator’s grants (wms:location_*, wms:dock_*, wms:pick_confirm/acknowledge_post, wms:count_*, wms:crossdock_*) do not include task:approve.
   - Expected: Server rejects with 403/permission-denied; job status unchanged. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Production Operator — `review.production_operator`

Scenario domain: **PRD**

1. **REV-PRD-001 Â· Work Orders** (`work_orders`)
   - Check: Open work order rev_wo_batch1_op10 (in_progress, 8 of 20 started) under production order rev_po_steel_frame_batch1, and rev_wo_batch2_op10 (ready) under rev_po_steel_frame_batch2.
   - Expected: Both work orders render with correct state and quantity_to_produce/quantity_started.
   - Severity: **P0**
2. **REV-PRD-002 Â· Production Material Requests** (`production_material_requests`)
   - Check: Review material requirement rev_matreq_tube_batch1 (80 required, 76 issued, state=issued) and material request rev_mfr_request_tube (approved, 80/80).
   - Expected: Requirement and request both show correct quantities and state.
   - Severity: **P0**
3. **REV-PRD-003 Â· Production Issue / Return** (`production_issue_return`)
   - Check: Review material issue rev_issue_tube_batch1 (76 units) and return rev_return_tube_batch1 (4 units) for work order rev_wo_batch1_op10; acknowledge them.
   - Expected: Issue and return both display with correct quantities and an acknowledgement control.
   - Severity: **P0**
4. **REV-PRD-004 Â· Shop-Floor Terminal** (`shopfloor_terminal`)
   - Check: Open shop-floor session rev_sf_session_batch1 (status=running, 8.0 produced) and confirm the operation is trackable in real time.
   - Expected: Session shows status=running and produced_quantity=8.0.
   - Severity: **P0**
5. **REV-PRD-005 Â· Production Receipt** (`production_receipt`)
   - Check: Review output event rev_sf_event_output_batch1 (operation_output, quantity 8.0) and production receipt rev_mfr_receipt_batch1 (completed, 8.0/8.0).
   - Expected: Output event and receipt both show quantity=8.0 and correct state.
   - Severity: **P0**
6. **REV-PRD-006 Â· QC center** (`qc_center`)
   - Check: DENIED-ACTION TEST: attempt to decide/accept open quality checkpoint rev_qoc_open (button if visible, otherwise replay the API call) — production operator’s grants (task:write, engineering:bom:write, engineering:routing:write, engineering:work_center:write, mrp:plan:write) do not include quality:checkpoint_conditional_accept or quality:disposition_approve.
   - Expected: Server rejects with 403/permission-denied regardless of checkpoint state. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Quality Reviewer — `review.quality_reviewer`

Scenario domain: **QUA**

1. **REV-QUA-001 Â· QC center** (`qc_center`)
   - Check: Review open checkpoint rev_qoc_open (final inspection, pending, no decision yet) tied to inspection rev_qi_open_final.
   - Expected: Checkpoint renders as pending with sample_size=5 and accepted/rejected quantities both 0.
   - Severity: **P0**
2. **REV-QUA-002 Â· Quality Hold Queue** (`quality_hold_queue`)
   - Check: Review failed checkpoint rev_qoc_failed (in_process, status=ncr) tied to failed inspection rev_qi_failed (2 pass / 3 fail) and NCR rev_ncr_1 ("Weld porosity on frame batch 1", severity=major).
   - Expected: Hold queue shows the checkpoint linked to NCR rev_ncr_1 with the correct pass/fail split.
   - Severity: **P0**
3. **REV-QUA-003 Â· QC center** (`qc_center`)
   - Check: Review NCR rev_ncr_1 in full: disposition=rework, root-cause text, state=open, assigned to Quality Reviewer.
   - Expected: NCR detail matches the fixture: major severity, rework disposition, open state.
   - Severity: **P0**
4. **REV-QUA-004 Â· Rework Workspace** (`rework_workspace`)
   - Check: Review rework route rev_qrr_1 (DEMO-REWORK-0001, status=planned) executing disposition rev_qdr_rework (3.0 units, reason=weld_porosity, approved).
   - Expected: Rework route is visible, linked to its originating disposition request and quantity.
   - Severity: **P0**
5. **REV-QUA-005 Â· Scrap Approval** (`scrap_approval`)
   - Check: Review the disposition boundary between rework (rev_qdr_rework, 3.0 units) and scrap (rev_qdr_scrap, 1.0 unit, reason=unrepairable_crack) — confirm the UI clearly distinguishes the two and both show approved state with an approver.
   - Expected: Both dispositions are visible with distinct disposition_type values and approver attribution.
   - Severity: **P0**
6. **REV-QUA-006 Â· Manufacturing MRP II** (`mrp`)
   - Check: DENIED-ACTION TEST: attempt to edit BOM rev_bom_steel_frame (button if visible, otherwise replay the write API call) — quality reviewer’s grants (quality:checkpoint_*, quality:disposition_*, quality:rework_*, quality:scrap_*) do not include engineering:bom:write.
   - Expected: Server rejects with 403/permission-denied; BOM unchanged. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Tenant Administrator — `review.tenant_admin`

Scenario domain: **SAAS**

1. **REV-SAAS-001 Â· Tenant Directory** (`tenant_directory`)
   - Check: Confirm both review tenants are listed: t_octagon_review (primary) and t_octagon_isolation_review (isolation).
   - Expected: Directory shows both tenant ids with lifecycle_state=active.
   - Severity: **P0**
2. **REV-SAAS-002 Â· Tenant Detail** (`tenant_detail`)
   - Check: Open tenant detail for t_octagon_review; confirm deployment_profile=managed_saas, primary_company_id=c_alwarsha_demo.
   - Expected: Tenant detail matches the fixture profile exactly.
   - Severity: **P0**
3. **REV-SAAS-003 Â· Subscriptions** (`subscriptions`)
   - Check: Review all four review-tenant subscriptions: rev_sub_trial (trial), rev_sub_active (active), rev_sub_grace (grace), rev_sub_suspended (suspended).
   - Expected: All four subscriptions render with correct status and period dates.
   - Severity: **P1**
4. **REV-SAAS-004 Â· Entitlements** (`entitlements`)
   - Check: Review entitlement overrides rev_entov_allow (allow capability:ai_marketing_drafts for the review tenant) and rev_entov_deny (deny capability:advanced_people_development for the isolation tenant).
   - Expected: Both overrides display with correct effect and tenant scoping.
   - Severity: **P2**
5. **REV-SAAS-005 Â· Seats and Limits** (`seats_and_limits`)
   - Check: Review seat assignment rev_seat_review (usr_review_workshop_manager, full_user) against the hard usage-counter cap (10 consumed / 10 allowance) for full_user.
   - Expected: Seats and Limits shows the tenant at its hard cap with correct consumed/allowance figures.
   - Severity: **P2**
6. **REV-SAAS-006 Â· Usage and Quotas** (`usage_and_quotas`)
   - Check: Review quota warning rev_quotawarn_api_calls (api_calls approaching_limit at the 4000 threshold) and simulated invoice rev_invoice_demo (labelled SIMULATION / NO EXTERNAL CHARGE / NO GL POSTING).
   - Expected: Quota warning and invoice both render, and the invoice’s simulation label is clearly visible per KNOWN_LIMITATIONS.md.
   - Severity: **P2**
7. **REV-SAAS-007 Â· Vertical Packs** (`vertical_packs`)
   - Check: Review installed extension rev_ext_install_demo (demo:analytics_addon v1.0.0, state=enabled) on Extension Installations, then confirm on Vertical Packs that pack:al_warsha is installationState=enabled for the tenant.
   - Expected: Extension install shows enabled state; Vertical Packs confirms pack:al_warsha is enabled.
   - Severity: **P2**
8. **REV-SAAS-008 Â· AI Policy Registry** (`ai_policy_registry`)
   - Check: DENIED-ACTION TEST: attempt to upsert an AI policy (button if visible, otherwise replay the write API call) — tenant administrator’s grants (saas:*, platform:packs:install/enable) do not include ai:policy_upsert.
   - Expected: Server rejects with 403/permission-denied; no policy is created/changed. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### AI Operator — `review.ai_operator`

Scenario domain: **AIO**

1. **REV-AIO-001 Â· AI Assistant** (`ai_assistant`)
   - Check: Run (or inspect the completed) allowed task backing rev_ai_run_completed_low (task_id=operational_summary, risk=LOW, status=completed) using the ai:task_run grant.
   - Expected: Run completes; output_payload shows autonomous_execution:false.
   - Severity: **P1**
2. **REV-AIO-002 Â· AI Run History** (`ai_run_history`)
   - Check: Confirm blocked run rev_ai_run_blocked_prohibited (task rev_ai_task_prohibited_demo, risk=PROHIBITED, errorCode=AI_TASK_PROHIBITED) is visible and clearly marked as blocked, not completed.
   - Expected: Run history shows status=blocked with error code AI_TASK_PROHIBITED — confirms the governance layer blocks PROHIBITED-risk tasks even for a user who can run LOW/MEDIUM tasks.
   - Severity: **P1**
3. **REV-AIO-003 Â· AI Context Sources** (`ai_context_sources`)
   - Check: Inspect source reference rev_ai_context_source_1 attached to run rev_ai_run_completed_low (source_type=registered, classification=internal, redacted_fields=["password","token"]).
   - Expected: Context source detail is visible with its classification and redacted-fields list, proving provenance is tracked per run.
   - Severity: **P1**
4. **REV-AIO-004 Â· AI Run History** (`ai_run_history`)
   - Check: Record feedback on a completed run using the ai:feedback_record grant.
   - Expected: Feedback submission succeeds server-side.
   - Severity: **P1**
5. **REV-AIO-005 Â· AI Proposal Inbox** (`ai_proposal_inbox`)
   - Check: DENIED-ACTION TEST: attempt to approve AI proposal rev_ai_proposal_awaiting_review (button if visible, otherwise replay the API call) — AI operator’s grants (ai:task_run, ai:feedback_record) do not include ai:proposal_approve.
   - Expected: Server rejects with 403/permission-denied regardless of the proposal’s current state. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### AI Proposal Reviewer — `review.ai_reviewer`

Scenario domain: **AIR**

1. **REV-AIR-001 Â· AI Proposal Inbox** (`ai_proposal_inbox`)
   - Check: Review proposal rev_ai_proposal_awaiting_review (status=review_required, "Draft command-center briefing awaiting human review") backed by run rev_ai_run_backing_awaiting_review.
   - Expected: Proposal renders with status=review_required and no reviewer/decision yet.
   - Severity: **P1**
2. **REV-AIR-002 Â· AI Proposal Inbox** (`ai_proposal_inbox`)
   - Check: Using ai:proposal_approve, review the already-approved proposal rev_ai_proposal_approved (reviewer=ai_reviewer, decision_reason "Approved after human review") and confirm the review trail (rev_ai_review_rev_ai_proposal_approved) is attributed correctly.
   - Expected: Approval decision, reviewer, and reason are all visible and attributed to review.ai_reviewer.
   - Severity: **P1**
3. **REV-AIR-003 Â· AI Proposal Inbox** (`ai_proposal_inbox`)
   - Check: Using ai:proposal_reject, review the rejected proposal rev_ai_proposal_rejected ("Rejected, needs more context before reuse").
   - Expected: Rejection decision and reason render correctly, distinct from the approved proposal’s trail.
   - Severity: **P1**
4. **REV-AIR-004 Â· AI Run History** (`ai_run_history`)
   - Check: Confirm none of the completed runs (rev_ai_run_completed_low, rev_ai_run_backing_approved, rev_ai_run_backing_rejected) show autonomous_execution:true — every mutation traces back to a human-reviewed proposal, not an autonomous AI action.
   - Expected: All inspected runs show autonomous_execution:false; policy_decision.review_required is true for every MEDIUM-risk run.
   - Severity: **P1**
5. **REV-AIR-005 Â· AI Assistant** (`ai_assistant`)
   - Check: DENIED-ACTION TEST: attempt to run a new AI task (button if visible, otherwise replay the run API call) — AI reviewer’s grants (ai:proposal_create/approve/reject/withdraw, ai:policy_upsert) do not include ai:task_run.
   - Expected: Server rejects with 403/permission-denied; no new run is created. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### People Development Manager — `review.people_manager`

Scenario domain: **PDM**

1. **REV-PDM-001 Â· Skills Catalog** (`skills_catalog`)
   - Check: Confirm the three seeded skills are visible: rev_skill_fiber_laser_demo, rev_skill_quality_inspection_demo, rev_skill_customer_comms_demo.
   - Expected: All three skills render with a 0-5 level scale.
   - Severity: **P1**
2. **REV-PDM-002 Â· Competency Profiles** (`competency_profiles`)
   - Check: Review competency profile for usr_review_employee_self_service: fiber-laser level 3, quality-inspection level 2 (both visibility=team).
   - Expected: Both competency levels render correctly against the demo employee.
   - Severity: **P1**
3. **REV-PDM-003 Â· Skill Evidence** (`person_skill_evidence`)
   - Check: Review skill evidence rev_skill_evidence_1 (supervisor_observation, fiber-laser skill) recorded by the People Development Manager using people:evidence_record.
   - Expected: Evidence record shows evidence_type=supervisor_observation and the correct source reference.
   - Severity: **P1**
4. **REV-PDM-004 Â· Development Plans** (`development_plans`)
   - Check: Review development plan rev_development_plan_1 ("Advance to Senior Fiber Laser Operator", status=active, owner=People Development Manager, due in ~90 days); using people:development_transition, verify a status-transition control is available.
   - Expected: Plan renders with correct objective/status/owner; transition control is present and functional.
   - Severity: **P1**
5. **REV-PDM-005 Â· Learning & Certifications** (`learning_and_certifications`)
   - Check: Review expiring certification rev_certification_expiring_1 ("CO2 Laser Safety Certification", expires in ~20 days, inside the 30-day warning window) using people:certification_record.
   - Expected: Certification shows as expiring-soon with the correct expiry date.
   - Severity: **P1**
6. **REV-PDM-006 Â· Learning & Certifications** (`learning_and_certifications`)
   - Check: Review completed learning record rev_learning_record_1 ("Fiber Laser Advanced Techniques", status=completed) using people:learning_record.
   - Expected: Learning record renders with status=completed and its evidence reference.
   - Severity: **P1**
7. **REV-PDM-007 Â· Seats and Limits** (`seats_and_limits`)
   - Check: DENIED-ACTION TEST: attempt to assign a seat (button if visible, otherwise replay the seat-assignment API call) — people development manager’s grants (capability:advanced_people_development, people:skill_create/evidence_record/development_plan_create/development_transition/certification_record/learning_record) do not include saas:seat_assign.
   - Expected: Server rejects with 403/permission-denied; no seat is assigned. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Employee Self-Service — `review.employee_self_service`

Scenario domain: **ESS**

1. **REV-ESS-001 Â· Competency Profiles** (`competency_profiles`)
   - Check: Sign in as usr_review_employee_self_service; confirm own competency profile (fiber-laser level 3, quality-inspection level 2) is visible read-only (scope=own).
   - Expected: Own competencies render; no edit controls for competency levels themselves.
   - Severity: **P1**
2. **REV-ESS-002 Â· Skill Evidence** (`person_skill_evidence`)
   - Check: Record a new piece of own skill evidence using the people:evidence_record grant.
   - Expected: Evidence submission succeeds server-side and appears attributed to the employee.
   - Severity: **P1**
3. **REV-ESS-003 Â· Learning & Certifications** (`learning_and_certifications`)
   - Check: Record completion of a learning activity using the people:learning_record grant; separately confirm certification rev_certification_expiring_1 is visible read-only.
   - Expected: Learning record submission succeeds; certification renders but with no edit/record controls beyond learning.
   - Severity: **P1**
4. **REV-ESS-004 Â· Development Plans** (`development_plans`)
   - Check: Confirm development plan rev_development_plan_1 is visible read-only (owned by the People Development Manager, not by the employee).
   - Expected: Plan renders with no transition/edit controls available to this role.
   - Severity: **P1**
5. **REV-ESS-005 Â· Development Plans** (`development_plans`)
   - Check: DENIED-ACTION TEST: attempt to create a new development plan for self (button if visible, otherwise replay the create API call) — employee self-service’s grants (READ, people:evidence_record, people:learning_record, scope=own) do not include people:development_plan_create.
   - Expected: Server rejects with 403/permission-denied; no plan is created. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Marketing Manager — `review.marketing_manager`

Scenario domain: **MKT**

1. **REV-MKT-001 Â· Campaigns** (`campaigns`)
   - Check: Review draft campaign rev_mkt_campaign_draft ("[DEMO] Spring Promo Campaign", status=draft, budget 5000) and confirm it is editable using marketing:campaign_create.
   - Expected: Draft campaign renders with correct budget/status and editable fields.
   - Severity: **P2**
2. **REV-MKT-002 Â· Campaigns** (`campaigns`)
   - Check: Submit/transition draft campaign rev_mkt_campaign_draft using marketing:campaign_submit; separately review approved campaign rev_mkt_campaign_approved ("[DEMO] Al-Warsha Loyalty Relaunch", budget 8000).
   - Expected: Submit action succeeds server-side; the already-approved campaign renders with status=approved.
   - Severity: **P2**
3. **REV-MKT-003 Â· Marketing Overview** (`marketing_overview`)
   - Check: Confirm both campaigns and the simulation labelling ("SIMULATION ONLY - NO EXTERNAL PUBLISHING") are visible on the overview.
   - Expected: Overview lists both campaigns with the simulation label clearly shown, per KNOWN_LIMITATIONS.md.
   - Severity: **P2**
4. **REV-MKT-004 Â· Attribution Insights** (`attribution_insights`)
   - Check: Review simulated attribution rev_mkt_attribution_simulated (42 leads, 7 conversions, $1500 simulated revenue) using marketing:attribution_simulate.
   - Expected: Attribution renders with correct figures and the "SIMULATION ONLY - CANONICAL SALES DATA UNCHANGED" label.
   - Severity: **P2**
5. **REV-MKT-005 Â· Content Approvals** (`content_approvals`)
   - Check: DENIED-ACTION TEST: attempt to approve content rev_mkt_content_awaiting_review (button if visible, otherwise replay the approve API call) — marketing manager’s grants (marketing:campaign_create/submit, audience_create, attribution_simulate) do not include marketing:content_approve.
   - Expected: Server rejects with 403/permission-denied regardless of the content’s current status. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Content Reviewer — `review.content_reviewer`

Scenario domain: **MKC**

1. **REV-MKC-001 Â· Content Calendar** (`content_calendar`)
   - Check: Review content awaiting review, rev_mkt_content_awaiting_review ("[DEMO] Spring Promo Email Draft", channel=email, status=submitted) using marketing:content_create/submit.
   - Expected: Content renders on the calendar with status=submitted and its simulated-send label.
   - Severity: **P2**
2. **REV-MKC-002 Â· Content Approvals** (`content_approvals`)
   - Check: Approve content rev_mkt_content_awaiting_review using marketing:content_approve; separately review already-approved content rev_mkt_content_approved with its review trail rev_mkt_content_review_approved.
   - Expected: Approval succeeds server-side; the already-approved content shows a review decision=approved with reviewer attribution.
   - Severity: **P2**
3. **REV-MKC-003 Â· Content Calendar** (`content_calendar`)
   - Check: Confirm every content item’s body text carries the "[SIMULATED CONTENT - never sent to any real recipient]" marker.
   - Expected: Simulation marker is visible on every content item, per KNOWN_LIMITATIONS.md.
   - Severity: **P2**
4. **REV-MKC-004 Â· Campaigns** (`campaigns`)
   - Check: DENIED-ACTION TEST: attempt to create a new campaign (button if visible, otherwise replay the create API call) — content reviewer’s grants (marketing:content_create/submit/approve) do not include marketing:campaign_create.
   - Expected: Server rejects with 403/permission-denied; no campaign is created. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Event Manager — `review.event_manager`

Scenario domain: **EVT**

1. **REV-EVT-001 Â· Event Planner** (`event_planner`)
   - Check: Review planned (draft) event rev_evt_planned ("[DEMO] Autumn Product Preview", capacity 50) and published event rev_evt_approved ("[DEMO] Al-Warsha Open House", capacity 100) using events:event_create.
   - Expected: Both events render with correct status/capacity; planner allows creating/editing events.
   - Severity: **P2**
2. **REV-EVT-002 Â· Event Registrations** (`event_registrations`)
   - Check: Review open-registration event rev_evt_open_registration ("[DEMO] Fiber Laser Demo Day", 2 of 40 registered) and near-capacity event rev_evt_near_capacity ("[DEMO] CNC Safety Workshop", 7 of 8 registered) using events:registration_create.
   - Expected: Both events show correct registered/capacity counts; the near-capacity event is visibly flagged as nearly full.
   - Severity: **P2**
3. **REV-EVT-003 Â· Event Registrations** (`event_registrations`)
   - Check: Review waitlisted event rev_evt_waitlist_demo ("[DEMO] Metal Fabrication Masterclass", 5/5 booked plus 1 waitlisted registration).
   - Expected: Waitlisted registration renders with status=waitlisted, distinct from the 5 confirmed registrations.
   - Severity: **P2**
4. **REV-EVT-004 Â· Events Overview** (`events_overview`)
   - Check: Review completed no-show event rev_evt_completed_noshow ("[DEMO] Electrical Basics Info Session", status=completed) and its never-checked-in registration; note per KNOWN_LIMITATIONS.md that "no-show" is modeled as a registered-but-never-checked-in row on a completed event, not a literal status.
   - Expected: Event and registration render; reviewer records the approximation as an observation, not a bug.
   - Severity: **P2**
5. **REV-EVT-005 Â· Event Check-in** (`event_checkin`)
   - Check: DENIED-ACTION TEST: attempt to check in an attendee (button if visible, otherwise replay the check-in API call) — event manager’s grants (events:event_create, session_create, registration_create) do not include events:checkin.
   - Expected: Server rejects with 403/permission-denied regardless of the registration’s current state. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Event Check-In Operator — `review.event_checkin`

Scenario domain: **EVC**

1. **REV-EVC-001 Â· Event Check-in** (`event_checkin`)
   - Check: Review the already checked-in registration on ongoing event rev_evt_checkin_demo ("[DEMO] Welding Certification Session", status=ongoing, 1 attendee checked_in) using events:checkin.
   - Expected: Registration renders with status=checked_in and a checked_in_at timestamp.
   - Severity: **P2**
2. **REV-EVC-002 Â· Event Check-in** (`event_checkin`)
   - Check: Check in one of the two registered attendees on rev_evt_open_registration using events:checkin.
   - Expected: Check-in action succeeds server-side; registration status moves to checked_in.
   - Severity: **P2**
3. **REV-EVC-003 Â· Event Registrations** (`event_registrations`)
   - Check: Register a new attendee against rev_evt_near_capacity (currently 7 of 8 seats) using events:registration_create; confirm the near-capacity warning updates.
   - Expected: New registration succeeds and the event now shows 8 of 8 (fully booked).
   - Severity: **P2**
4. **REV-EVC-004 Â· Event Registrations** (`event_registrations`)
   - Check: Confirm the waitlisted registration on rev_evt_waitlist_demo remains distinguishable from checked-in/registered attendees.
   - Expected: Waitlisted attendee renders with status=waitlisted, not checked_in.
   - Severity: **P2**
5. **REV-EVC-005 Â· Event Planner** (`event_planner`)
   - Check: DENIED-ACTION TEST: attempt to create a new event (button if visible, otherwise replay the create API call) — check-in operator’s grants (events:checkin, events:registration_create) do not include events:event_create.
   - Expected: Server rejects with 403/permission-denied; no event is created. If the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Viewer — `review.viewer`

Scenario domain: **VWR**

1. **REV-VWR-001 Â· Home dashboard** (`home`)
   - Check: Sign in as review.viewer (READ-only grant); confirm Home dashboard renders with no visible write controls.
   - Expected: Page renders read-only; no create/edit/delete buttons are present.
   - Severity: **P0**
2. **REV-VWR-002 Â· My Work** (`my_work`)
   - Check: Confirm My Work lists workshop jobs read-only.
   - Expected: Jobs render but with no edit/status-change controls.
   - Severity: **P0**
3. **REV-VWR-003 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: Confirm Workshop Command Center renders the full job board (including rev_wsjob_quality_hold_01, rev_wsjob_blocked_01) read-only.
   - Expected: All jobs are visible; no write controls are present anywhere on the board.
   - Severity: **P0**
4. **REV-VWR-004 Â· Canonical Inventory** (`canonical_inventory`)
   - Check: Confirm Canonical Inventory renders warehouse stock read-only.
   - Expected: Inventory data is visible; no adjustment/write controls are present.
   - Severity: **P0**
5. **REV-VWR-005 Â· Tenant Directory** (`tenant_directory`)
   - Check: Confirm Tenant Directory renders both review tenants read-only.
   - Expected: Tenant list is visible; no tenant-lifecycle write controls are present.
   - Severity: **P0**
6. **REV-VWR-006 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: DENIED-ACTION TEST: attempt to edit/update workshop job rev_wsjob_new_01 (button if visible, otherwise replay the write API call) — viewer’s only grant is READ.
   - Expected: Server rejects with 403/permission-denied; job is unchanged. This is the baseline case KNOWN_LIMITATIONS.md calls out explicitly for review.viewer — if the mutation succeeds, file a P0 security-scope finding.
   - Severity: **P0**

### Isolation Tenant Viewer — `review.isolation_viewer`

Scenario domain: **ISO**

1. **REV-ISO-001 Â· Home dashboard** (`home`)
   - Check: Sign in as review.isolation_viewer (tenant=t_octagon_isolation_review, company=c_second_demo); confirm Home dashboard loads scoped to the isolation tenant, not the primary review tenant.
   - Expected: Page loads without error, scoped to the isolation tenant/company.
   - Severity: **P0**
2. **REV-ISO-002 Â· Tenant Detail** (`tenant_detail`)
   - Check: Confirm the isolation tenant’s own commercial data is visible: subscription rev_sub_isolation_active (active) and seat rev_seat_isolation.
   - Expected: Isolation tenant’s own subscription/seat data renders correctly — isolation does not mean "sees nothing", just "sees only its own tenant".
   - Severity: **P0**
3. **REV-ISO-003 Â· Tenant Detail** (`tenant_detail`)
   - Check: ISOLATION TEST: attempt to view tenant detail for the primary review tenant t_octagon_review (edit the URL/route parameter, or replay the read API call with tenantId=t_octagon_review).
   - Expected: Server returns not-found/empty/403 — never t_octagon_review’s real rows. If any primary-tenant data leaks through, file a P0 security-scope finding per KNOWN_LIMITATIONS.md and TEAM_HANDOFF.md’s prohibited-use section.
   - Severity: **P0**
4. **REV-ISO-004 Â· Workshop Command Center** (`workshop_command_center`)
   - Check: ISOLATION TEST: attempt to view the primary tenant’s workshop job board (e.g. rev_wsjob_blocked_01, which belongs to t_octagon_review/c_alwarsha_demo).
   - Expected: No primary-tenant workshop jobs are returned; the board is empty or scoped only to the isolation tenant (which seeded no workshop fixtures of its own). If any primary-tenant job appears, file a P0 security-scope finding.
   - Severity: **P0**
5. **REV-ISO-005 Â· Entitlements** (`entitlements`)
   - Check: Confirm entitlement override rev_entov_deny (deny capability:advanced_people_development, scoped to the isolation tenant) is visible, proving isolation-tenant-scoped data IS correctly shown while cross-tenant data is not.
   - Expected: The isolation-scoped deny override renders correctly, confirming scoping works both ways (own data visible, other tenant’s data denied).
   - Severity: **P2**
