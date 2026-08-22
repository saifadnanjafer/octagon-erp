'use strict';

function play(ownerRole, cadence, responseMinutes, response, escalation, evidence) {
  return Object.freeze({
    ownerRole,
    cadence,
    responseMinutes,
    response: Object.freeze(response),
    escalation,
    evidence: Object.freeze(evidence),
  });
}

export const WORKSHOP_SIGNAL_PLAYBOOK = Object.freeze({
  today_open_work: play(
    'Workshop Supervisor',
    'start of shift and midday',
    240,
    [
      'Review unassigned and high-priority work.',
      'Confirm owners and due dates.',
      'Move only through canonical work-item actions.',
    ],
    'Escalate when critical work has no owner or due date.',
    ['Assigned work-item identifiers', 'Owner and due-date review'],
  ),
  today_due: play(
    'Workshop Supervisor',
    'hourly',
    120,
    [
      'Open My Work due-today view.',
      'Confirm each item has an accountable owner.',
      'Record blockers in the canonical item.',
    ],
    'Escalate any due-today safety, delivery, or customer commitment at risk.',
    ['Due-today queue snapshot', 'Blocker notes'],
  ),
  today_production: play(
    'Production Manager',
    'start of shift',
    120,
    [
      'Review released and in-progress orders.',
      'Confirm material and work-center readiness.',
      'Sequence work in Production Order Board.',
    ],
    'Escalate orders threatening a confirmed customer delivery.',
    ['Production queue snapshot', 'Material and capacity confirmation'],
  ),
  today_receiving: play(
    'Warehouse Supervisor',
    'hourly',
    90,
    [
      'Review open receiving sessions.',
      'Resolve discrepancies before canonical posting.',
      'Confirm putaway work is assigned.',
    ],
    'Escalate blocked receipts affecting production or customer orders.',
    ['Receiving session references', 'Discrepancy decision evidence'],
  ),
  urgent_overdue: play(
    'Workshop Supervisor',
    'continuous',
    30,
    [
      'Open the overdue queue.',
      'Validate status, owner, and next action.',
      'Reprioritize through the canonical work authority.',
    ],
    'Escalate overdue critical or regulatory work immediately.',
    ['Overdue queue snapshot', 'Recovery owner and target time'],
  ),
  urgent_blocked: play(
    'Workshop Supervisor',
    'continuous',
    30,
    [
      'Inspect each blocker reason.',
      'Identify the dependency owner.',
      'Record the recovery decision in My Work.',
    ],
    'Escalate blockers with no accountable dependency owner.',
    ['Blocked work identifiers', 'Dependency and recovery notes'],
  ),
  urgent_shortages: play(
    'Material Controller',
    'continuous',
    20,
    [
      'Review shortage quantities and production references.',
      'Confirm available substitutions or replenishment.',
      'Use governed material-flow actions.',
    ],
    'Escalate shortages stopping released production.',
    ['Material-flow request', 'Approved supply decision'],
  ),
  urgent_quality: play(
    'Quality Manager',
    'continuous',
    15,
    [
      'Open failed or held checkpoints.',
      'Preserve quarantine and traceability.',
      'Record disposition through the quality authority.',
    ],
    'Escalate safety, compliance, or repeated-defect signals immediately.',
    ['Checkpoint and inspection identifiers', 'Disposition evidence'],
  ),
  queue_warehouse: play(
    'Warehouse Supervisor',
    'every 30 minutes',
    60,
    [
      'Review ready and blocked tasks.',
      'Balance assignments by location and priority.',
      'Complete movement only through canonical Inventory posting.',
    ],
    'Escalate failed or repeatedly blocked warehouse tasks.',
    ['Warehouse task queue', 'Assignment and canonical result identifiers'],
  ),
  queue_picking: play(
    'Warehouse Operator',
    'continuous',
    30,
    [
      'Follow assigned route sequence.',
      'Scan source and product as required.',
      'Record shortages and exceptions before completion.',
    ],
    'Escalate scan mismatch, stock shortage, or unsafe handling.',
    ['Pick-task identifier', 'Scan and exception evidence'],
  ),
  queue_shopfloor: play(
    'Production Supervisor',
    'every 30 minutes',
    45,
    [
      'Review ready, running, and paused sessions.',
      'Confirm operator and work-center assignment.',
      'Capture downtime or quality holds in-session.',
    ],
    'Escalate unplanned downtime or quality holds threatening the plan.',
    ['Shopfloor session timeline', 'Downtime or hold evidence'],
  ),
  queue_maintenance: play(
    'Maintenance Manager',
    'hourly',
    60,
    [
      'Triage submitted requests by priority.',
      'Approve or reject with a recorded reason.',
      'Create governed work orders for accepted requests.',
    ],
    'Escalate emergency requests or asset failures blocking safe operation.',
    ['Maintenance request number', 'Triage decision and owner'],
  ),
  health_migrations: play(
    'System Administrator',
    'daily and after deployment',
    30,
    [
      'Review the migration registry.',
      'Compare accepted manifests and checksums.',
      'Stop deployment on missing or altered migrations.',
    ],
    'Escalate any checksum mismatch or incomplete migration chain.',
    ['Migration verification output', 'Applied migration registry'],
  ),
  health_devices: play(
    'IoT Administrator',
    'every 15 minutes',
    30,
    [
      'Review critical and warning alerts.',
      'Confirm device ownership and recent telemetry.',
      'Acknowledge or assign through governed device actions.',
    ],
    'Escalate device alerts affecting safety or production controls.',
    ['Alert identifier', 'Acknowledgement or assignment record'],
  ),
  health_modules: play(
    'System Administrator',
    'daily',
    240,
    [
      'Review enabled module status.',
      'Confirm owners and versions.',
      'Investigate unavailable authorities before shift handoff.',
    ],
    'Escalate disabled core authorities needed for current operations.',
    ['Module status list', 'Owner and version review'],
  ),
  health_freshness: play(
    'Workshop Supervisor',
    'hourly',
    60,
    [
      'Review the newest canonical work updates.',
      'Identify stale active work.',
      'Ask the accountable owner to update the canonical record.',
    ],
    'Escalate stale critical work whose real status cannot be confirmed.',
    ['Freshness queue snapshot', 'Owner status confirmation'],
  ),
  mine_assigned: play(
    'Signed-in Operator',
    'start of shift and continuous',
    60,
    [
      'Open assigned work.',
      'Confirm priority and safe prerequisites.',
      'Execute from the canonical target.',
    ],
    'Escalate work assigned without access, materials, or instructions.',
    ['Assigned queue', 'Canonical action outcome'],
  ),
  mine_waiting: play(
    'Signed-in Operator',
    'hourly',
    60,
    [
      'Review waiting and blocked assignments.',
      'Confirm the dependency and owner.',
      'Update the work item when the dependency clears.',
    ],
    'Escalate waiting work with no dependency owner or response time.',
    ['Waiting queue', 'Dependency owner and expected resolution'],
  ),
});

