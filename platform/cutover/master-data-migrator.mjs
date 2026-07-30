// Master-data migrator — Checkpoint I5B.
//
// Governed migration for Products, Materials, Parties, Suppliers, Warehouses,
// Locations, and Assets from staged legacy collections into canonical tables.

'use strict';

import crypto from 'node:crypto';
import { recordLineage } from './lineage.mjs';
import { quarantineRecord } from './quarantine.mjs';
import { getMappingRule } from './mapping-registry.mjs';
import { updateDomainProgress } from './batch-engine.mjs';

export function migrateMasterData(dialect, batchId, { actor = 'system', companyId = 'co_1781973993479_57h1z8' } = {}) {
  if (!batchId) throw new TypeError('migrateMasterData requires batchId');

  const now = new Date().toISOString();
  let migratedCount = 0;
  let mergedCount = 0;
  let quarantinedCount = 0;
  let skippedCount = 0;

  dialect.exec('BEGIN IMMEDIATE;');
  try {
    // -----------------------------------------------------------------------
    // 1. Departments -> organization_departments
    // -----------------------------------------------------------------------
    const depts = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection IN (\'omni.departments\', \'finance.departments\')').all();
    for (const d of depts) {
      let data = {};
      try { data = JSON.parse(d.data); } catch (_) {}
      const name = data.name || d.id;
      const deptId = `dept_${d.id}`;

      dialect.prepare(`
        INSERT INTO organization_departments (id, company_id, name, status, created_at)
        VALUES (?, ?, ?, 'active', ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(deptId, companyId, name, now);

      const hash = crypto.createHash('sha256').update(d.data).digest('hex');
      recordLineage(dialect, {
        batchId, companyId, sourceCollection: d.collection, sourceId: d.id, sourceHash: hash,
        destinationAuthority: 'ORGANIZATIONS', destinationTable: 'organization_departments', destinationId: deptId,
        actor
      });
      migratedCount++;
    }

    // -----------------------------------------------------------------------
    // 2. UOM Categories & UOMs
    // -----------------------------------------------------------------------
    const uomCats = [
      { id: 'cat_unit', name: 'unit' },
      { id: 'cat_discrete_package', name: 'discrete_package' },
      { id: 'cat_length', name: 'length' },
    ];
    for (const c of uomCats) {
      dialect.prepare(`
        INSERT INTO uom_categories (id, name, is_active, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(c.id, c.name, now, now);
    }

    const uomDefs = [
      { id: 'uom_piece', category_id: 'cat_unit', name: 'قطعة', symbol: 'pc', factor: 1 },
      { id: 'uom_sheet', category_id: 'cat_discrete_package', name: 'لوح', symbol: 'sheet', factor: 1 },
      { id: 'uom_box', category_id: 'cat_discrete_package', name: 'علبة', symbol: 'box', factor: 1 },
      { id: 'uom_roll', category_id: 'cat_discrete_package', name: 'رول', symbol: 'roll', factor: 1 },
      { id: 'uom_meter', category_id: 'cat_length', name: 'متر', symbol: 'm', factor: 1 },
    ];
    for (const u of uomDefs) {
      dialect.prepare(`
        INSERT INTO uoms (
          id, category_id, name, symbol, uom_type, factor, rounding, is_active,
          created_at, applies_to_purchase, applies_to_sales, updated_at
        ) VALUES (?, ?, ?, ?, 'reference', ?, 0.001, 1, ?, 1, 1, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, factor = excluded.factor
      `).run(u.id, u.category_id, u.name, u.symbol, u.factor, now, now);
    }

    // -----------------------------------------------------------------------
    // 3. Product Categories
    // -----------------------------------------------------------------------
    const prodCats = ['خام', 'تشطيب', 'كهربائي', 'طباعة'];
    for (const catName of prodCats) {
      const catId = `pcat_${crypto.createHash('md5').update(catName).digest('hex').substring(0, 8)}`;
      dialect.prepare(`
        INSERT INTO product_categories (
          id, company_id, name, name_ar, name_en, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar
      `).run(catId, companyId, catName, catName, catName, now, now);
    }

    // -----------------------------------------------------------------------
    // 4. Materials -> Product Templates & Variants (8 materials)
    // -----------------------------------------------------------------------
    const materials = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.materials\'').all();
    for (const mat of materials) {
      let data = {};
      try { data = JSON.parse(mat.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(mat.data).digest('hex');

      const uomRule = getMappingRule(dialect, 'UOM', data.unit);
      if (!uomRule) {
        quarantineRecord(dialect, {
          batchId, companyId, sourceCollection: 'omni.materials', sourceId: mat.id, sourceHash: hash,
          sourcePayload: mat.data, domain: 'MASTER_DATA', reasonCode: 'unknown_uom',
          reasonDetail: `Material ${mat.id} has unknown UOM '${data.unit}'`
        });
        quarantinedCount++;
        continue;
      }

      const uomId = `uom_${uomRule.destination_key}`;
      const catName = data.category || 'عام';
      const catId = `pcat_${crypto.createHash('md5').update(catName).digest('hex').substring(0, 8)}`;

      // Insert product_template
      dialect.prepare(`
        INSERT INTO product_templates (
          id, company_id, name, name_ar, name_en, code, type, category_id, uom_id,
          purchase_uom_id, list_price, standard_price, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'consu', ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name_ar = excluded.name_ar,
          standard_price = excluded.standard_price,
          updated_at = excluded.updated_at
      `).run(
        mat.id, companyId, data.name, data.name, data.name, mat.id,
        catId, uomId, uomId, (data.cost || 0) * 1.2, data.cost || 0, now, now
      );

      // Insert product_variant
      const variantId = `var_${mat.id}`;
      const sku = `SKU-${mat.id.toUpperCase().replace('MAT_', '')}`;
      dialect.prepare(`
        INSERT INTO product_variants (
          id, template_id, company_id, sku, name, standard_price, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, standard_price = excluded.standard_price
      `).run(variantId, mat.id, companyId, sku, data.name, data.cost || 0, now, now);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.materials', sourceId: mat.id, sourceHash: hash,
        destinationAuthority: 'PRODUCTS', destinationTable: 'product_templates', destinationId: mat.id,
        actor
      });
      migratedCount++;
    }

    // -----------------------------------------------------------------------
    // 5. Suppliers -> Parties & Roles (6 suppliers)
    // -----------------------------------------------------------------------
    const suppliers = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.suppliers\'').all();
    for (const sup of suppliers) {
      let data = {};
      try { data = JSON.parse(sup.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(sup.data).digest('hex');

      dialect.prepare(`
        INSERT INTO parties (
          id, company_id, is_company, name, legal_name, phone, status, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, updated_at = excluded.updated_at
      `).run(sup.id, companyId, data.name, data.name, data.phone || null, now, now);

      // Party role
      const roleId = `pr_${sup.id}_supplier`;
      dialect.prepare(`
        INSERT INTO party_roles (id, party_id, role, company_id, created_at)
        VALUES (?, ?, 'supplier', ?, ?)
        ON CONFLICT(id) DO UPDATE SET role = 'supplier'
      `).run(roleId, sup.id, companyId, now);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.suppliers', sourceId: sup.id, sourceHash: hash,
        destinationAuthority: 'PARTIES', destinationTable: 'parties', destinationId: sup.id,
        actor
      });
      migratedCount++;
    }

    // Quarantine cust_demo
    const custDemo = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'finance.customers\' AND id = \'cust_demo\'').get();
    if (custDemo) {
      const hash = crypto.createHash('sha256').update(custDemo.data).digest('hex');
      quarantineRecord(dialect, {
        batchId, companyId, sourceCollection: 'finance.customers', sourceId: 'cust_demo',
        sourceHash: hash, sourcePayload: custDemo.data, domain: 'MASTER_DATA',
        reasonCode: 'legacy_demo_record', reasonDetail: 'Quarantined demo customer record cust_demo',
        severity: 'non_blocking', proposedResolution: 'Exclude from production migration'
      });
      quarantinedCount++;
    }

    // -----------------------------------------------------------------------
    // 6. Warehouses & Locations
    // -----------------------------------------------------------------------
    // Warehouse: MAIN_WORKSHOP
    const whRow = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.warehouses\' AND id = \'MAIN_WORKSHOP\'').get();
    if (whRow) {
      let data = {};
      try { data = JSON.parse(whRow.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(whRow.data).digest('hex');

      dialect.prepare(`
        INSERT INTO warehouses (
          id, company_id, name, code, is_active, is_default, warehouse_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 1, 'manufacturing', ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
      `).run(whRow.id, companyId, data.nameAr || 'الورشة الرئيسية', 'MAIN_WORKSHOP', now, now);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.warehouses', sourceId: whRow.id, sourceHash: hash,
        destinationAuthority: 'WAREHOUSES', destinationTable: 'warehouses', destinationId: whRow.id,
        actor
      });
      migratedCount++;
    }

    // Physical Stock Locations from omni.storageLocations (LOC_MAIN, MAIN_STOCK, LOC_WIP)
    const storageLocs = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.storageLocations\'').all();
    for (const sl of storageLocs) {
      let data = {};
      try { data = JSON.parse(sl.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(sl.data).digest('hex');

      dialect.prepare(`
        INSERT INTO stock_locations (
          id, company_id, warehouse_id, name, complete_name, usage, is_scrap, is_active, created_at, updated_at
        ) VALUES (?, ?, 'MAIN_WORKSHOP', ?, ?, ?, 0, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
      `).run(sl.id, companyId, data.nameAr || sl.id, `MAIN_WORKSHOP/${data.nameAr || sl.id}`, data.type || 'internal', now, now);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.storageLocations', sourceId: sl.id, sourceHash: hash,
        destinationAuthority: 'LOCATIONS', destinationTable: 'stock_locations', destinationId: sl.id,
        actor
      });
      migratedCount++;
    }

    // Virtual locations from legacy locations table
    const legacyLocs = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'locations\'').all();
    for (const ll of legacyLocs) {
      let data = {};
      try { data = JSON.parse(ll.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(ll.data).digest('hex');

      if (ll.id === 'LOC_MAIN') {
        // Quarantine second conflicting LOC_MAIN from legacy locations
        quarantineRecord(dialect, {
          batchId, companyId, sourceCollection: 'locations', sourceId: ll.id, sourceHash: hash,
          sourcePayload: ll.data, domain: 'MASTER_DATA', reasonCode: 'quarantined_duplicate_location_definition',
          reasonDetail: 'Conflicting legacy locations/LOC_MAIN definition quarantined; omni.storageLocations/LOC_MAIN selected as canonical',
          severity: 'non_blocking', selectedCanonicalReplacement: 'omni.storageLocations/LOC_MAIN'
        });
        quarantinedCount++;
      } else if (ll.id === 'LOC_WIP') {
        // Merged with existing LOC_WIP from omni.storageLocations
        mergedCount++;
      } else {
        // Virtual locations (LOC_SCRAP, LOC_SUPPLIERS, etc.)
        dialect.prepare(`
          INSERT INTO stock_locations (
            id, company_id, warehouse_id, name, complete_name, usage, is_scrap, is_active, created_at, updated_at
          ) VALUES (?, ?, 'MAIN_WORKSHOP', ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
        `).run(
          ll.id, companyId, data.name || ll.id, `MAIN_WORKSHOP/${data.name || ll.id}`,
          data.type || 'inventory', ll.id === 'LOC_SCRAP' ? 1 : 0, now, now
        );

        recordLineage(dialect, {
          batchId, companyId, sourceCollection: 'locations', sourceId: ll.id, sourceHash: hash,
          destinationAuthority: 'LOCATIONS', destinationTable: 'stock_locations', destinationId: ll.id,
          actor
        });
        migratedCount++;
      }
    }

    // -----------------------------------------------------------------------
    // 7. Asset Categories & Machines/Equipment -> Assets
    // -----------------------------------------------------------------------
    const assetCats = [
      { id: 'acat_machine', name: 'آلات ومكائن', code: 'MACH' },
      { id: 'acat_equipment', name: 'معدات وأدوات', code: 'EQUIP' },
    ];
    for (const ac of assetCats) {
      dialect.prepare(`
        INSERT INTO asset_categories (
          id, company_id, code, name_ar, name_en, depreciation_method, useful_life_months, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'straight_line', 60, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar
      `).run(ac.id, companyId, ac.code, ac.name, ac.name, now, now);
    }

    const machines = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.machines\'').all();
    for (const m of machines) {
      let data = {};
      try { data = JSON.parse(m.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(m.data).digest('hex');
      const cost = data.purchaseCost || data.cost || 0;

      dialect.prepare(`
        INSERT INTO assets (
          id, company_id, category_id, asset_number, name_ar, name_en, equipment_class,
          acquisition_cost, book_value, useful_life_months, depreciation_method, state, created_at, updated_at
        ) VALUES (?, ?, 'acat_machine', ?, ?, ?, 'machine', ?, ?, 60, 'straight_line', 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar, updated_at = excluded.updated_at
      `).run(m.id, companyId, m.id, data.name || m.id, data.name || m.id, cost, cost, now, now);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.machines', sourceId: m.id, sourceHash: hash,
        destinationAuthority: 'ASSETS', destinationTable: 'assets', destinationId: m.id,
        actor
      });
      migratedCount++;
    }

    const equipment = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.equipment\'').all();
    for (const eq of equipment) {
      let data = {};
      try { data = JSON.parse(eq.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(eq.data).digest('hex');
      const cost = data.cost || data.purchaseCost || 0;

      dialect.prepare(`
        INSERT INTO assets (
          id, company_id, category_id, asset_number, name_ar, name_en, equipment_class,
          acquisition_cost, book_value, useful_life_months, depreciation_method, state, created_at, updated_at
        ) VALUES (?, ?, 'acat_equipment', ?, ?, ?, 'equipment', ?, ?, 60, 'straight_line', 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar, updated_at = excluded.updated_at
      `).run(eq.id, companyId, eq.id, data.name || eq.id, data.name || eq.id, cost, cost, now, now);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.equipment', sourceId: eq.id, sourceHash: hash,
        destinationAuthority: 'ASSETS', destinationTable: 'assets', destinationId: eq.id,
        actor
      });
      migratedCount++;
    }

    // Update domain progress for MASTER_DATA
    updateDomainProgress(dialect, batchId, 'MASTER_DATA', {
      state: 'migrated',
      migrated_count: migratedCount,
      merged_count: mergedCount,
      quarantined_count: quarantinedCount,
      skipped_count: skippedCount,
    });

    dialect.exec('COMMIT;');

    return {
      domain: 'MASTER_DATA',
      migratedCount,
      mergedCount,
      quarantinedCount,
      skippedCount,
    };
  } catch (err) {
    dialect.exec('ROLLBACK;');
    throw err;
  }
}
