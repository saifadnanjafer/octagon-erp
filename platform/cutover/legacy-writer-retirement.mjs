export const PHASE04_RETIREMENT_LOCKS = Object.freeze({
  COMMERCIAL: {
    authorityKey: 'COMMERCIAL_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'commercial_core',
  },
  INVENTORY: {
    authorityKey: 'INVENTORY_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'stock_inventory',
  },
  SALES: {
    authorityKey: 'SALES_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'commercial_sales',
  },
  PROCUREMENT: {
    authorityKey: 'PROCUREMENT_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'commercial_procurement',
  },
  POS: {
    authorityKey: 'POS_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'commercial_cutover',
  },
  WORK_ITEM: {
    authorityKey: 'WORK_ITEM_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'work_item_canonical',
  },
});

export function createLegacyWriterRetirementGuard(dialect) {
  if (!dialect || typeof dialect.prepare !== 'function') {
    throw new Error('Legacy writer retirement guard requires a database dialect');
  }

  function cutoverEnabled() {
    try {
      const row = dialect.prepare(`
        SELECT enabled
        FROM platform_feature_flags
        WHERE key = 'phase04.canonical_cutover'
      `).get();
      return row?.enabled === 1;
    } catch (_) {
      return false;
    }
  }

  function lockFor(domain) {
    const expected = PHASE04_RETIREMENT_LOCKS[String(domain || '').toUpperCase()];
    if (!expected) return null;
    try {
      return dialect.prepare(`
        SELECT authority_key, canonical_target, status, retired_at, reason
        FROM authority_retirement_locks
        WHERE authority_key = ?
      `).get(expected.authorityKey) || null;
    } catch (_) {
      return null;
    }
  }

  function enforced(domain) {
    if (!cutoverEnabled()) return false;
    const expected = PHASE04_RETIREMENT_LOCKS[String(domain || '').toUpperCase()];
    if (!expected) return false;
    const lock = lockFor(domain);
    return lock?.status === 'RETIRED' && lock.canonical_target === expected.canonicalTarget;
  }

  function status() {
    const enabled = cutoverEnabled();
    return Object.fromEntries(Object.keys(PHASE04_RETIREMENT_LOCKS).map((domain) => {
      const lock = lockFor(domain);
      return [domain, {
        cutoverEnabled: enabled,
        lock: lock || null,
        enforced: enabled
          && lock?.status === 'RETIRED'
          && lock.canonical_target === PHASE04_RETIREMENT_LOCKS[domain].canonicalTarget,
      }];
    }));
  }

  return { cutoverEnabled, lockFor, enforced, status };
}