const TONE_WEIGHT = Object.freeze({
  danger: 0,
  attention: 1,
  health: 2,
  neutral: 3,
});

function numberValue(card) {
  const numeric = Number(card.value);
  return Number.isFinite(numeric) ? numeric : null;
}

function signalPriority(card) {
  if (card.state !== 'ready') return 'informational';
  const value = numberValue(card);
  if (value === null || value <= 0) return card.tone === 'health' ? 'healthy' : 'clear';
  if (card.tone === 'danger') return 'immediate';
  if (card.tone === 'attention') return 'review';
  return 'monitor';
}

function briefingSignal(section, card) {
  const playbook = WORKSHOP_SIGNAL_PLAYBOOK[card.id];
  if (!playbook) return null;
  return {
    id: card.id,
    sectionId: section.id,
    label: card.label,
    labelAr: card.labelAr,
    state: card.state,
    tone: card.tone,
    value: card.value,
    display: card.display,
    detail: card.detail,
    permission: card.permission,
    target: card.target,
    priority: signalPriority(card),
    ownerRole: playbook.ownerRole,
    cadence: playbook.cadence,
    responseMinutes: playbook.responseMinutes,
    response: playbook.response,
    escalation: playbook.escalation,
    evidence: playbook.evidence,
  };
}

function prioritySort(left, right) {
  const state = Number(left.state !== 'ready') - Number(right.state !== 'ready');
  if (state) return state;
  const tone = (TONE_WEIGHT[left.tone] ?? 99) - (TONE_WEIGHT[right.tone] ?? 99);
  if (tone) return tone;
  const leftValue = numberValue(left) ?? -1;
  const rightValue = numberValue(right) ?? -1;
  if (leftValue !== rightValue) return rightValue - leftValue;
  return left.id.localeCompare(right.id);
}

function nextRoute(signals) {
  const actionable = signals.find((signal) => signal.state === 'ready' && Number(signal.value) > 0 && signal.target);
  if (actionable) {
    return {
      metricId: actionable.id,
      target: actionable.target,
      ownerRole: actionable.ownerRole,
      reason: `${actionable.display ?? actionable.value} ${actionable.label} require review`,
    };
  }
  const unavailable = signals.find((signal) => ['unavailable', 'permission_denied'].includes(signal.state));
  if (unavailable) {
    return {
      metricId: unavailable.id,
      target: null,
      ownerRole: unavailable.ownerRole,
      reason: `${unavailable.label} cannot be evaluated in the active permission and authority scope`,
    };
  }
  return {
    metricId: null,
    target: 'my_work',
    ownerRole: 'Signed-in Operator',
    reason: 'No active exception signal; continue assigned canonical work',
  };
}

export function buildCommandBriefing(sections) {
  const signals = sections
    .flatMap((section) => section.cards.map((card) => briefingSignal(section, card)))
    .filter(Boolean);
  signals.sort(prioritySort);
  const ready = signals.filter((signal) => signal.state === 'ready');
  const unavailable = signals.filter((signal) => signal.state === 'unavailable');
  const denied = signals.filter((signal) => signal.state === 'permission_denied');
  const immediate = ready.filter((signal) => signal.priority === 'immediate' && Number(signal.value) > 0);
  const review = ready.filter((signal) => signal.priority === 'review' && Number(signal.value) > 0);
  const registered = Object.keys(WORKSHOP_SIGNAL_PLAYBOOK).length;
  const evaluable = ready.length + unavailable.length;
  const coveragePercent = registered ? Math.round((evaluable / registered) * 100) : 0;
  let summary = 'No populated urgent signal is visible in the active scope.';
  if (review.length) summary = `${review.length} operational signal${review.length === 1 ? '' : 's'} require review.`;
  if (immediate.length) summary = `${immediate.length} immediate operational signal${immediate.length === 1 ? '' : 's'} require response.`;
  return {
    summary,
    coverage: {
      registered,
      visible: signals.length,
      evaluable,
      coveragePercent,
      ready: ready.length,
      unavailable: unavailable.length,
      permissionDenied: denied.length,
      complete: signals.length === registered && !unavailable.length && !denied.length,
    },
    attention: {
      immediate: immediate.map((signal) => signal.id),
      review: review.map((signal) => signal.id),
      total: immediate.length + review.length,
      clear: ready.filter((signal) => ['clear', 'healthy'].includes(signal.priority)).length,
    },
    nextRoute: nextRoute(signals),
    signals,
    mutationPolicy: 'ADVISORY_ONLY_CANONICAL_TARGETS',
  };
}
