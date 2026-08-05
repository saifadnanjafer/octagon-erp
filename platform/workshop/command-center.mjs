'use strict';

import { COMMAND_CENTER_METRICS, WORKSHOP_SECTIONS } from './command-center-catalog.mjs';
import { requireCompany, safeMetric, scopedContext, validateWarehouse } from './query-utils.mjs';

export function buildWorkshopCommandCenter({ dialect, ctx, query = {}, can = () => false, now = () => new Date() }) {
  const scope = scopedContext(ctx, query);
  const invalid = requireCompany(scope);
  if (invalid) return invalid;

  const generatedAt = now().toISOString();
  const metricContext = { dialect, ctx, query, scope, can };
  const cards = COMMAND_CENTER_METRICS.map((definition) => safeMetric(definition, metricContext));
  const sections = WORKSHOP_SECTIONS.map((section) => ({
    ...section,
    cards: cards.filter((card) => card.section === section.id),
  }));
  const available = cards.filter((card) => card.state === 'ready').length;
  const denied = cards.filter((card) => card.state === 'permission_denied').length;
  const unavailable = cards.filter((card) => card.state === 'unavailable').length;
  const warehouse = validateWarehouse(dialect, scope);

  return {
    data: {
      page: 'workshop_command_center',
      title: 'Workshop Command Center',
      titleAr: 'مركز قيادة الورشة',
      generatedAt,
      scope: {
        companyId: scope.companyId,
        branchId: scope.branchId || null,
        warehouseId: scope.warehouseId || null,
        warehouseValid: warehouse.valid,
        actorId: scope.actorId || null,
      },
      summary: { total: cards.length, available, denied, unavailable, partial: unavailable > 0 },
      sections,
    },
    meta: { total: cards.length, generated_at: generatedAt, partial_failures: unavailable },
  };
}

