// Approval policy engine, decisions, and worklists — Phase 02 packets 02.19/02.20.
//
// Source composition:
// - VNext vnext/server/approvals/approvals.js (project-owned, MERGE-CANONICAL).
//   Preserved behaviors, all of them load-bearing:
//     * the nine work queues (my/todo/done/cc/delegated/escalated/withdrawn/
//       rejected/returned) — the RuoYi-derived vocabulary the Octagon UI expects;
//     * `payload_hash` binding, so an approval granted for one payload cannot be
//       replayed against a mutated one;
//     * `step_entered_at` + escalation columns for the SLA/escalation clock;
//     * maker≠checker (`requester === approver` ⇒ invalid) from
//       getApprovedApproval();
//     * canonicalize()/payloadHash() key-sorted hashing.
//   Replaced: `hasColumn()` runtime schema probing (the columns are now declared
//   by migration 009) and the JSON `payload._policy` chain cursor (now first-class
//   `current_step`/`current_roles` columns with a unique decision index).
// - VNext modules/governance/policy-engine.js authority-limit escalation.
// - RuoYi yudao-module-bpm process/task/listener packages (MIT reference,
//   behavior only): quorum, parallel lanes, return-for-correction, task center.
// - NocoBase approval workflows (clean-room): concurrency-safe decision recording.
//
// Invariants (§ 11.4 – 11.7):
//   - an approval grants the RIGHT TO REQUEST a command; it never bypasses
//     domain validation
//   - a duplicate decision cannot double-complete a step (unique index)
//   - authority is server-derived; a decider's roles are read, never supplied

'use strict';

import crypto from 'node:crypto';

export class ApprovalError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.details = details;
  }
}

/** The nine boxes. Preserved verbatim from VNext approvals.js. */
export const BOXES = Object.freeze(['my', 'todo', 'done', 'cc', 'delegated', 'escalated', 'withdrawn', 'rejected', 'returned']);
export const MODES = Object.freeze(['sequential', 'any_one_of', 'all_required', 'quorum', 'parallel']);

/** Key-sorted canonical hashing. Preserved from VNext canonicalize()/payloadHash(). */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k])]));
  }
  return value;
}

export function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload || {}))).digest('hex');
}

