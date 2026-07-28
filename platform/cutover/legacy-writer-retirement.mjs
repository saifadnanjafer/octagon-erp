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

// Checkpoint F: the Checkpoint D/E domains shipped a canonical backend but no
// retirement lock definition, so there was no mechanism by which their legacy
// writers could ever be retired — `enforced()` returned false for an unknown
// domain and would have kept doing so forever. Declaring them here does not
// enable enforcement (that still needs phase04.canonical_cutover plus a RETIRED
// lock row); it makes them lockable and reportable.
export const CHECKPOINT_DE_RETIREMENT_LOCKS = Object.freeze({
  PROJECT: {
    authorityKey: 'PROJECT_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'operations_projects',
  },
  ENGINEERING: {
    authorityKey: 'ENGINEERING_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'operations_engineering',
  },
  MANUFACTURING: {
    authorityKey: 'MANUFACTURING_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'operations_manufacturing',
  },
  QUALITY: {
    authorityKey: 'QUALITY_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'operations_quality',
  },
  ASSET: {
    authorityKey: 'ASSET_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'assets_management',
  },
  MAINTENANCE: {
    authorityKey: 'MAINTENANCE_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'operations_maintenance',
  },
  FLEET: {
    authorityKey: 'FLEET_CANONICAL_AUTHORITY_REQUIRED',
    canonicalTarget: 'fleet_telematics',
  },
});

// Every domain the guard knows how to retire. PHASE04_RETIREMENT_LOCKS is kept
// as a separate named export because existing Phase 04 tests assert against it
// exactly.
export const RETIREMENT_LOCKS = Object.freeze({
  ...PHASE04_RETIREMENT_LOCKS,
  ...CHECKPOINT_DE_RETIREMENT_LOCKS,
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
    const expected = RETIREMENT_LOCKS[String(domain || '').toUpperCase()];
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
    const expected = RETIREMENT_LOCKS[String(domain || '').toUpperCase()];
    if (!expected) return false;
    const lock = lockFor(domain);
    return lock?.status === 'RETIRED' && lock.canonical_target === expected.canonicalTarget;
  }

  function status() {
    const enabled = cutoverEnabled();
    return Object.fromEntries(Object.keys(RETIREMENT_LOCKS).map((domain) => {
      const lock = lockFor(domain);
      return [domain, {
        cutoverEnabled: enabled,
        lock: lock || null,
        enforced: enabled
          && lock?.status === 'RETIRED'
          && lock.canonical_target === RETIREMENT_LOCKS[domain].canonicalTarget,
      }];
    }));
  }

  return { cutoverEnabled, lockFor, enforced, status };
}
