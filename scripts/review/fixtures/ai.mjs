// Review Freeze — disposable AI governance fixtures.
//
// Fictional demo rows for the BUILD-12 governed-AI tables (see
// database/migrations/089_build12_ai_people_marketing_events_pack.mjs for the
// real schema this is grounded in). Never real data, never written outside a
// disposable review database. All invented ids are prefixed `rev_` and every
// insert is idempotent via ON CONFLICT(id) DO NOTHING (the two tables that
// have no `id` column — saas_usage_counters — use their real composite
// primary key as the conflict target instead).
//
// Attribution: runs are attributed to review.ai_operator / review.ai_reviewer
// (see scripts/review/roles.mjs), the same disposable identities
// scripts/review/identities.mjs seeds for this tenant.

'use strict';

const AI_OPERATOR = 'usr_review_ai_operator';
const AI_REVIEWER = 'usr_review_ai_reviewer';
const PROVIDER_ID = 'octagon_simulator';
const MODEL_ID = 'deterministic-v1';

/**
 * @returns {Promise<{summary: object}>}
 */
export async function seedAiFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  const ts = now || new Date().toISOString();

  // A demo PROHIBITED task. The real seed (migration 089) only ships LOW and
  // MEDIUM tasks, so a fixture-only PROHIBITED task is added here purely to
  // demonstrate the "blocked prohibited run" review case.
  dialect.prepare(`INSERT INTO ai_tasks(id,task_id,purpose,input_schema,output_schema,required_permission,required_entitlement,allowed_data_classifications,risk_class,human_review_policy,allowed_model_classes,max_context,retention_days,proposal_type,canonical_target,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_ai_task_prohibited_demo', 'rev_prohibited_demo_action', 'DEMO ONLY - fictional disallowed autonomous action, used to prove the AI governance layer blocks it', '{}', '{"type":"object"}', 'platform:ai:execute', null, '["public","internal"]', 'PROHIBITED', 'required', '["advisory"]', 10, 30, null, null, ts, ts);

  const RUNS = [
    // Completed, low-risk, informational run.
    { id: 'rev_ai_run_completed_low', taskId: 'operational_summary', risk: 'LOW', status: 'completed', errorCode: null },
    // Blocked run against the fixture PROHIBITED task above.
    { id: 'rev_ai_run_blocked_prohibited', taskId: 'rev_prohibited_demo_action', risk: 'PROHIBITED', status: 'blocked', errorCode: 'AI_TASK_PROHIBITED' },
    // Completed, medium-risk runs that back the three proposal fixtures below.
    { id: 'rev_ai_run_backing_awaiting_review', taskId: 'command_center_briefing', risk: 'MEDIUM', status: 'completed', errorCode: null },
    { id: 'rev_ai_run_backing_approved', taskId: 'command_center_briefing', risk: 'MEDIUM', status: 'completed', errorCode: null },
    { id: 'rev_ai_run_backing_rejected', taskId: 'competency_gap_summary', risk: 'MEDIUM', status: 'completed', errorCode: null },
  ];

  const insertRun = dialect.prepare(`INSERT INTO ai_runs(id,tenant_id,actor_id,task_id,provider_id,model_id,prompt_template_version,context_references,input_hash,output_hash,output_payload,policy_decision,risk_class,status,input_units,output_units,simulated_cost_units,idempotency_key,correlation_id,error_code,started_at,ended_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);

  for (const run of RUNS) {
    const completed = run.status === 'completed';
    const outputPayload = completed
      ? JSON.stringify({ task: run.taskId, summary: `DEMO - Deterministic ${run.taskId} completed for review.`, autonomous_execution: false })
      : null;
    insertRun.run(
      run.id, tenantId, AI_OPERATOR, run.taskId, PROVIDER_ID, MODEL_ID, '1.0.0',
      '[]', `rev_input_hash_${run.id}`, completed ? `rev_output_hash_${run.id}` : null, outputPayload,
      JSON.stringify({ risk_class: run.risk, review_required: run.risk !== 'LOW', autonomous_execution: false }),
      run.risk, run.status, 5, completed ? 1 : 0, completed ? 6 : 0,
      `${run.id}_idem`, `${run.id}_corr`, run.errorCode, ts, ts, ts,
    );
  }

  // Source-reference example, attached to the completed low-risk run.
  dialect.prepare(`INSERT INTO ai_context_sources(id,tenant_id,run_id,source_type,source_label,classification,content_hash,row_count,redacted_fields,blocked_instructions,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_ai_context_source_1', tenantId, 'rev_ai_run_completed_low', 'registered', 'DEMO Workshop Job Board excerpt', 'internal', 'rev_demo_content_hash_1', 5, '["password","token"]', '[]', ts);

  const PROPOSALS = [
    { id: 'rev_ai_proposal_awaiting_review', runId: 'rev_ai_run_backing_awaiting_review', status: 'review_required', summary: 'DEMO - Draft command-center briefing awaiting human review', reviewerId: null, decisionReason: null },
    { id: 'rev_ai_proposal_approved', runId: 'rev_ai_run_backing_approved', status: 'approved', summary: 'DEMO - Command-center briefing proposal, approved by reviewer', reviewerId: AI_REVIEWER, decisionReason: 'DEMO - Approved after human review' },
    { id: 'rev_ai_proposal_rejected', runId: 'rev_ai_run_backing_rejected', status: 'rejected', summary: 'DEMO - Competency gap summary proposal, rejected by reviewer', reviewerId: AI_REVIEWER, decisionReason: 'DEMO - Rejected, needs more context before reuse' },
  ];

  const insertProposal = dialect.prepare(`INSERT INTO ai_proposals(id,tenant_id,run_id,proposal_type,summary,payload,target_authority,risk_class,reviewer_required,expires_at,status,created_by,reviewer_id,decision_reason,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
  const insertReview = dialect.prepare(`INSERT INTO ai_proposal_reviews(id,proposal_id,tenant_id,reviewer_id,decision,reason,created_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);

  for (const proposal of PROPOSALS) {
    insertProposal.run(
      proposal.id, tenantId, proposal.runId, 'command_center_briefing', proposal.summary,
      JSON.stringify({ demo: true, note: 'SIMULATION ONLY - fictional review-environment proposal' }),
      'workshop.command_center', 'MEDIUM', 1, new Date(Date.parse(ts) + 30 * 86400000).toISOString(),
      proposal.status, AI_OPERATOR, proposal.reviewerId, proposal.decisionReason, ts, ts,
    );
    if (proposal.reviewerId) {
      insertReview.run(`rev_ai_review_${proposal.id}`, proposal.id, tenantId, proposal.reviewerId,
        proposal.status === 'approved' ? 'approved' : 'rejected', proposal.decisionReason, ts);
    }
  }

  // Quota-warning example: ai_usage nearing the plan's warning threshold.
  const periodStart = ts.slice(0, 8) + '01T00:00:00.000Z';
  dialect.prepare(`INSERT INTO saas_usage_counters(tenant_id,metric,period_start,period_end,consumed,allowance,warning_threshold,policy,remaining,reconciliation_status,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,metric,period_start) DO NOTHING`)
    .run(tenantId, 'ai_usage', periodStart, new Date(Date.parse(periodStart) + 30 * 86400000).toISOString(), 850, 1000, 800, 'hard', 150, 'reconciled', ts);
  dialect.prepare(`INSERT INTO saas_quota_warnings(id,tenant_id,metric,period_start,threshold,warning_type,emitted_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_quota_warning_ai_usage', tenantId, 'ai_usage', periodStart, 800, 'approaching_limit', ts);

  return {
    summary: {
      aiTasksAdded: 1,
      aiRuns: RUNS.length,
      aiContextSources: 1,
      aiProposals: PROPOSALS.length,
      aiProposalReviews: PROPOSALS.filter((p) => p.reviewerId).length,
      quotaWarnings: 1,
      tenantId, companyId, branchId,
    },
  };
}

export default seedAiFixtures;
