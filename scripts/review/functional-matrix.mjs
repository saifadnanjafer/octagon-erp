// Review Freeze 1 — generates docs/review/FUNCTIONAL_REVIEW_MATRIX.md from the
// scenario data below. This file is the single source of truth for the
// matrix rows; docs/review/ROLE_REVIEW_SCENARIOS.md is hand-written prose
// that mirrors the same roles/pages/fixture ids/steps.
//
// Every `page` id used below is a real pageId from docs/review/PAGE_INVENTORY.json
// (validated against PAGE_META at generation time — the script throws if a
// page id doesn't exist there). Every fixture id referenced in scenario/
// expected text is a real id from scripts/review/fixtures/*.mjs. Every login
// is a real login from scripts/review/roles.mjs.
//
// Run: node scripts/review/functional-matrix.mjs (also wired as
// `npm run review:functional-matrix`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const OUTPUT_PATH = path.join(repoRoot, 'docs', 'review', 'FUNCTIONAL_REVIEW_MATRIX.md');
const ROLE_SCENARIOS_PATH = path.join(repoRoot, 'docs', 'review', 'ROLE_REVIEW_SCENARIOS.md');
const PAGE_INVENTORY_PATH = path.join(repoRoot, 'docs', 'review', 'PAGE_INVENTORY.json');

// pageId -> { domain, priority, labelEn } for every page referenced below,
// values copied verbatim from docs/review/PAGE_INVENTORY.json (moduleDomain /
// reviewPriority / labelEn) so the Domain/Page columns are traceable to the
// real inventory, not invented.
const PAGE_META = {
  home: { domain: 'System', priority: 'P0', labelEn: 'Home dashboard' },
  my_work: { domain: 'Workshop', priority: 'P0', labelEn: 'My Work' },
  workshop_command_center: { domain: 'Workshop', priority: 'P0', labelEn: 'Workshop Command Center' },
  workshop_readiness: { domain: 'Workshop', priority: 'P1', labelEn: 'Workshop Readiness' },
  quality_hold_queue: { domain: 'Workshop', priority: 'P0', labelEn: 'Quality Hold Queue' },
  ai_proposal_inbox: { domain: 'Build12', priority: 'P1', labelEn: 'AI Proposal Inbox' },
  pick_task_queue: { domain: 'Workshop', priority: 'P0', labelEn: 'Pick Task Queue' },
  dock_schedule: { domain: 'Workshop', priority: 'P0', labelEn: 'Dock Schedule' },
  qc_center: { domain: 'Workshop', priority: 'P0', labelEn: 'QC center' },
  scrap_approval: { domain: 'Workshop', priority: 'P0', labelEn: 'Scrap Approval' },
  mobile_receiving: { domain: 'Workshop', priority: 'P0', labelEn: 'Mobile Receiving' },
  receiving_discrepancies: { domain: 'Workshop', priority: 'P0', labelEn: 'Receiving Discrepancies' },
  putaway_task_queue: { domain: 'Workshop', priority: 'P2', labelEn: 'Putaway Task Queue' },
  replenishment_proposals: { domain: 'Workshop', priority: 'P2', labelEn: 'Replenishment Proposals' },
  mobile_picking: { domain: 'Workshop', priority: 'P0', labelEn: 'Mobile Picking' },
  lot_serial_traceability: { domain: 'Workshop', priority: 'P2', labelEn: 'Lot / Serial Traceability' },
  work_orders: { domain: 'Workshop', priority: 'P0', labelEn: 'Work Orders' },
  production_material_requests: { domain: 'Workshop', priority: 'P0', labelEn: 'Production Material Requests' },
  production_issue_return: { domain: 'Workshop', priority: 'P0', labelEn: 'Production Issue / Return' },
  shopfloor_terminal: { domain: 'Workshop', priority: 'P0', labelEn: 'Shop-Floor Terminal' },
  production_receipt: { domain: 'Workshop', priority: 'P0', labelEn: 'Production Receipt' },
  rework_workspace: { domain: 'Workshop', priority: 'P0', labelEn: 'Rework Workspace' },
  recall_analysis: { domain: 'Workshop', priority: 'P0', labelEn: 'Recall Analysis' },
  tenant_detail: { domain: 'Commercial', priority: 'P0', labelEn: 'Tenant Detail' },
  subscriptions: { domain: 'Commercial', priority: 'P1', labelEn: 'Subscriptions' },
  entitlements: { domain: 'Commercial', priority: 'P2', labelEn: 'Entitlements' },
  seats_and_limits: { domain: 'Commercial', priority: 'P2', labelEn: 'Seats and Limits' },
  usage_and_quotas: { domain: 'Commercial', priority: 'P2', labelEn: 'Usage and Quotas' },
  extension_installations: { domain: 'Commercial', priority: 'P2', labelEn: 'Extension Installations' },
  vertical_packs: { domain: 'Build12', priority: 'P2', labelEn: 'Vertical Packs' },
  ai_assistant: { domain: 'Build12', priority: 'P1', labelEn: 'AI Assistant' },
  ai_context_sources: { domain: 'Build12', priority: 'P1', labelEn: 'AI Context Sources' },
  ai_run_history: { domain: 'Build12', priority: 'P1', labelEn: 'AI Run History' },
  ai_policy_registry: { domain: 'Build12', priority: 'P3', labelEn: 'AI Policy Registry' },
  people_development_overview: { domain: 'Build12', priority: 'P1', labelEn: 'People Development' },
  skills_catalog: { domain: 'Build12', priority: 'P1', labelEn: 'Skills Catalog' },
  competency_profiles: { domain: 'Build12', priority: 'P1', labelEn: 'Competency Profiles' },
  person_skill_evidence: { domain: 'Build12', priority: 'P1', labelEn: 'Skill Evidence' },
  development_plans: { domain: 'Build12', priority: 'P1', labelEn: 'Development Plans' },
  learning_and_certifications: { domain: 'Build12', priority: 'P1', labelEn: 'Learning & Certifications' },
  marketing_overview: { domain: 'Build12', priority: 'P2', labelEn: 'Marketing Overview' },
  campaigns: { domain: 'Build12', priority: 'P2', labelEn: 'Campaigns' },
  content_calendar: { domain: 'Build12', priority: 'P2', labelEn: 'Content Calendar' },
  content_approvals: { domain: 'Build12', priority: 'P2', labelEn: 'Content Approvals' },
  attribution_insights: { domain: 'Build12', priority: 'P2', labelEn: 'Attribution Insights' },
  events_overview: { domain: 'Build12', priority: 'P2', labelEn: 'Events Overview' },
  event_planner: { domain: 'Build12', priority: 'P2', labelEn: 'Event Planner' },
  event_registrations: { domain: 'Build12', priority: 'P2', labelEn: 'Event Registrations' },
  event_checkin: { domain: 'Build12', priority: 'P2', labelEn: 'Event Check-in' },
  canonical_inventory: { domain: 'Workshop', priority: 'P0', labelEn: 'Canonical Inventory' },
  tenant_directory: { domain: 'Commercial', priority: 'P0', labelEn: 'Tenant Directory' },
  mrp: { domain: 'Workshop', priority: 'P0', labelEn: 'Manufacturing MRP II' },
};