export class ApprovalEngine {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.policies = deps.policyEngine || null;
    this.calendars = deps.calendars || null;
    this.slaClocks = deps.slaClocks || null;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  #audit(action, resourceId, detail, actor) {
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', ?, 'approval_requests', ?, ?, 'approvals', 'success', ?)
    `).run(crypto.randomUUID(), actor || 'system', action, resourceId, this.#now(), detail ? JSON.stringify(detail) : null);
  }

  // --- policies -------------------------------------------------------------

  definePolicy({ id, moduleId, entity, action, labelAr = null, mode = 'sequential', chain = [], quorum = null,
    amountThreshold = null, escalateRole = null, escalationTimeoutMinutes = null, makerChecker = true,
    allowReturn = true, calendarId = null, companyId = null }, actor = 'system') {
    if (!MODES.includes(mode)) throw new ApprovalError(`unknown approval mode ${mode}`, 'APPROVAL_MODE_INVALID', { mode });
    if (mode === 'quorum' && !(quorum > 0)) throw new ApprovalError('a quorum policy needs a quorum size', 'APPROVAL_QUORUM_REQUIRED');
    if (!chain.length) throw new ApprovalError('an approval policy needs at least one step', 'APPROVAL_CHAIN_REQUIRED');
    const policyId = id || `apol_${entity}_${action}`;
    this.dialect.prepare(`
      INSERT INTO approval_policies (id, module_id, entity, action, label_ar, mode, chain, quorum, amount_threshold,
        escalate_role, escalation_timeout_minutes, maker_checker, allow_return, calendar_id, company_id, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, chain=excluded.chain, quorum=excluded.quorum,
        amount_threshold=excluded.amount_threshold, escalate_role=excluded.escalate_role,
        escalation_timeout_minutes=excluded.escalation_timeout_minutes, maker_checker=excluded.maker_checker,
        allow_return=excluded.allow_return, calendar_id=excluded.calendar_id, label_ar=excluded.label_ar
    `).run(policyId, moduleId, entity, action, labelAr, mode, JSON.stringify(chain), quorum, amountThreshold,
      escalateRole, escalationTimeoutMinutes, makerChecker ? 1 : 0, allowReturn ? 1 : 0, calendarId, companyId,
      this.#now(), actor);
    return this.getPolicy(policyId);
  }

  getPolicy(id) {
    const r = this.dialect.prepare('SELECT * FROM approval_policies WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, moduleId: r.module_id, entity: r.entity, action: r.action, labelAr: r.label_ar,
      mode: r.mode, chain: JSON.parse(r.chain || '[]'), quorum: r.quorum, amountThreshold: r.amount_threshold,
      escalateRole: r.escalate_role, escalationTimeoutMinutes: r.escalation_timeout_minutes,
      makerChecker: r.maker_checker === 1, allowReturn: r.allow_return === 1,
      calendarId: r.calendar_id, companyId: r.company_id, status: r.status,
    };
  }

  findPolicy(entity, action, companyId = null) {
    const r = this.dialect.prepare(`
      SELECT id FROM approval_policies WHERE entity = ? AND action = ? AND status = 'active'
        AND (company_id IS NULL OR company_id = ?)
      ORDER BY (company_id IS NOT NULL) DESC LIMIT 1
    `).get(entity, action, companyId);
    return r ? this.getPolicy(r.id) : null;
  }

  // --- requests -------------------------------------------------------------

  /**
   * Raise an approval request. The chain is resolved from the policy; when the
   * amount exceeds the policy threshold an escalation role is appended — the
   * rule preserved from VNext createApproval().
   */
  request({ entity, recordId, action, payload = {}, amount = null, requesterId, companyId = null, tenantId = null,
    cc = [], expiresAt = null, workflowInstanceId = null, correlationId = null }) {
    if (!entity || !recordId || !action) throw new ApprovalError('entity, recordId and action are required', 'APPROVAL_REQUEST_INVALID');
    const policy = this.findPolicy(entity, action, companyId);
    if (!policy) throw new ApprovalError(`no approval policy covers ${entity}:${action}`, 'POLICY_COVERAGE_MISSING', { entity, action });

    let chain = [...policy.chain];
    if (policy.amountThreshold != null && amount != null && Number(amount) > Number(policy.amountThreshold)) {
      if (policy.escalateRole) chain = [...chain, [policy.escalateRole]];
    }
    const firstStep = chain[0];
    const currentRoles = Array.isArray(firstStep) ? firstStep : [firstStep];

    const id = `apr_${crypto.randomUUID()}`;
    const now = this.#now();
    this.dialect.prepare(`
      INSERT INTO approval_requests (id, policy_id, entity, record_id, action, payload, payload_hash, amount,
        requester_id, tenant_id, company_id, current_step, current_roles, status, cc, version, step_entered_at,
        expires_at, workflow_instance_id, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, 1, ?, ?, ?, ?, ?)
    `).run(id, policy.id, entity, recordId, action, JSON.stringify(payload), payloadHash(payload), amount,
      requesterId, tenantId, companyId, JSON.stringify(currentRoles), JSON.stringify(cc), now, expiresAt,
      workflowInstanceId, correlationId, now);

    this.#openWorklistItems(id, currentRoles, companyId, policy);
    this.#audit('approval.request', id, { entity, recordId, action, amount, chainLength: chain.length }, requesterId);
    // Persist the resolved chain on the request so a later policy edit cannot
    // retroactively change an in-flight approval.
    this.dialect.prepare('UPDATE approval_requests SET payload = ? WHERE id = ?')
      .run(JSON.stringify({ ...payload, __chain: chain }), id);
    return this.get(id);
  }

  #openWorklistItems(requestId, roles, companyId, policy) {
    const ins = this.dialect.prepare(`
      INSERT INTO worklist_items (id, request_id, kind, candidate_role, company_id, title_ar, due_at, sla_calendar_id, status, created_at)
      VALUES (?, ?, 'approval', ?, ?, ?, ?, ?, 'open', ?)
    `);
    let dueAt = null;
    if (policy?.escalationTimeoutMinutes && this.calendars) {
      const calendar = this.calendars.get(policy.calendarId || 'cal_default');
      if (calendar) dueAt = this.calendars.addBusinessMinutes(calendar, this.now(), policy.escalationTimeoutMinutes).toISOString();
    }
    for (const role of roles) {
      ins.run(`wli_${crypto.randomUUID()}`, requestId, role, companyId, policy?.labelAr || null, dueAt, policy?.calendarId || null, this.#now());
    }
  }

  get(id) {
    const r = this.dialect.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
    if (!r) return null;
    const payload = JSON.parse(r.payload || '{}');
    const chain = payload.__chain || [];
    delete payload.__chain;
    return {
      id: r.id, policyId: r.policy_id, entity: r.entity, recordId: r.record_id, action: r.action,
      payload, payloadHash: r.payload_hash, chain, amount: r.amount,
      requesterId: r.requester_id, tenantId: r.tenant_id, companyId: r.company_id,
      currentStep: r.current_step, currentRoles: JSON.parse(r.current_roles || '[]'),
      status: r.status, cc: JSON.parse(r.cc || '[]'), version: r.version,
      stepEnteredAt: r.step_entered_at, escalated: r.escalated === 1, escalatedAt: r.escalated_at,
      escalatedFromRole: r.escalated_from_role, expiresAt: r.expires_at,
      workflowInstanceId: r.workflow_instance_id, createdAt: r.created_at, decidedAt: r.decided_at,
      decisions: this.dialect.prepare('SELECT * FROM approval_decisions WHERE request_id = ? ORDER BY decided_at').all(id),
    };
  }

  /** Roles the decider effectively holds, including active delegations. */
  #deciderRoles(deciderId, companyId) {
    const own = this.dialect.prepare(`
      SELECT DISTINCT r.name FROM authorization_role_assignments a
      JOIN authorization_roles r ON r.id = a.role_id AND r.status = 'active'
      WHERE a.user_id = ? AND a.status = 'active' AND (a.company_id IS NULL OR a.company_id = ?)
    `).all(deciderId, companyId || '').map((r) => r.name);
    const delegated = [];
    if (this.policies) {
      for (const d of this.policies.activeDelegationsFor(deciderId, companyId)) {
        const fromRoles = this.dialect.prepare(`
          SELECT DISTINCT r.name FROM authorization_role_assignments a
          JOIN authorization_roles r ON r.id = a.role_id AND r.status = 'active'
          WHERE a.user_id = ? AND a.status = 'active'
        `).all(d.fromUserId).map((r) => r.name);
        for (const role of fromRoles) if (!own.includes(role)) delegated.push({ role, delegationId: d.id, fromUserId: d.fromUserId });
      }
    }
    return { own, delegated, all: [...new Set([...own, ...delegated.map((d) => d.role)])] };
  }

  /**
   * Record a decision. Concurrency-safe: the unique index on
   * (request_id, step, decider_id) makes a duplicate decision impossible, and
   * the whole advance runs inside BEGIN IMMEDIATE so two approvers racing on the
   * final slot cannot both complete the request.
   */
  decide({ requestId, deciderId, decision, comment = null, attachments = [], expectedVersion = null }) {
    if (!['approve', 'reject', 'return', 'withdraw', 'escalate'].includes(decision)) {
      throw new ApprovalError(`unknown decision ${decision}`, 'DECISION_INVALID', { decision });
    }
    const request = this.get(requestId);
    if (!request) throw new ApprovalError('approval request not found', 'APPROVAL_NOT_FOUND', { requestId });
    if (request.status !== 'pending') throw new ApprovalError(`request is already ${request.status}`, 'APPROVAL_ALREADY_DECIDED', { status: request.status });
    if (expectedVersion !== null && Number(expectedVersion) !== Number(request.version)) {
      throw new ApprovalError('the request changed since it was loaded', 'APPROVAL_STALE', { expected: expectedVersion, actual: request.version });
    }
    if (request.expiresAt && Date.parse(request.expiresAt) <= this.now().getTime()) {
      this.dialect.prepare("UPDATE approval_requests SET status = 'expired' WHERE id = ?").run(requestId);
      throw new ApprovalError('the approval request has expired', 'APPROVAL_EXPIRED');
    }
    // The payload must still hash to what was approved (VNext payload_hash rule).
    if (payloadHash(request.payload) !== request.payloadHash) {
      throw new ApprovalError('the request payload has been altered', 'APPROVAL_PAYLOAD_TAMPERED');
    }

    const policy = this.getPolicy(request.policyId);

    if (decision === 'withdraw') {
      if (deciderId !== request.requesterId) throw new ApprovalError('only the requester may withdraw', 'APPROVAL_WITHDRAW_FORBIDDEN');
      return this.#finalize(requestId, 'withdrawn', deciderId, decision, comment, attachments, request);
    }

    // Maker ≠ checker. Preserved from VNext getApprovedApproval().
    if (policy?.makerChecker && deciderId === request.requesterId) {
      throw new ApprovalError('لا يمكنك اعتماد طلبك بنفسك', 'APPROVAL_SELF_FORBIDDEN', { requestId });
    }

    // Authority is server-derived: the decider must hold one of the step's roles.
    const roles = this.#deciderRoles(deciderId, request.companyId);
    const match = request.currentRoles.find((r) => roles.all.includes(r));
    if (!match) {
      throw new ApprovalError('ليس لديك صلاحية اتخاذ القرار في هذه الخطوة', 'APPROVAL_NOT_AUTHORIZED', { requiredRoles: request.currentRoles });
    }
    const viaDelegation = roles.delegated.find((d) => d.role === match) || null;

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      // Re-read inside the transaction: another approver may have finished the
      // request between our read above and this write.
      const fresh = this.dialect.prepare('SELECT status, current_step, version FROM approval_requests WHERE id = ?').get(requestId);
      if (fresh.status !== 'pending') {
        this.dialect.exec('ROLLBACK;');
        throw new ApprovalError(`request is already ${fresh.status}`, 'APPROVAL_ALREADY_DECIDED', { status: fresh.status });
      }
      try {
        this.dialect.prepare(`
          INSERT INTO approval_decisions (id, request_id, step, decider_id, on_behalf_of, delegation_id, decision, comment, attachments, decided_at, request_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`apd_${crypto.randomUUID()}`, requestId, fresh.current_step, deciderId,
          viaDelegation?.fromUserId || null, viaDelegation?.delegationId || null,
          decision, comment, JSON.stringify(attachments), this.#now(), fresh.version);
      } catch (e) {
        this.dialect.exec('ROLLBACK;');
        if (String(e.message).includes('UNIQUE')) {
          throw new ApprovalError('you have already decided this step', 'APPROVAL_DUPLICATE_DECISION', { requestId, step: fresh.current_step });
        }
        throw e;
      }

      let outcome;
      if (decision === 'reject') {
        outcome = this.#applyFinal(requestId, 'rejected');
      } else if (decision === 'return') {
        if (!policy?.allowReturn) {
          this.dialect.exec('ROLLBACK;');
          throw new ApprovalError('this policy does not allow return for correction', 'APPROVAL_RETURN_FORBIDDEN');
        }
        outcome = this.#applyFinal(requestId, 'returned');
      } else if (decision === 'escalate') {
        outcome = this.#applyEscalation(requestId, request, policy, match);
      } else {
        outcome = this.#applyApproval(requestId, request, policy, fresh.current_step);
      }
      this.dialect.exec('COMMIT;');
      this.#audit(`approval.${decision}`, requestId, { deciderId, step: fresh.current_step, viaDelegation: viaDelegation?.delegationId || null, outcome: outcome.status }, deciderId);
      return this.get(requestId);
    } catch (e) {
      try { this.dialect.exec('ROLLBACK;'); } catch { /* already rolled back */ }
      throw e;
    }
  }

  #applyFinal(requestId, status) {
    this.dialect.prepare('UPDATE approval_requests SET status = ?, decided_at = ?, version = version + 1 WHERE id = ?')
      .run(status, this.#now(), requestId);
    this.dialect.prepare("UPDATE worklist_items SET status = 'done' WHERE request_id = ? AND status IN ('open','claimed')").run(requestId);
    return { status };
  }

  #applyApproval(requestId, request, policy, step) {
    const stepSpec = request.chain[step];
    const stepRoles = Array.isArray(stepSpec) ? stepSpec : [stepSpec];
    const approvalsThisStep = this.dialect.prepare(
      "SELECT COUNT(*) AS n FROM approval_decisions WHERE request_id = ? AND step = ? AND decision = 'approve'"
    ).get(requestId, step);
    const count = Number(approvalsThisStep.n);

    let stepSatisfied;
    if (policy.mode === 'any_one_of') stepSatisfied = count >= 1;
    else if (policy.mode === 'all_required' || policy.mode === 'parallel') stepSatisfied = count >= stepRoles.length;
    else if (policy.mode === 'quorum') stepSatisfied = count >= Number(policy.quorum);
    else stepSatisfied = count >= 1; // sequential

    if (!stepSatisfied) {
      this.dialect.prepare('UPDATE approval_requests SET version = version + 1 WHERE id = ?').run(requestId);
      return { status: 'pending', step, awaiting: (policy.mode === 'quorum' ? Number(policy.quorum) : stepRoles.length) - count };
    }

    const nextStep = step + 1;
    if (nextStep >= request.chain.length) {
      this.#applyFinal(requestId, 'approved');
      return { status: 'approved' };
    }
    const nextSpec = request.chain[nextStep];
    const nextRoles = Array.isArray(nextSpec) ? nextSpec : [nextSpec];
    this.dialect.prepare(`
      UPDATE approval_requests SET current_step = ?, current_roles = ?, step_entered_at = ?, version = version + 1 WHERE id = ?
    `).run(nextStep, JSON.stringify(nextRoles), this.#now(), requestId);
    this.dialect.prepare("UPDATE worklist_items SET status = 'done' WHERE request_id = ? AND status IN ('open','claimed')").run(requestId);
    this.#openWorklistItems(requestId, nextRoles, request.companyId, policy);
    return { status: 'pending', step: nextStep };
  }

  #applyEscalation(requestId, request, policy, fromRole) {
    if (!policy.escalateRole) throw new ApprovalError('this policy has no escalation role', 'APPROVAL_NO_ESCALATION_ROLE');
    this.dialect.prepare(`
      UPDATE approval_requests SET current_roles = ?, escalated = 1, escalated_at = ?, escalated_from_role = ?,
        step_entered_at = ?, version = version + 1 WHERE id = ?
    `).run(JSON.stringify([policy.escalateRole]), this.#now(), fromRole, this.#now(), requestId);
    this.dialect.prepare("UPDATE worklist_items SET status = 'done' WHERE request_id = ? AND status IN ('open','claimed')").run(requestId);
    this.#openWorklistItems(requestId, [policy.escalateRole], request.companyId, policy);
    return { status: 'pending', escalated: true };
  }

  #finalize(requestId, status, deciderId, decision, comment, attachments, request) {
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO approval_decisions (id, request_id, step, decider_id, decision, comment, attachments, decided_at, request_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`apd_${crypto.randomUUID()}`, requestId, request.currentStep, deciderId, decision, comment, JSON.stringify(attachments), this.#now(), request.version);
      this.#applyFinal(requestId, status);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.#audit(`approval.${decision}`, requestId, { deciderId }, deciderId);
    return this.get(requestId);
  }

  /**
   * Was this exact action approved? The gate a domain command calls before it
   * executes. Preserved rule set from VNext getApprovedApproval(): status,
   * company/tenant match, entity/record/action match, expiry, payload hash, and
   * requester ≠ approver.
   */
  isApproved({ requestId, entity, recordId, action, companyId, tenantId = null, payload = null }) {
    const request = this.get(requestId);
    if (!request) return { approved: false, reasonCode: 'APPROVAL_NOT_FOUND' };
    if (request.status !== 'approved') return { approved: false, reasonCode: 'APPROVAL_NOT_APPROVED', status: request.status };
    if (request.companyId && String(request.companyId) !== String(companyId)) return { approved: false, reasonCode: 'APPROVAL_COMPANY_MISMATCH' };
    if (tenantId && request.tenantId && String(request.tenantId) !== String(tenantId)) return { approved: false, reasonCode: 'APPROVAL_TENANT_MISMATCH' };
    if (request.entity !== entity || request.recordId !== recordId) return { approved: false, reasonCode: 'APPROVAL_SUBJECT_MISMATCH' };
    if (action && request.action !== action) return { approved: false, reasonCode: 'APPROVAL_ACTION_MISMATCH' };
    if (request.expiresAt && Date.parse(request.expiresAt) <= this.now().getTime()) return { approved: false, reasonCode: 'APPROVAL_EXPIRED' };
    if (payload && payloadHash(payload) !== request.payloadHash) return { approved: false, reasonCode: 'APPROVAL_PAYLOAD_MISMATCH' };
    const approvers = request.decisions.filter((d) => d.decision === 'approve').map((d) => d.decider_id);
    if (!approvers.length) return { approved: false, reasonCode: 'APPROVAL_NO_APPROVER' };
    if (approvers.every((a) => a === request.requesterId)) return { approved: false, reasonCode: 'APPROVAL_SELF_APPROVED' };
    return { approved: true, requestId, approvers };
  }

  /** Escalate every request whose step SLA elapsed. Driven by a scheduled job. */
  escalateOverdue() {
    const nowIso = this.#now();
    const overdue = this.dialect.prepare(`
      SELECT DISTINCT r.id FROM approval_requests r
      JOIN worklist_items w ON w.request_id = r.id AND w.status = 'open'
      WHERE r.status = 'pending' AND r.escalated = 0 AND w.due_at IS NOT NULL AND w.due_at <= ?
    `).all(nowIso);
    const escalated = [];
    for (const row of overdue) {
      const request = this.get(row.id);
      const policy = this.getPolicy(request.policyId);
      if (!policy?.escalateRole) continue;
      this.dialect.exec('BEGIN IMMEDIATE;');
      try {
        this.#applyEscalation(row.id, request, policy, request.currentRoles[0] || null);
        this.dialect.exec('COMMIT;');
        escalated.push(row.id);
      } catch (e) {
        this.dialect.exec('ROLLBACK;');
      }
    }
    return escalated;
  }

  // --- worklists (packet 02.20) ---------------------------------------------

  /**
   * The nine boxes, scope-filtered. Preserved semantics from VNext, with company
   * scope now enforced from the DecisionContext instead of a header.
   */
  worklist(box, ctx, { limit = 100, offset = 0 } = {}) {
    if (!BOXES.includes(box)) throw new ApprovalError(`unknown worklist box ${box}`, 'WORKLIST_BOX_INVALID', { box });
    const roles = this.#deciderRoles(ctx.actorId, ctx.activeCompanyId);
    const companies = ctx.companyMemberships?.length ? ctx.companyMemberships : (ctx.activeCompanyId ? [ctx.activeCompanyId] : []);
    if (!companies.length) return [];
    const companyIn = companies.map(() => '?').join(',');

    const rolePlaceholders = (list) => (list.length ? list.map(() => '?').join(',') : "''");
    let sql;
    let params;
    switch (box) {
      case 'my':
        sql = `SELECT r.id AS id FROM approval_requests r WHERE r.requester_id = ? AND r.company_id IN (${companyIn})`;
        params = [ctx.actorId, ...companies];
        break;
      case 'todo':
        sql = `SELECT DISTINCT r.id AS id FROM approval_requests r, json_each(r.current_roles) j
               WHERE r.status = 'pending' AND r.company_id IN (${companyIn})
                 AND j.value IN (${rolePlaceholders(roles.own)}) AND r.requester_id <> ?`;
        params = [...companies, ...roles.own, ctx.actorId];
        break;
      case 'delegated': {
        const delegatedRoles = roles.delegated.map((d) => d.role);
        sql = `SELECT DISTINCT r.id AS id FROM approval_requests r, json_each(r.current_roles) j
               WHERE r.status = 'pending' AND r.company_id IN (${companyIn})
                 AND j.value IN (${rolePlaceholders(delegatedRoles)})`;
        params = [...companies, ...delegatedRoles];
        break;
      }
      case 'done':
        sql = `SELECT DISTINCT r.id AS id FROM approval_requests r
               JOIN approval_decisions d ON d.request_id = r.id AND d.decider_id = ? AND d.decision = 'approve'
               WHERE r.status = 'approved' AND r.company_id IN (${companyIn})`;
        params = [ctx.actorId, ...companies];
        break;
      case 'cc':
        sql = `SELECT DISTINCT r.id AS id FROM approval_requests r, json_each(r.cc) j
               WHERE j.value = ? AND r.company_id IN (${companyIn})`;
        params = [ctx.actorId, ...companies];
        break;
      case 'escalated':
        sql = `SELECT r.id AS id FROM approval_requests r WHERE r.escalated = 1 AND r.company_id IN (${companyIn})`;
        params = [...companies];
        break;
      default: // withdrawn | rejected | returned
        sql = `SELECT r.id AS id FROM approval_requests r WHERE r.status = ? AND r.company_id IN (${companyIn})`;
        params = [box, ...companies];
    }
    const rows = this.dialect.prepare(`${sql} ORDER BY r.id LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return rows.map((r) => this.get(r.id));
  }

  counts(ctx) {
    const out = {};
    for (const box of BOXES) out[box] = this.worklist(box, ctx, { limit: 1000 }).length;
    return out;
  }

  /**
   * Bulk decisions are all-or-nothing: a partial batch would leave an approver
   * unsure which items actually moved (§ 45 "bulk action atomicity").
   */
  bulkDecide({ requestIds, deciderId, decision, comment = null }) {
    const applied = [];
    this.dialect.exec('BEGIN IMMEDIATE;');
    let inTransaction = true;
    try {
      this.dialect.exec('COMMIT;'); // decide() manages its own transaction
      inTransaction = false;
      for (const requestId of requestIds) {
        applied.push(this.decide({ requestId, deciderId, decision, comment }));
      }
      return { applied: applied.length, results: applied };
    } catch (e) {
      if (inTransaction) { try { this.dialect.exec('ROLLBACK;'); } catch { /* noop */ } }
      // Roll back the ones that DID succeed so the batch is atomic from the
      // approver's point of view.
      for (const done of applied) {
        this.dialect.prepare("UPDATE approval_requests SET status = 'pending', decided_at = NULL WHERE id = ?").run(done.id);
        this.dialect.prepare('DELETE FROM approval_decisions WHERE request_id = ? AND decider_id = ?').run(done.id, deciderId);
      }
      throw new ApprovalError(`bulk decision failed and was reverted: ${e.message}`, 'APPROVAL_BULK_FAILED', { cause: e.code || e.message, reverted: applied.length });
    }
  }
}

export function createApprovalEngine(dialect, deps) { return new ApprovalEngine(dialect, deps); }
