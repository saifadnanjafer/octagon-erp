'use strict';

import { buildWorkshopCommandCenter } from '../workshop/command-center.mjs';
import { buildMyWork } from '../workshop/my-work.mjs';
import { buildWorkshopReadiness } from '../workshop/readiness.mjs';
import { buildWorkshopDrilldown } from '../workshop/drilldowns.mjs';

export const WORKSHOP_RESOURCE_PERMISSIONS = Object.freeze({
  'command-center': 'platform:db:read',
  'my-work': 'platform:db:read',
  readiness: 'platform:db:read',
  drilldown: 'platform:db:read',
});

export function handleWorkshopQuery({ dialect, ctx, resource, query = {}, can = () => false }) {
  try {
    if (resource === 'command-center') return buildWorkshopCommandCenter({ dialect, ctx, query, can });
    if (resource === 'my-work') return buildMyWork({ dialect, ctx, query, can });
    if (resource === 'readiness') return buildWorkshopReadiness({ dialect, ctx, query, can });
    if (resource === 'drilldown') return buildWorkshopDrilldown({ dialect, ctx, query, can });
    return { error: 'Workshop operations resource not found', status: 404 };
  } catch (error) {
    return { error: error?.message || 'Workshop operations query failed', status: error?.statusCode || 422, code: error?.code || 'WORKSHOP_QUERY_FAILED' };
  }
}
