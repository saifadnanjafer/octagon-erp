// 060_subcontract_and_cross_domain_closure.mjs — Cross-Domain Governance, Licensing & Module Control Closure (Checkpoint E4).

const MODULE_ID = 'platform.kernel';
const migrationIdSelf = '060_subcontract_and_cross_domain_closure';

const ALL_NEW_MODULES = [
  'operations_engineering',
  'operations_mrp',
  'operations_manufacturing',
  'operations_quality',
  'assets_management',
  'operations_maintenance',
  'fleet_telematics',
];

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.39.0',
  parent: '059_fleet_and_telematics',
  dependsOn: ['059_fleet_and_telematics'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Control plane closure and module licensing registration across all Checkpoint D and E domains.',

  up(db) {
    const now = new Date().toISOString();

    const insertLicense = db.prepare(`
      INSERT INTO platform_module_licenses (
        id, module_id, company_id, plan, package_status, license_key_prefix, seats, features, valid_from, valid_until, version, created_at, updated_at, updated_by
      ) VALUES (?, ?, 'default', 'enterprise', 'active', ?, 9999, '[]', ?, '2099-12-31T23:59:59Z', 1, ?, ?, 'usr_system')
      ON CONFLICT(module_id, company_id) DO NOTHING
    `);

    for (const moduleId of ALL_NEW_MODULES) {
      insertLicense.run(`lic_${moduleId}_global`, moduleId, `key_${moduleId}`, now, now, now);
    }
  },

  down(db) {
    for (const moduleId of ALL_NEW_MODULES) {
      db.prepare('DELETE FROM platform_module_licenses WHERE module_id = ?').run(moduleId);
    }
  },
};
