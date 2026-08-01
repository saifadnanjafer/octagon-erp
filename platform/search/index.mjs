// Read-only cross-platform discovery. Business records stay in their domain
// repositories; this service exposes only registered metadata and commands.
'use strict';

export class PlatformSearchService {
  constructor(dialect) { this.dialect = dialect; }
  search(query, { limit = 20 } = {}) {
    const term = String(query || '').trim();
    if (term.length < 2) return [];
    const bounded = Math.max(1, Math.min(Number(limit) || 20, 50)); const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const entities = this.dialect.prepare("SELECT id,label_ar,label_en,module_id FROM platform_entities WHERE id LIKE ? ESCAPE '\\' OR label_ar LIKE ? ESCAPE '\\' OR label_en LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?").all(like, like, like, bounded)
      .map((row) => ({ type: 'entity', id: row.id, labelAr: row.label_ar, labelEn: row.label_en, moduleId: row.module_id }));
    const remaining = Math.max(0, bounded - entities.length);
    if (!remaining) return entities;
    const actions = this.dialect.prepare("SELECT id,module_id,entity_id,required_permission FROM platform_actions WHERE id LIKE ? ESCAPE '\\' OR entity_id LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?").all(like, like, remaining)
      .map((row) => ({ type: 'action', id: row.id, entityId: row.entity_id, moduleId: row.module_id, requiredPermission: row.required_permission }));
    return [...entities, ...actions];
  }
}
export function createPlatformSearchService(dialect) { return new PlatformSearchService(dialect); }