// One entry per role scenario in docs/review/ROLE_REVIEW_SCENARIOS.md.
// `steps` is one row per numbered step / logical checkpoint in that scenario.
// Denied-action (server-enforcement boundary) steps always carry severity
// 'P0' regardless of the page's nominal reviewPriority, per
// docs/review/KNOWN_LIMITATIONS.md ("treat any case where [the server does
// not independently re-check] as a P0 security-scope finding").
const SCENARIOS = [
  {
    domainSlug: 'WSM', roleName: 'Workshop Manager', login: 'review.workshop_manager',
    steps: [
      { page: 'workshop_command_center', scenario: 'Review the Today/Urgent panel: confirm due-today job rev_wsjob_due_today_01 and breached-SLA job rev_wsjob_overdue_01 both surface with correct priority/SLA badges.', expected: 'Both jobs appear in the urgent/overdue view; the overdue job shows slaStatus=breached.' },
      { page: 'workshop_command_center', scenario: 'Open blocked job rev_wsjob_blocked_01 ("Blocked Staircase Job (Awaiting Client Decision)").', expected: 'Detail view shows status=blocked, stage=blocked, assignee=Operations Coordinator, and a visible blocked reason.' },
      { page: 'workshop_command_center', scenario: 'Inspect shortage job rev_wsjob_material_shortage_01 ("Material-Shortage Fence Panel Job").', expected: 'Job shows status=short, stage=material_shortage, with an indication of the missing material.' },
      { page: 'quality_hold_queue', scenario: 'Review quality-hold job rev_wsjob_quality_hold_01 ("Quality-Hold Security Door Job"), cross-referencing quality checkpoint rev_qoc_failed / NCR rev_ncr_1.', expected: 'Job is listed with a quality-hold reason and a traceable link/reference to the quality case.' },
      { page: 'workshop_readiness', scenario: 'Inspect delivery readiness for rev_wsjob_ready_for_delivery_01 ("Ready-for-Delivery Pergola Job") on Workshop Command Center, then cross-check Workshop Readiness.', expected: 'Job shows progress ~0.95 and status=ready_for_delivery; Workshop Readiness reflects it in a ready/delivery bucket.' },
      { page: 'workshop_command_center', scenario: 'Verify the Approve control is available for design-approval-pending job rev_wsjob_design_approval_01 (workshop manager holds task:approve); if approving, confirm the job leaves waiting_approval.', expected: 'Approve control is visible and enabled; on submit, job status changes and a server audit entry is recorded.' },
      { page: 'ai_proposal_inbox', scenario: 'DENIED-ACTION TEST: attempt to approve AI proposal rev_ai_proposal_awaiting_review (use the button if visible, otherwise replay the approve API call from DevTools Network tab) — workshop manager’s grants (task:write, task:approve, quality:disposition_approve; scripts/review/roles.mjs) do not include ai:proposal_approve.', expected: 'Server rejects with 403/permission-denied; proposal status is unchanged regardless of its current state. If the mutation succeeds, file a P0 security-scope finding per KNOWN_LIMITATIONS.md.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'OPS', roleName: 'Operations Coordinator', login: 'review.ops_coordinator',
    steps: [
      { page: 'workshop_command_center', scenario: 'Confirm the jobs owned by Operations Coordinator are visible and correctly attributed: rev_wsjob_blocked_01, rev_wsjob_material_shortage_01, rev_wsjob_ready_for_delivery_01.', expected: 'All three jobs show assignee=Operations Coordinator with correct status/stage.' },
      { page: 'pick_task_queue', scenario: 'Confirm pick task rev_wms_pick_task_01 (status=ready) is visible, then confirm the pick using the wms:pick_confirm grant.', expected: 'Pick confirmation succeeds server-side; task status advances from ready.' },
      { page: 'dock_schedule', scenario: 'Using the wms:dock_assign grant, create/assign a dock appointment.', expected: 'Dock assignment action succeeds and the appointment appears on the schedule.' },
      { page: 'workshop_command_center', scenario: 'Record whether blocked job rev_wsjob_blocked_01 shows any visible linkage to a pick/material dependency, or only an opaque "blocked" state.', expected: 'Observation only — record whichever is true for the next reviewer under Notes.' },
      { page: 'qc_center', scenario: 'DENIED-ACTION TEST: attempt to decide/accept open quality checkpoint rev_qoc_open (button if visible, otherwise replay the API call) — coordinator’s grants (task:write, wms:pick_confirm, wms:dock_assign) do not include quality:checkpoint_conditional_accept or quality:disposition_approve.', expected: 'Server rejects with 403/permission-denied regardless of the checkpoint’s current state. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'WMS', roleName: 'Warehouse Operator', login: 'review.warehouse_operator',
    steps: [
      { page: 'mobile_receiving', scenario: 'Open receiving session rev_wms_receiving_session_01 ("REV-PO-1001 Gate Hinge Delivery", status=discrepancy_review) and its line rev_wms_receiving_line_01 (expected 40, received 36).', expected: 'Session and line render with the expected/received quantity mismatch visible.' },
      { page: 'receiving_discrepancies', scenario: 'Open discrepancy rev_wms_receiving_discrepancy_01 (type=under, expected 40 vs actual 36, status=open).', expected: 'Discrepancy detail shows type=under, the reason text, and an open resolution workflow.' },
      { page: 'putaway_task_queue', scenario: 'Confirm putaway recommendation rev_wms_putaway_reco_01 (36 units of the gate-hinge lot from Receiving Dock A, status=suggested) and action it.', expected: 'Putaway recommendation is actionable and, once confirmed, changes status away from suggested.' },
      { page: 'replenishment_proposals', scenario: 'Review replenishment proposal rev_wms_replenishment_proposal_01 (steel tube, 60 units, status=proposed) generated from rule rev_wms_replenishment_rule_01.', expected: 'Proposal shows source/destination bins and proposed quantity, and is actionable.' },
      { page: 'mobile_picking', scenario: 'Confirm assigned pick task rev_wms_pick_task_01 (ready, no lot, FIFO) using wms:pick_confirm.', expected: 'Pick confirms successfully; picked_quantity updates.' },
      { page: 'pick_task_queue', scenario: 'Confirm the FEFO lot-tracked pick task rev_wms_pick_task_02 (status=picked, lot rev_lot_gate_hinges_01) is visible with its lot reference.', expected: 'Task shows strategy=fefo and lot rev_lot_gate_hinges_01 attached.' },
      { page: 'lot_serial_traceability', scenario: 'Trace lot rev_lot_gate_hinges_01 end-to-end: receiving line rev_wms_receiving_line_01 -> trace profile rev_wms_trace_profile_01 -> pick task rev_wms_pick_task_02, and confirm the near-expiration date (~6 days out) is flagged.', expected: 'Full receipt-to-pick lineage is visible for the lot, and the near-expiration flag is shown.' },
      { page: 'workshop_command_center', scenario: 'DENIED-ACTION TEST: attempt to approve workshop job rev_wsjob_blocked_01 (button if visible, otherwise replay the API call) — warehouse operator’s grants (wms:location_*, wms:dock_*, wms:pick_confirm/acknowledge_post, wms:count_*, wms:crossdock_*) do not include task:approve.', expected: 'Server rejects with 403/permission-denied; job status unchanged. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'PRD', roleName: 'Production Operator', login: 'review.production_operator',
    steps: [
      { page: 'work_orders', scenario: 'Open work order rev_wo_batch1_op10 (in_progress, 8 of 20 started) under production order rev_po_steel_frame_batch1, and rev_wo_batch2_op10 (ready) under rev_po_steel_frame_batch2.', expected: 'Both work orders render with correct state and quantity_to_produce/quantity_started.' },
      { page: 'production_material_requests', scenario: 'Review material requirement rev_matreq_tube_batch1 (80 required, 76 issued, state=issued) and material request rev_mfr_request_tube (approved, 80/80).', expected: 'Requirement and request both show correct quantities and state.' },
      { page: 'production_issue_return', scenario: 'Review material issue rev_issue_tube_batch1 (76 units) and return rev_return_tube_batch1 (4 units) for work order rev_wo_batch1_op10; acknowledge them.', expected: 'Issue and return both display with correct quantities and an acknowledgement control.' },
      { page: 'shopfloor_terminal', scenario: 'Open shop-floor session rev_sf_session_batch1 (status=running, 8.0 produced) and confirm the operation is trackable in real time.', expected: 'Session shows status=running and produced_quantity=8.0.' },
      { page: 'production_receipt', scenario: 'Review output event rev_sf_event_output_batch1 (operation_output, quantity 8.0) and production receipt rev_mfr_receipt_batch1 (completed, 8.0/8.0).', expected: 'Output event and receipt both show quantity=8.0 and correct state.' },
      { page: 'qc_center', scenario: 'DENIED-ACTION TEST: attempt to decide/accept open quality checkpoint rev_qoc_open (button if visible, otherwise replay the API call) — production operator’s grants (task:write, engineering:bom:write, engineering:routing:write, engineering:work_center:write, mrp:plan:write) do not include quality:checkpoint_conditional_accept or quality:disposition_approve.', expected: 'Server rejects with 403/permission-denied regardless of checkpoint state. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'QUA', roleName: 'Quality Reviewer', login: 'review.quality_reviewer',
    steps: [
      { page: 'qc_center', scenario: 'Review open checkpoint rev_qoc_open (final inspection, pending, no decision yet) tied to inspection rev_qi_open_final.', expected: 'Checkpoint renders as pending with sample_size=5 and accepted/rejected quantities both 0.' },
      { page: 'quality_hold_queue', scenario: 'Review failed checkpoint rev_qoc_failed (in_process, status=ncr) tied to failed inspection rev_qi_failed (2 pass / 3 fail) and NCR rev_ncr_1 ("Weld porosity on frame batch 1", severity=major).', expected: 'Hold queue shows the checkpoint linked to NCR rev_ncr_1 with the correct pass/fail split.' },
      { page: 'qc_center', scenario: 'Review NCR rev_ncr_1 in full: disposition=rework, root-cause text, state=open, assigned to Quality Reviewer.', expected: 'NCR detail matches the fixture: major severity, rework disposition, open state.' },
      { page: 'rework_workspace', scenario: 'Review rework route rev_qrr_1 (DEMO-REWORK-0001, status=planned) executing disposition rev_qdr_rework (3.0 units, reason=weld_porosity, approved).', expected: 'Rework route is visible, linked to its originating disposition request and quantity.' },
      { page: 'scrap_approval', scenario: 'Review the disposition boundary between rework (rev_qdr_rework, 3.0 units) and scrap (rev_qdr_scrap, 1.0 unit, reason=unrepairable_crack) — confirm the UI clearly distinguishes the two and both show approved state with an approver.', expected: 'Both dispositions are visible with distinct disposition_type values and approver attribution.' },
      { page: 'mrp', scenario: 'DENIED-ACTION TEST: attempt to edit BOM rev_bom_steel_frame (button if visible, otherwise replay the write API call) — quality reviewer’s grants (quality:checkpoint_*, quality:disposition_*, quality:rework_*, quality:scrap_*) do not include engineering:bom:write.', expected: 'Server rejects with 403/permission-denied; BOM unchanged. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'SAAS', roleName: 'Tenant Administrator', login: 'review.tenant_admin',
    steps: [
      { page: 'tenant_directory', scenario: 'Confirm both review tenants are listed: t_octagon_review (primary) and t_octagon_isolation_review (isolation).', expected: 'Directory shows both tenant ids with lifecycle_state=active.' },
      { page: 'tenant_detail', scenario: 'Open tenant detail for t_octagon_review; confirm deployment_profile=managed_saas, primary_company_id=c_alwarsha_demo.', expected: 'Tenant detail matches the fixture profile exactly.' },
      { page: 'subscriptions', scenario: 'Review all four review-tenant subscriptions: rev_sub_trial (trial), rev_sub_active (active), rev_sub_grace (grace), rev_sub_suspended (suspended).', expected: 'All four subscriptions render with correct status and period dates.' },
      { page: 'entitlements', scenario: 'Review entitlement overrides rev_entov_allow (allow capability:ai_marketing_drafts for the review tenant) and rev_entov_deny (deny capability:advanced_people_development for the isolation tenant).', expected: 'Both overrides display with correct effect and tenant scoping.' },
      { page: 'seats_and_limits', scenario: 'Review seat assignment rev_seat_review (usr_review_workshop_manager, full_user) against the hard usage-counter cap (10 consumed / 10 allowance) for full_user.', expected: 'Seats and Limits shows the tenant at its hard cap with correct consumed/allowance figures.' },
      { page: 'usage_and_quotas', scenario: 'Review quota warning rev_quotawarn_api_calls (api_calls approaching_limit at the 4000 threshold) and simulated invoice rev_invoice_demo (labelled SIMULATION / NO EXTERNAL CHARGE / NO GL POSTING).', expected: 'Quota warning and invoice both render, and the invoice’s simulation label is clearly visible per KNOWN_LIMITATIONS.md.' },
      { page: 'vertical_packs', scenario: 'Review installed extension rev_ext_install_demo (demo:analytics_addon v1.0.0, state=enabled) on Extension Installations, then confirm on Vertical Packs that pack:al_warsha is installationState=enabled for the tenant.', expected: 'Extension install shows enabled state; Vertical Packs confirms pack:al_warsha is enabled.' },
      { page: 'ai_policy_registry', scenario: 'DENIED-ACTION TEST: attempt to upsert an AI policy (button if visible, otherwise replay the write API call) — tenant administrator’s grants (saas:*, platform:packs:install/enable) do not include ai:policy_upsert.', expected: 'Server rejects with 403/permission-denied; no policy is created/changed. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'AIO', roleName: 'AI Operator', login: 'review.ai_operator',
    steps: [
      { page: 'ai_assistant', scenario: 'Run (or inspect the completed) allowed task backing rev_ai_run_completed_low (task_id=operational_summary, risk=LOW, status=completed) using the ai:task_run grant.', expected: 'Run completes; output_payload shows autonomous_execution:false.' },
      { page: 'ai_run_history', scenario: 'Confirm blocked run rev_ai_run_blocked_prohibited (task rev_ai_task_prohibited_demo, risk=PROHIBITED, errorCode=AI_TASK_PROHIBITED) is visible and clearly marked as blocked, not completed.', expected: 'Run history shows status=blocked with error code AI_TASK_PROHIBITED — confirms the governance layer blocks PROHIBITED-risk tasks even for a user who can run LOW/MEDIUM tasks.' },
      { page: 'ai_context_sources', scenario: 'Inspect source reference rev_ai_context_source_1 attached to run rev_ai_run_completed_low (source_type=registered, classification=internal, redacted_fields=["password","token"]).', expected: 'Context source detail is visible with its classification and redacted-fields list, proving provenance is tracked per run.' },
      { page: 'ai_run_history', scenario: 'Record feedback on a completed run using the ai:feedback_record grant.', expected: 'Feedback submission succeeds server-side.' },
      { page: 'ai_proposal_inbox', scenario: 'DENIED-ACTION TEST: attempt to approve AI proposal rev_ai_proposal_awaiting_review (button if visible, otherwise replay the API call) — AI operator’s grants (ai:task_run, ai:feedback_record) do not include ai:proposal_approve.', expected: 'Server rejects with 403/permission-denied regardless of the proposal’s current state. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'AIR', roleName: 'AI Proposal Reviewer', login: 'review.ai_reviewer',
    steps: [
      { page: 'ai_proposal_inbox', scenario: 'Review proposal rev_ai_proposal_awaiting_review (status=review_required, "Draft command-center briefing awaiting human review") backed by run rev_ai_run_backing_awaiting_review.', expected: 'Proposal renders with status=review_required and no reviewer/decision yet.' },
      { page: 'ai_proposal_inbox', scenario: 'Using ai:proposal_approve, review the already-approved proposal rev_ai_proposal_approved (reviewer=ai_reviewer, decision_reason "Approved after human review") and confirm the review trail (rev_ai_review_rev_ai_proposal_approved) is attributed correctly.', expected: 'Approval decision, reviewer, and reason are all visible and attributed to review.ai_reviewer.' },
      { page: 'ai_proposal_inbox', scenario: 'Using ai:proposal_reject, review the rejected proposal rev_ai_proposal_rejected ("Rejected, needs more context before reuse").', expected: 'Rejection decision and reason render correctly, distinct from the approved proposal’s trail.' },
      { page: 'ai_run_history', scenario: 'Confirm none of the completed runs (rev_ai_run_completed_low, rev_ai_run_backing_approved, rev_ai_run_backing_rejected) show autonomous_execution:true — every mutation traces back to a human-reviewed proposal, not an autonomous AI action.', expected: 'All inspected runs show autonomous_execution:false; policy_decision.review_required is true for every MEDIUM-risk run.' },
      { page: 'ai_assistant', scenario: 'DENIED-ACTION TEST: attempt to run a new AI task (button if visible, otherwise replay the run API call) — AI reviewer’s grants (ai:proposal_create/approve/reject/withdraw, ai:policy_upsert) do not include ai:task_run.', expected: 'Server rejects with 403/permission-denied; no new run is created. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'PDM', roleName: 'People Development Manager', login: 'review.people_manager',
    steps: [
      { page: 'skills_catalog', scenario: 'Confirm the three seeded skills are visible: rev_skill_fiber_laser_demo, rev_skill_quality_inspection_demo, rev_skill_customer_comms_demo.', expected: 'All three skills render with a 0-5 level scale.' },
      { page: 'competency_profiles', scenario: 'Review competency profile for usr_review_employee_self_service: fiber-laser level 3, quality-inspection level 2 (both visibility=team).', expected: 'Both competency levels render correctly against the demo employee.' },
      { page: 'person_skill_evidence', scenario: 'Review skill evidence rev_skill_evidence_1 (supervisor_observation, fiber-laser skill) recorded by the People Development Manager using people:evidence_record.', expected: 'Evidence record shows evidence_type=supervisor_observation and the correct source reference.' },
      { page: 'development_plans', scenario: 'Review development plan rev_development_plan_1 ("Advance to Senior Fiber Laser Operator", status=active, owner=People Development Manager, due in ~90 days); using people:development_transition, verify a status-transition control is available.', expected: 'Plan renders with correct objective/status/owner; transition control is present and functional.' },
      { page: 'learning_and_certifications', scenario: 'Review expiring certification rev_certification_expiring_1 ("CO2 Laser Safety Certification", expires in ~20 days, inside the 30-day warning window) using people:certification_record.', expected: 'Certification shows as expiring-soon with the correct expiry date.' },
      { page: 'learning_and_certifications', scenario: 'Review completed learning record rev_learning_record_1 ("Fiber Laser Advanced Techniques", status=completed) using people:learning_record.', expected: 'Learning record renders with status=completed and its evidence reference.' },
      { page: 'seats_and_limits', scenario: 'DENIED-ACTION TEST: attempt to assign a seat (button if visible, otherwise replay the seat-assignment API call) — people development manager’s grants (capability:advanced_people_development, people:skill_create/evidence_record/development_plan_create/development_transition/certification_record/learning_record) do not include saas:seat_assign.', expected: 'Server rejects with 403/permission-denied; no seat is assigned. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'ESS', roleName: 'Employee Self-Service', login: 'review.employee_self_service',
    steps: [
      { page: 'competency_profiles', scenario: 'Sign in as usr_review_employee_self_service; confirm own competency profile (fiber-laser level 3, quality-inspection level 2) is visible read-only (scope=own).', expected: 'Own competencies render; no edit controls for competency levels themselves.' },
      { page: 'person_skill_evidence', scenario: 'Record a new piece of own skill evidence using the people:evidence_record grant.', expected: 'Evidence submission succeeds server-side and appears attributed to the employee.' },
      { page: 'learning_and_certifications', scenario: 'Record completion of a learning activity using the people:learning_record grant; separately confirm certification rev_certification_expiring_1 is visible read-only.', expected: 'Learning record submission succeeds; certification renders but with no edit/record controls beyond learning.' },
      { page: 'development_plans', scenario: 'Confirm development plan rev_development_plan_1 is visible read-only (owned by the People Development Manager, not by the employee).', expected: 'Plan renders with no transition/edit controls available to this role.' },
      { page: 'development_plans', scenario: 'DENIED-ACTION TEST: attempt to create a new development plan for self (button if visible, otherwise replay the create API call) — employee self-service’s grants (READ, people:evidence_record, people:learning_record, scope=own) do not include people:development_plan_create.', expected: 'Server rejects with 403/permission-denied; no plan is created. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'MKT', roleName: 'Marketing Manager', login: 'review.marketing_manager',
    steps: [
      { page: 'campaigns', scenario: 'Review draft campaign rev_mkt_campaign_draft ("[DEMO] Spring Promo Campaign", status=draft, budget 5000) and confirm it is editable using marketing:campaign_create.', expected: 'Draft campaign renders with correct budget/status and editable fields.' },
      { page: 'campaigns', scenario: 'Submit/transition draft campaign rev_mkt_campaign_draft using marketing:campaign_submit; separately review approved campaign rev_mkt_campaign_approved ("[DEMO] Al-Warsha Loyalty Relaunch", budget 8000).', expected: 'Submit action succeeds server-side; the already-approved campaign renders with status=approved.' },
      { page: 'marketing_overview', scenario: 'Confirm both campaigns and the simulation labelling ("SIMULATION ONLY - NO EXTERNAL PUBLISHING") are visible on the overview.', expected: 'Overview lists both campaigns with the simulation label clearly shown, per KNOWN_LIMITATIONS.md.' },
      { page: 'attribution_insights', scenario: 'Review simulated attribution rev_mkt_attribution_simulated (42 leads, 7 conversions, $1500 simulated revenue) using marketing:attribution_simulate.', expected: 'Attribution renders with correct figures and the "SIMULATION ONLY - CANONICAL SALES DATA UNCHANGED" label.' },
      { page: 'content_approvals', scenario: 'DENIED-ACTION TEST: attempt to approve content rev_mkt_content_awaiting_review (button if visible, otherwise replay the approve API call) — marketing manager’s grants (marketing:campaign_create/submit, audience_create, attribution_simulate) do not include marketing:content_approve.', expected: 'Server rejects with 403/permission-denied regardless of the content’s current status. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'MKC', roleName: 'Content Reviewer', login: 'review.content_reviewer',
    steps: [
      { page: 'content_calendar', scenario: 'Review content awaiting review, rev_mkt_content_awaiting_review ("[DEMO] Spring Promo Email Draft", channel=email, status=submitted) using marketing:content_create/submit.', expected: 'Content renders on the calendar with status=submitted and its simulated-send label.' },
      { page: 'content_approvals', scenario: 'Approve content rev_mkt_content_awaiting_review using marketing:content_approve; separately review already-approved content rev_mkt_content_approved with its review trail rev_mkt_content_review_approved.', expected: 'Approval succeeds server-side; the already-approved content shows a review decision=approved with reviewer attribution.' },
      { page: 'content_calendar', scenario: 'Confirm every content item’s body text carries the "[SIMULATED CONTENT - never sent to any real recipient]" marker.', expected: 'Simulation marker is visible on every content item, per KNOWN_LIMITATIONS.md.' },
      { page: 'campaigns', scenario: 'DENIED-ACTION TEST: attempt to create a new campaign (button if visible, otherwise replay the create API call) — content reviewer’s grants (marketing:content_create/submit/approve) do not include marketing:campaign_create.', expected: 'Server rejects with 403/permission-denied; no campaign is created. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'EVT', roleName: 'Event Manager', login: 'review.event_manager',
    steps: [
      { page: 'event_planner', scenario: 'Review planned (draft) event rev_evt_planned ("[DEMO] Autumn Product Preview", capacity 50) and published event rev_evt_approved ("[DEMO] Al-Warsha Open House", capacity 100) using events:event_create.', expected: 'Both events render with correct status/capacity; planner allows creating/editing events.' },
      { page: 'event_registrations', scenario: 'Review open-registration event rev_evt_open_registration ("[DEMO] Fiber Laser Demo Day", 2 of 40 registered) and near-capacity event rev_evt_near_capacity ("[DEMO] CNC Safety Workshop", 7 of 8 registered) using events:registration_create.', expected: 'Both events show correct registered/capacity counts; the near-capacity event is visibly flagged as nearly full.' },
      { page: 'event_registrations', scenario: 'Review waitlisted event rev_evt_waitlist_demo ("[DEMO] Metal Fabrication Masterclass", 5/5 booked plus 1 waitlisted registration).', expected: 'Waitlisted registration renders with status=waitlisted, distinct from the 5 confirmed registrations.' },
      { page: 'events_overview', scenario: 'Review completed no-show event rev_evt_completed_noshow ("[DEMO] Electrical Basics Info Session", status=completed) and its never-checked-in registration; note per KNOWN_LIMITATIONS.md that "no-show" is modeled as a registered-but-never-checked-in row on a completed event, not a literal status.', expected: 'Event and registration render; reviewer records the approximation as an observation, not a bug.' },
      { page: 'event_checkin', scenario: 'DENIED-ACTION TEST: attempt to check in an attendee (button if visible, otherwise replay the check-in API call) — event manager’s grants (events:event_create, session_create, registration_create) do not include events:checkin.', expected: 'Server rejects with 403/permission-denied regardless of the registration’s current state. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'EVC', roleName: 'Event Check-In Operator', login: 'review.event_checkin',
    steps: [
      { page: 'event_checkin', scenario: 'Review the already checked-in registration on ongoing event rev_evt_checkin_demo ("[DEMO] Welding Certification Session", status=ongoing, 1 attendee checked_in) using events:checkin.', expected: 'Registration renders with status=checked_in and a checked_in_at timestamp.' },
      { page: 'event_checkin', scenario: 'Check in one of the two registered attendees on rev_evt_open_registration using events:checkin.', expected: 'Check-in action succeeds server-side; registration status moves to checked_in.' },
      { page: 'event_registrations', scenario: 'Register a new attendee against rev_evt_near_capacity (currently 7 of 8 seats) using events:registration_create; confirm the near-capacity warning updates.', expected: 'New registration succeeds and the event now shows 8 of 8 (fully booked).' },
      { page: 'event_registrations', scenario: 'Confirm the waitlisted registration on rev_evt_waitlist_demo remains distinguishable from checked-in/registered attendees.', expected: 'Waitlisted attendee renders with status=waitlisted, not checked_in.' },
      { page: 'event_planner', scenario: 'DENIED-ACTION TEST: attempt to create a new event (button if visible, otherwise replay the create API call) — check-in operator’s grants (events:checkin, events:registration_create) do not include events:event_create.', expected: 'Server rejects with 403/permission-denied; no event is created. If the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'VWR', roleName: 'Viewer', login: 'review.viewer',
    steps: [
      { page: 'home', scenario: 'Sign in as review.viewer (READ-only grant); confirm Home dashboard renders with no visible write controls.', expected: 'Page renders read-only; no create/edit/delete buttons are present.' },
      { page: 'my_work', scenario: 'Confirm My Work lists workshop jobs read-only.', expected: 'Jobs render but with no edit/status-change controls.' },
      { page: 'workshop_command_center', scenario: 'Confirm Workshop Command Center renders the full job board (including rev_wsjob_quality_hold_01, rev_wsjob_blocked_01) read-only.', expected: 'All jobs are visible; no write controls are present anywhere on the board.' },
      { page: 'canonical_inventory', scenario: 'Confirm Canonical Inventory renders warehouse stock read-only.', expected: 'Inventory data is visible; no adjustment/write controls are present.' },
      { page: 'tenant_directory', scenario: 'Confirm Tenant Directory renders both review tenants read-only.', expected: 'Tenant list is visible; no tenant-lifecycle write controls are present.' },
      { page: 'workshop_command_center', scenario: 'DENIED-ACTION TEST: attempt to edit/update workshop job rev_wsjob_new_01 (button if visible, otherwise replay the write API call) — viewer’s only grant is READ.', expected: 'Server rejects with 403/permission-denied; job is unchanged. This is the baseline case KNOWN_LIMITATIONS.md calls out explicitly for review.viewer — if the mutation succeeds, file a P0 security-scope finding.', severity: 'P0' },
    ],
  },
  {
    domainSlug: 'ISO', roleName: 'Isolation Tenant Viewer', login: 'review.isolation_viewer',
    steps: [
      { page: 'home', scenario: 'Sign in as review.isolation_viewer (tenant=t_octagon_isolation_review, company=c_second_demo); confirm Home dashboard loads scoped to the isolation tenant, not the primary review tenant.', expected: 'Page loads without error, scoped to the isolation tenant/company.' },
      { page: 'tenant_detail', scenario: 'Confirm the isolation tenant’s own commercial data is visible: subscription rev_sub_isolation_active (active) and seat rev_seat_isolation.', expected: 'Isolation tenant’s own subscription/seat data renders correctly — isolation does not mean "sees nothing", just "sees only its own tenant".' },
      { page: 'tenant_detail', scenario: 'ISOLATION TEST: attempt to view tenant detail for the primary review tenant t_octagon_review (edit the URL/route parameter, or replay the read API call with tenantId=t_octagon_review).', expected: 'Server returns not-found/empty/403 — never t_octagon_review’s real rows. If any primary-tenant data leaks through, file a P0 security-scope finding per KNOWN_LIMITATIONS.md and TEAM_HANDOFF.md’s prohibited-use section.', severity: 'P0' },
      { page: 'workshop_command_center', scenario: 'ISOLATION TEST: attempt to view the primary tenant’s workshop job board (e.g. rev_wsjob_blocked_01, which belongs to t_octagon_review/c_alwarsha_demo).', expected: 'No primary-tenant workshop jobs are returned; the board is empty or scoped only to the isolation tenant (which seeded no workshop fixtures of its own). If any primary-tenant job appears, file a P0 security-scope finding.', severity: 'P0' },
      { page: 'entitlements', scenario: 'Confirm entitlement override rev_entov_deny (deny capability:advanced_people_development, scoped to the isolation tenant) is visible, proving isolation-tenant-scoped data IS correctly shown while cross-tenant data is not.', expected: 'The isolation-scoped deny override renders correctly, confirming scoping works both ways (own data visible, other tenant’s data denied).' },
    ],
  },
];

function assertPagesKnown() {
  const unknown = new Set();
  for (const scenario of SCENARIOS) {
    for (const step of scenario.steps) {
      if (!PAGE_META[step.page]) unknown.add(step.page);
    }
  }
  if (unknown.size) {
    throw new Error(`functional-matrix.mjs references unknown page id(s) not present in PAGE_META: ${[...unknown].join(', ')}`);
  }
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildRows() {
  const rows = [];
  for (const scenario of SCENARIOS) {
    scenario.steps.forEach((step, index) => {
      const meta = PAGE_META[step.page];
      const reviewId = `REV-${scenario.domainSlug}-${String(index + 1).padStart(3, '0')}`;
      rows.push({
        reviewId,
        domain: meta.domain,
        page: `${step.page} (${meta.labelEn})`,
        role: `${scenario.roleName} (${scenario.login})`,
        scenario: step.scenario,
        expected: step.expected,
        actual: '—',
        status: 'NOT REVIEWED',
        severity: step.severity || meta.priority,
        screenshot: '—',
        reviewer: '—',
        notes: '—',
        suggestedCorrection: '—',
      });
    });
  }
  return rows;
}

function buildMarkdown(rows) {
  const header = [
    '# Functional Review Matrix — Octagon ERP Review Freeze 1',
    '',
    `Generated by \`scripts/review/functional-matrix.mjs\` from the scenario data in that script (mirrors \`docs/review/ROLE_REVIEW_SCENARIOS.md\`). Regenerate with \`npm run review:functional-matrix\` after editing scenarios — do not hand-edit this table.`,
    '',
    `Total rows: ${rows.length}. Every \`Status\` starts as \`NOT REVIEWED\`; reviewers fill in Actual result / Status / Screenshot-reference / Reviewer / Notes / Suggested correction as they complete each row. Review ID numbering is stable per role (\`REV-<domain-slug>-<3-digit-sequence>\`) — do not renumber on regeneration; if a scenario changes, append new rows rather than shifting existing ids.`,
    '',
    'See `docs/review/ROLE_REVIEW_SCENARIOS.md` for the full prose scenario each row is drawn from, `docs/review/PAGE_INVENTORY.json` for page metadata, `docs/review/KNOWN_LIMITATIONS.md` for the permission-enforcement gap every DENIED-ACTION TEST row exercises, and `docs/review/TEAM_HANDOFF.md` for setup/login/reset instructions.',
    '',
    '| Review ID | Domain | Page | Role | Scenario | Expected result | Actual result | Status | Severity | Screenshot/reference | Reviewer | Notes | Suggested correction |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const body = rows.map((r) => `| ${escapeCell(r.reviewId)} | ${escapeCell(r.domain)} | ${escapeCell(r.page)} | ${escapeCell(r.role)} | ${escapeCell(r.scenario)} | ${escapeCell(r.expected)} | ${escapeCell(r.actual)} | ${escapeCell(r.status)} | ${escapeCell(r.severity)} | ${escapeCell(r.screenshot)} | ${escapeCell(r.reviewer)} | ${escapeCell(r.notes)} | ${escapeCell(r.suggestedCorrection)} |`);
  return [...header, ...body, ''].join('\n');
}

function buildRoleScenariosMarkdown() {
  const lines = [
    '# Role-Based Review Scenarios — Octagon ERP Review Freeze 1',
    '',
    'Generated from the scenario source in `scripts/review/functional-matrix.mjs`.',
    'This document is the reviewer-facing handoff; the generated functional matrix',
    'is the recording surface for actual results, status, screenshots, and findings.',
    '',
    '## Review rules',
    '',
    '- Use only the disposable identities and fictional `[DEMO]` fixtures created by `npm run review:setup`.',
    '- Record the exact role login, tenant/company, language, viewport, snapshot SHA/tag, and evidence for every step.',
    '- A denied-action step is a server-enforcement check. A successful unauthorized mutation is a P0 security-scope finding.',
    '- Missing BUILD-13 capability is a deferred-scope note, not a bug in this snapshot.',
    '- Keep all rows `NOT REVIEWED` until a human reviewer actually performs the step.',
    '',
    '## Scenarios',
    '',
  ];
  for (const scenario of SCENARIOS) {
    lines.push('### ' + scenario.roleName + ' — `' + scenario.login + '`');
    lines.push('');
    lines.push(`Scenario domain: **${scenario.domainSlug}**`);
    lines.push('');
    scenario.steps.forEach((step, index) => {
      const meta = PAGE_META[step.page];
      const reviewId = `REV-${scenario.domainSlug}-${String(index + 1).padStart(3, '0')}`;
      lines.push(String(index + 1) + '. **' + reviewId + ' ' + String.fromCharCode(194,183) + ' ' + meta.labelEn + '** (`' + step.page + '`)');
      lines.push(`   - Check: ${step.scenario}`);
      lines.push(`   - Expected: ${step.expected}`);
      lines.push(`   - Severity: **${step.severity || meta.priority}**`);
    });
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  assertPagesKnown();
  const inventoryRaw = fs.readFileSync(PAGE_INVENTORY_PATH, 'utf8');
  const inventory = JSON.parse(inventoryRaw);
  const inventoryIds = new Set(inventory.map((p) => p.pageId));
  const missingFromInventory = Object.keys(PAGE_META).filter((id) => !inventoryIds.has(id));
  if (missingFromInventory.length) {
    throw new Error(`PAGE_META contains page id(s) not found in PAGE_INVENTORY.json: ${missingFromInventory.join(', ')}`);
  }

  const rows = buildRows();
  const markdown = buildMarkdown(rows);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, markdown, 'utf8');
  fs.writeFileSync(ROLE_SCENARIOS_PATH, buildRoleScenariosMarkdown(), 'utf8');

  const perRole = SCENARIOS.map((s) => `${s.roleName}: ${s.steps.length}`).join(', ');
  console.log(`Wrote ${rows.length} rows across ${SCENARIOS.length} role scenarios to ${path.relative(repoRoot, OUTPUT_PATH)}`);
  console.log(`Wrote role handoff to ${path.relative(repoRoot, ROLE_SCENARIOS_PATH)}`);
  console.log(`Rows per role — ${perRole}`);
}

main();
