'use strict';

import { READINESS_CATEGORIES, READINESS_STATES } from './readiness-catalog.mjs';
import { buildReadinessActionPlan, guidanceFor } from './readiness-guidance.mjs';
import { requireCompany, scopedContext } from './query-utils.mjs';

function evaluateCheck(definition, context) {
  const base = { id: definition.id, label: definition.label, labelAr: definition.labelAr, mandatory: definition.mandatory, permission: definition.permission, target: definition.target };
  if (!context.can(definition.permission)) return { ...base, state: 'PERMISSION_DENIED', value: null, detail: 'You do not have permission to inspect this configuration' };
  try {
    const result = definition.evaluate(context);
    if (!READINESS_STATES.includes(result.state)) throw new Error(`Invalid readiness state ${result.state}`);
    return { ...base, ...result };
  } catch (error) {
    return { ...base, state: 'BLOCKED', value: null, detail: error?.message || 'Readiness check failed' };
  }
}

function categoryStatus(checks) {
  const visible = checks.filter((check) => !['PERMISSION_DENIED','NOT_SUPPORTED','OPTIONAL'].includes(check.state));
  if (!visible.length) return checks.some((check) => check.state === 'PERMISSION_DENIED') ? 'PERMISSION_DENIED' : 'NOT_SUPPORTED';
  if (visible.some((check) => check.state === 'BLOCKED')) return 'BLOCKED';
  if (visible.some((check) => check.state === 'MISSING')) return 'MISSING';
  if (visible.some((check) => check.state === 'WARNING')) return 'WARNING';
  return 'READY';
}

function formula(categories) {
  const checks = categories.flatMap((category) => category.checks);
  const mandatory = checks.filter((check) => check.mandatory);
  const passed = mandatory.filter((check) => check.state === 'READY').length;
  const failed = mandatory.filter((check) => ['WARNING','MISSING','BLOCKED'].includes(check.state)).length;
  const excludedPermission = mandatory.filter((check) => check.state === 'PERMISSION_DENIED').length;
  const excludedUnsupported = mandatory.filter((check) => check.state === 'NOT_SUPPORTED').length;
  const denominator = passed + failed;
  return {
    passed, failed, denominator,
    percentage: denominator ? Math.round((passed / denominator) * 100) : 0,
    excludedPermission, excludedUnsupported,
    optional: checks.filter((check) => !check.mandatory || check.state === 'OPTIONAL').length,
    expression: 'mandatory READY / (mandatory READY + mandatory WARNING + mandatory MISSING + mandatory BLOCKED)',
    exclusions: ['OPTIONAL', 'PERMISSION_DENIED', 'NOT_SUPPORTED'],
  };
}

export function buildWorkshopReadiness({ dialect, ctx, query = {}, can = () => false, now = () => new Date() }) {
  const scope = scopedContext(ctx, query);
  const invalid = requireCompany(scope);
  if (invalid) return invalid;
  const context = { dialect, ctx, query, scope, can };
  const categories = READINESS_CATEGORIES.map((definition) => {
    const checks = definition.checks.map((item) => {
      const evaluated = evaluateCheck(item, context);
      return { ...evaluated, guidance: guidanceFor(evaluated) };
    });
    return { id: definition.id, label: definition.label, labelAr: definition.labelAr, icon: definition.icon, state: categoryStatus(checks), checks };
  });
  const generatedAt = now().toISOString();
  const actionPlan = buildReadinessActionPlan(categories);
  return {
    data: {
      page: 'workshop_readiness', generatedAt,
      scope: { companyId: scope.companyId, branchId: scope.branchId || null, warehouseId: scope.warehouseId || null, actorId: scope.actorId || null },
      formula: formula(categories), categories, actionPlan,
      stateLegend: READINESS_STATES,
      mutationPolicy: 'READ_ONLY_ZERO_MUTATION',
    },
    meta: { total: categories.length, checks: categories.flatMap((category) => category.checks).length, generated_at: generatedAt },
  };
}
