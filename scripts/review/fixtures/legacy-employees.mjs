// Disposable legacy employee compatibility fixtures.
//
// The browser application still owns several established Workshop workflows
// through its full-state `employees` collection.  Review identities are
// canonical platform users, so they do not automatically populate that legacy
// collection.  Seed a small, fictional workforce so a fresh review database
// has the same safe full-state shape as a real application database.

'use strict';

const EMPLOYEES = [
  ['sysadmin', 'Review System Administrator', 'System Administration', 'الإدارة'],
  ['workshop_manager', 'Review Workshop Manager', 'Workshop Manager', 'الورشة'],
  ['ops_coordinator', 'Review Operations Coordinator', 'Operations Coordinator', 'العمليات'],
  ['warehouse_operator', 'Review Warehouse Operator', 'Warehouse Operator', 'المخزن'],
  ['production_operator', 'Review Production Operator', 'Production Operator', 'الإنتاج'],
  ['quality_reviewer', 'Review Quality Reviewer', 'Quality Reviewer', 'الجودة'],
];

export function seedLegacyEmployeeFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  const timestamp = now || new Date().toISOString();
  const upsert = dialect.prepare(`
    INSERT INTO collections (collection, id, data) VALUES ('employees', ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data
  `);

  for (const [key, name, position, department] of EMPLOYEES) {
    const id = `usr_review_${key}`;
    upsert.run(id, JSON.stringify({
      id,
      name,
      email: `review.${key}@review.invalid`,
      position,
      department,
      roleId: `review.${key}`,
      tenantId,
      companyId,
      branchId,
      isActive: true,
      salary: 0,
      prevAdvance: 0,
      records: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      source: 'disposable-review-fixture',
    }));
  }

  return {
    summary: {
      employeesCreated: EMPLOYEES.length,
      collection: 'employees',
      tenantId,
      companyId,
      branchId,
    },
  };
}

export default seedLegacyEmployeeFixtures;
