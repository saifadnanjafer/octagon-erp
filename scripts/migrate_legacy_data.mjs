// Phase 04 disposable legacy migration.
//
// This program is intentionally fail-closed:
// - it copies the source database before opening any writable handle;
// - it never invents reservation lineage or a stock-opening GL policy;
// - it records stable source mappings and quarantines unresolved facts;
// - it reports BLOCKED when a closure reconciliation cannot be proved.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { runMigrations } from '../database/migration-runner/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = path.join(PROJECT_ROOT, 'database.db');

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function stableId(prefix, sourceCollection, sourceId) {
  return `${prefix}_${sha256Buffer(`${sourceCollection}\0${sourceId}`).slice(0, 24)}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sourceHash(value) {
  return sha256Buffer(canonicalJson(value));
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function readCollection(db, collection, quarantineMalformed = null) {
  if (!tableExists(db, 'collections')) return [];
  const rows = db.prepare('SELECT id, data FROM collections WHERE collection = ? ORDER BY id').all(collection);
  const parsed = [];
  for (const row of rows) {
    try {
      parsed.push({ id: row.id, data: JSON.parse(row.data), raw: row.data });
    } catch (error) {
      quarantineMalformed?.({
        sourceCollection: collection,
        sourceId: row.id,
        payload: row.data,
        reasonCode: 'MALFORMED_SOURCE_JSON',
        reasonDetail: error.message,
      });
    }
  }
  return parsed;
}

function readMetadata(db, key, fallback, quarantineMalformed = null) {
  if (!tableExists(db, 'metadata')) return fallback;
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch (error) {
    quarantineMalformed?.({
      sourceCollection: `metadata:${key}`,
      sourceId: key,
      payload: row.value,
      reasonCode: 'MALFORMED_SOURCE_JSON',
      reasonDetail: error.message,
    });
    return fallback;
  }
}

function normalizeWorkStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['done', 'complete', 'completed', 'closed', 'مكتمل'].includes(status)) return 'done';
  if (['progress', 'in_progress', 'doing', 'active', 'started', 'قيد التنفيذ'].includes(status)) return 'in_progress';
  if (['blocked', 'hold', 'on_hold', 'معلق'].includes(status)) return 'blocked';
  if (['cancel', 'cancelled', 'canceled', 'ملغي'].includes(status)) return 'cancelled';
  return 'todo';
}

function normalizeWorkPriority(value) {
  const priority = String(value || '').toLowerCase();
  if (['critical', 'urgent', 'حرج', 'عاجل'].includes(priority)) return 'urgent';
  if (['high', 'عالي'].includes(priority)) return 'high';
  if (['low', 'منخفض'].includes(priority)) return 'low';
  return 'medium';
}

function flattenTaskManager(taskManager) {
  const rows = [];
  for (const space of taskManager?.spaces || []) {
    for (const department of space.departments || []) {
      for (const section of department.sections || []) {
        for (const taskType of section.taskTypes || []) {
          for (const task of taskType.tasks || []) {
            rows.push({
              ...task,
              _legacyHierarchy: {
                spaceId: space.id || '',
                space: space.name || '',
                departmentId: department.id || '',
                department: department.name || '',
                sectionId: section.id || '',
                section: section.name || '',
                taskTypeId: taskType.id || '',
                taskType: taskType.name || '',
              },
            });
          }
        }
      }
    }
  }
  return rows;
}

function inferCompanyId(db, warehouses, explicitCompanyId) {
  if (explicitCompanyId) {
    const company = db.prepare("SELECT id FROM platform_companies WHERE id = ? AND status = 'active'").get(explicitCompanyId);
    if (!company) throw new Error(`Explicit migration company is not active: ${explicitCompanyId}`);
    return { companyId: company.id, method: 'explicit option' };
  }
  const warehouseCompanyIds = [...new Set(
    warehouses
      .map(({ data }) => data.companyId || data.company_id)
      .filter(Boolean),
  )];
  if (warehouseCompanyIds.length === 1) {
    const company = db.prepare("SELECT id FROM platform_companies WHERE id = ? AND status = 'active'").get(warehouseCompanyIds[0]);
    if (company) return { companyId: company.id, method: 'single legacy warehouse companyId' };
  }
  const companies = db.prepare("SELECT id FROM platform_companies WHERE status = 'active' ORDER BY id").all();
  if (companies.length === 1) return { companyId: companies[0].id, method: 'single active canonical company' };
  throw new Error('Legacy company scope is ambiguous; pass --company-id without modifying the source database');
}

function insertSourceMap(db, {
  sourceCollection,
  sourceId,
  value,
  targetEntity,
  targetId,
  now,
}) {
  const hash = sourceHash(value);
  const current = db.prepare(`
    SELECT source_sha256, target_id FROM phase04_legacy_source_map
    WHERE source_collection = ? AND source_id = ? AND target_entity = ?
  `).get(sourceCollection, sourceId, targetEntity);
  if (current) {
    if (current.source_sha256 !== hash || current.target_id !== targetId) {
      throw new Error(`SOURCE_CHANGED_AFTER_MAPPING:${sourceCollection}:${sourceId}:${targetEntity}`);
    }
    return false;
  }
  db.prepare(`
    INSERT INTO phase04_legacy_source_map (
      source_collection, source_id, source_sha256,
      target_entity, target_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(sourceCollection, sourceId, hash, targetEntity, targetId, now);
  return true;
}

function createQuarantineWriter(db, now, counters) {
  return ({
    sourceCollection,
    sourceId,
    payload,
    reasonCode,
    reasonDetail,
  }) => {
    const serialized = typeof payload === 'string' ? payload : canonicalJson(payload);
    const hash = sha256Buffer(serialized);
    const info = db.prepare(`
      INSERT INTO phase04_legacy_quarantine (
        id, source_collection, source_id, source_sha256,
        reason_code, reason_detail, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
      ON CONFLICT(source_collection, source_id, reason_code) DO NOTHING
    `).run(
      stableId('p04q', `${sourceCollection}:${reasonCode}`, sourceId),
      sourceCollection,
      sourceId,
      hash,
      reasonCode,
      reasonDetail,
      serialized,
      now,
    );
    if (info.changes) counters.quarantined += 1;
  };
}

function migrateParties(db, { companyId, customers, suppliers, now, counters }) {
  const migrate = (row, role, collection) => {
    const value = row.data;
    const name = String(value.name || value.companyName || '').trim();
    if (!name) throw new Error(`Party name is missing: ${collection}:${row.id}`);
    const partyId = String(row.id);
    db.prepare(`
      INSERT INTO parties (
        id, company_id, is_company, name, legal_name, tax_id,
        registration_number, status, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      partyId,
      companyId,
      name,
      String(value.legalName || value.companyName || ''),
      String(value.taxId || ''),
      String(value.registrationNumber || ''),
      value.createdAt || now,
      now,
    );
    db.prepare(`
      INSERT INTO party_roles (id, party_id, role, company_id, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(party_id, role, company_id) DO NOTHING
    `).run(stableId('prole', `${collection}:${role}`, row.id), partyId, role, companyId, now);
    const contactName = String(value.contact || value.contactName || name).trim();
    const phone = String(value.phone || '').trim();
    const email = String(value.email || '').trim();
    if (phone || email || value.contact) {
      db.prepare(`
        INSERT INTO contacts (id, party_id, name, email, phone, job_title, is_primary, created_at)
        VALUES (?, ?, ?, ?, ?, '', 1, ?) ON CONFLICT(id) DO NOTHING
      `).run(stableId('contact', collection, row.id), partyId, contactName, email, phone, now);
    }
    insertSourceMap(db, {
      sourceCollection: collection,
      sourceId: row.id,
      value,
      targetEntity: 'party',
      targetId: partyId,
      now,
    });
    counters.parties += 1;
  };
  customers.forEach((row) => migrate(row, 'customer', 'finance.customers'));
  suppliers.forEach((row) => migrate(row, 'supplier', 'omni.suppliers'));
}

function migrateWarehouseAndLocations(db, {
  companyId,
  warehouses,
  locations,
  now,
  counters,
}) {
  for (const row of warehouses) {
    const value = row.data;
    const warehouseId = String(row.id);
    db.prepare(`
      INSERT INTO warehouses (
        id, company_id, name, code, view_location_id, lot_stock_id,
        input_location_id, output_location_id, is_active, created_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 1, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      warehouseId,
      companyId,
      value.nameAr || value.nameEn || value.name || warehouseId,
      value.code || warehouseId,
      value.createdAt || now,
    );
    insertSourceMap(db, {
      sourceCollection: 'omni.warehouses',
      sourceId: row.id,
      value,
      targetEntity: 'warehouse',
      targetId: warehouseId,
      now,
    });
    counters.warehouses += 1;
  }

  const warehouseId = warehouses.length === 1 ? String(warehouses[0].id) : null;
  for (const row of locations) {
    const value = row.data;
    const usage = value.type === 'inventory' ? 'inventory'
      : value.type === 'supplier' ? 'supplier'
        : value.type === 'customer' ? 'customer'
          : value.type === 'transit' ? 'transit'
            : 'internal';
    const locationWarehouse = ['internal', 'transit'].includes(usage) ? warehouseId : null;
    db.prepare(`
      INSERT INTO stock_locations (
        id, company_id, warehouse_id, parent_id, name,
        complete_name, usage, is_scrap, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      String(row.id),
      companyId,
      locationWarehouse,
      value.parent_id || null,
      value.name || String(row.id),
      value.name || String(row.id),
      usage,
      value.type === 'inventory' ? 1 : 0,
      value.created_at || now,
    );
    insertSourceMap(db, {
      sourceCollection: 'locations',
      sourceId: row.id,
      value,
      targetEntity: 'stock_location',
      targetId: String(row.id),
      now,
    });
    counters.locations += 1;
  }
}

function migrateProductsAndPrices(db, {
  companyId,
  materials,
  suppliers,
  now,
  counters,
  quarantine,
}) {
  const categoryByName = new Map();
  const uomByName = new Map();
  const uomCategoryId = 'uomcat_legacy_units';
  db.prepare(`
    INSERT INTO uom_categories (id, name, created_at)
    VALUES (?, 'Legacy units / وحدات قديمة', ?) ON CONFLICT(id) DO NOTHING
  `).run(uomCategoryId, now);

  for (const row of materials) {
    const value = row.data;
    const name = String(value.name || '').trim();
    if (!name) {
      quarantine({
        sourceCollection: 'omni.materials',
        sourceId: row.id,
        payload: value,
        reasonCode: 'PRODUCT_NAME_MISSING',
        reasonDetail: 'Canonical product creation requires a name',
      });
      continue;
    }
    const uomName = String(value.unit || 'وحدة').trim();
    if (!uomByName.has(uomName)) {
      const uomId = stableId('uomlegacy', 'uom', uomName);
      db.prepare(`
        INSERT INTO uoms (
          id, category_id, name, symbol, uom_type, factor,
          rounding, is_active, created_at
        ) VALUES (?, ?, ?, ?, 'reference', 1, 0.001, 1, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(uomId, uomCategoryId, uomName, uomName, now);
      uomByName.set(uomName, uomId);
      counters.uoms += 1;
    }
    const categoryName = String(value.category || 'غير مصنف').trim();
    if (!categoryByName.has(categoryName)) {
      const categoryId = stableId('pcatlegacy', 'product-category', categoryName);
      db.prepare(`
        INSERT INTO product_categories (
          id, company_id, parent_id, name, code, costing_method,
          valuation_method, income_account_id, expense_account_id,
          stock_account_id, stock_input_account_id, stock_output_account_id, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'real_time', '', '', '', '', '', ?)
        ON CONFLICT(id) DO NOTHING
      `).run(
        categoryId,
        companyId,
        categoryName,
        `LEG-${sha256Buffer(categoryName).slice(0, 8).toUpperCase()}`,
        value.costingMethod === 'fifo' ? 'fifo' : 'avco',
        now,
      );
      categoryByName.set(categoryName, categoryId);
      counters.categories += 1;
    }
    const templateId = `ptpl_legacy_${row.id}`;
    const variantId = String(row.id);
    const sku = String(value.sku || value.code || row.id);
    const cost = Number(value.cost || 0);
    const price = Number(value.price || value.listPrice || 0);
    db.prepare(`
      INSERT INTO product_templates (
        id, company_id, name, code, type, category_id, uom_id,
        purchase_uom_id, list_price, standard_price, is_active, created_at
      ) VALUES (?, ?, ?, ?, 'storable', ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      templateId,
      companyId,
      name,
      sku,
      categoryByName.get(categoryName),
      uomByName.get(uomName),
      uomByName.get(uomName),
      price,
      cost,
      now,
    );
    db.prepare(`
      INSERT INTO product_variants (
        id, template_id, company_id, sku, name, variant_attributes,
        list_price_extra, standard_price, barcode, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 0, ?, ?, 1, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(variantId, templateId, companyId, sku, name, cost, String(value.barcode || ''), now);
    if (value.barcode) {
      try {
        db.prepare(`
          INSERT INTO product_barcodes (
            id, variant_id, barcode, barcode_type, is_primary, created_at
          ) VALUES (?, ?, ?, 'legacy', 1, ?) ON CONFLICT(id) DO NOTHING
        `).run(stableId('pbarlegacy', 'omni.materials', row.id), variantId, String(value.barcode), now);
        counters.barcodes += 1;
      } catch (error) {
        quarantine({
          sourceCollection: 'omni.materials',
          sourceId: row.id,
          payload: value,
          reasonCode: 'DUPLICATE_BARCODE',
          reasonDetail: error.message,
        });
      }
    }
    insertSourceMap(db, {
      sourceCollection: 'omni.materials',
      sourceId: row.id,
      value,
      targetEntity: 'product_variant',
      targetId: variantId,
      now,
    });
    counters.products += 1;

    const stock = Number(value.stock || 0);
    const reserved = Number(value.reservedQty ?? value.reserved ?? 0);
    const reservationLines = Array.isArray(value.reservations) ? value.reservations : [];
    const movementLines = Array.isArray(value.movements) ? value.movements : [];
    if (reserved > 0 && reservationLines.length === 0) {
      quarantine({
        sourceCollection: 'omni.materials',
        sourceId: row.id,
        payload: { reserved, reservations: reservationLines },
        reasonCode: 'RESERVATION_LINEAGE_MISSING',
        reasonDetail: `${reserved} reserved units have no source document, location, event, or reservation row`,
      });
    }
    if (stock !== 0 && movementLines.length === 0) {
      quarantine({
        sourceCollection: 'omni.materials',
        sourceId: row.id,
        payload: { stock, cost, value: stock * cost, movements: movementLines },
        reasonCode: 'OPENING_STOCK_GL_POLICY_REQUIRED',
        reasonDetail: 'Stock exists without movement history or an approved opening-equity/account mapping; no stock or GL fact was invented',
      });
    }
  }

  for (const supplier of suppliers) {
    const catalog = Array.isArray(supplier.data.catalog) ? supplier.data.catalog : [];
    if (!catalog.length) continue;
    const priceListId = stableId('plistlegacy', 'omni.suppliers', supplier.id);
    db.prepare(`
      INSERT INTO price_lists (id, company_id, name, currency_id, is_active, created_at)
      VALUES (?, ?, ?, 'IQD', 1, ?) ON CONFLICT(id) DO NOTHING
    `).run(priceListId, companyId, `Legacy supplier: ${supplier.data.name || supplier.id}`, now);
    insertSourceMap(db, {
      sourceCollection: 'omni.suppliers',
      sourceId: supplier.id,
      value: supplier.data,
      targetEntity: 'price_list',
      targetId: priceListId,
      now,
    });
    counters.priceLists += 1;
    for (let index = 0; index < catalog.length; index += 1) {
      const item = catalog[index];
      const variant = db.prepare('SELECT id FROM product_variants WHERE id = ? AND company_id = ?').get(item.materialId, companyId);
      if (!variant || !Number.isFinite(Number(item.negotiatedPrice))) {
        quarantine({
          sourceCollection: `omni.suppliers:${supplier.id}:catalog`,
          sourceId: String(index),
          payload: item,
          reasonCode: 'SUPPLIER_PRICE_INVALID',
          reasonDetail: 'Supplier price requires a mapped product and numeric negotiatedPrice',
        });
        continue;
      }
      db.prepare(`
        INSERT INTO price_list_items (
          id, price_list_id, applied_on, category_id, template_id,
          variant_id, min_quantity, price_discount, fixed_price,
          valid_from, valid_to, created_at
        ) VALUES (?, ?, 'variant', NULL, NULL, ?, 0, 0, ?, NULL, NULL, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(
        stableId('plistitemlegacy', `omni.suppliers:${supplier.id}:catalog`, String(index)),
        priceListId,
        variant.id,
        Number(item.negotiatedPrice),
        now,
      );
      counters.priceItems += 1;
    }
  }
}

function migrateWorkItems(db, {
  companyId,
  taskManager,
  kanban,
  workOrders,
  now,
  counters,
}) {
  const sources = [
    ...flattenTaskManager(taskManager).map((data) => ({ collection: 'metadata:omni.taskManager', id: data.id, data, sourceType: 'task_manager' })),
    ...(kanban?.cards || []).map((data) => ({ collection: 'metadata:omni.kanban.cards', id: data.id, data, sourceType: 'kanban' })),
    ...workOrders.map((row) => ({ collection: 'omni.workOrders', id: row.id, data: row.data, sourceType: 'work_order' })),
  ].filter((row) => row.id);

  for (const source of sources) {
    const value = source.data;
    const workItemId = stableId('wilegacy', source.collection, source.id);
    const status = normalizeWorkStatus(value.status);
    const priority = normalizeWorkPriority(value.priority);
    const completedAt = status === 'done' ? (value.completedAt || value.completed_at || now) : null;
    const activity = value.activityLog || value.timeLogs || [];
    db.prepare(`
      INSERT INTO work_items (
        id, company_id, branch_id, department_id, title, description,
        source_type, source_id, source_line_id, parent_id, status, stage,
        priority, importance, assigned_user_id, assigned_team_id,
        start_date, due_date, completed_at, progress, estimated_hours,
        actual_hours, inactivity_timestamp, sla_due_at, checklist_json,
        attachments_json, comments_json, project_ref, work_order_ref,
        helpdesk_ref, qc_ref, maintenance_ref, version, created_at, updated_at
      ) VALUES (
        ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?,
        ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?
      ) ON CONFLICT(id) DO NOTHING
    `).run(
      workItemId,
      companyId,
      value.department || value._legacyHierarchy?.department || null,
      value.title || value.name || `Legacy item ${source.id}`,
      value.description || '',
      source.sourceType,
      source.id,
      status,
      value.columnId || value.stage || (status === 'done' ? 'done' : 'backlog'),
      priority,
      Number(value.importance || (priority === 'urgent' ? 5 : priority === 'high' ? 4 : 3)),
      value.assigneeId || value.employeeId || value.operatorId || null,
      value.startDate || value.startedAt || null,
      value.dueDate || null,
      completedAt,
      Number(value.progress || (status === 'done' ? 100 : 0)),
      Number(value.estimatedHours || 0) || Number(value.plannedMinutes || value.estimatedMinutes || 0) / 60,
      Number(value.actualHours || 0) || Number(value.actualMinutes || 0) / 60,
      value.updatedAt || value.createdAt || now,
      canonicalJson(value.checklist || value.subtasks || []),
      canonicalJson(value.attachments || []),
      canonicalJson(value.comments || activity || []),
      value.projectId || value.project_ref || null,
      source.sourceType === 'work_order' ? source.id : (value.workOrderId || null),
      value.qcRecordId || value.qc_ref || null,
      value.linkedEquipmentId || value.machineId || null,
      value.createdAt || now,
      value.updatedAt || now,
    );
    db.prepare(`
      INSERT INTO work_item_governance (
        work_item_id, company_id, stable_source_key, recurrence_rule,
        transparency_projection, archived_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(work_item_id) DO NOTHING
    `).run(
      workItemId,
      companyId,
      `${source.collection}:${source.id}`,
      canonicalJson(value.recurring || {}),
      canonicalJson({ legacyHierarchy: value._legacyHierarchy || null, source: value }),
      value.archivedAt || (value.archived ? now : null),
      value.createdAt || now,
      value.updatedAt || now,
    );
    insertSourceMap(db, {
      sourceCollection: source.collection,
      sourceId: source.id,
      value,
      targetEntity: 'work_item',
      targetId: workItemId,
      now,
    });
    counters.workItems += 1;
  }
}

function reconcile(db, {
  companyId,
  materials,
  customers,
  suppliers,
  workItemSourceCount,
}) {
  const sourceStock = materials.reduce((sum, row) => sum + Number(row.data.stock || 0), 0);
  const sourceReserved = materials.reduce((sum, row) => sum + Number(row.data.reservedQty ?? row.data.reserved ?? 0), 0);
  const sourceValuation = materials.reduce((sum, row) => sum + Number(row.data.stock || 0) * Number(row.data.cost || 0), 0);
  const canonicalStock = db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM stock_quants WHERE company_id = ?').get(companyId).n;
  const canonicalReserved = db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM stock_reservations WHERE company_id = ? AND status IN (\'reserved\',\'partially_reserved\')').get(companyId).n;
  const canonicalValuation = db.prepare('SELECT COALESCE(SUM(value),0) AS n FROM stock_valuation_facts WHERE company_id = ?').get(companyId).n;
  const stockGl = db.prepare(`
    SELECT COALESCE(SUM(ABS(line.debit)),0) AS debit
    FROM stock_accounting_links link
    JOIN finance_journal_lines line ON line.document_id = link.finance_document_id
    WHERE link.company_id = ?
  `).get(companyId).debit;
  const result = {
    parties: {
      source: customers.length + suppliers.length,
      canonical: db.prepare("SELECT COUNT(*) AS n FROM parties WHERE company_id = ?").get(companyId).n,
    },
    products: {
      source: materials.length,
      canonical: db.prepare("SELECT COUNT(*) AS n FROM product_variants WHERE company_id = ?").get(companyId).n,
    },
    workItems: {
      source: workItemSourceCount,
      canonical: db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE company_id = ? AND source_type IN ('task_manager','kanban','work_order')").get(companyId).n,
    },
    quantity: { source: sourceStock, canonical: Number(canonicalStock) },
    reservations: { source: sourceReserved, canonical: Number(canonicalReserved) },
    valuation: { source: sourceValuation, canonical: Number(canonicalValuation) },
    stockToGl: { sourceStockValue: sourceValuation, canonicalJournalDebit: Number(stockGl) },
  };
  result.parties.match = result.parties.source === result.parties.canonical;
  result.products.match = result.products.source === result.products.canonical;
  result.workItems.match = result.workItems.source === result.workItems.canonical;
  result.quantity.match = result.quantity.source === result.quantity.canonical;
  result.reservations.match = result.reservations.source === result.reservations.canonical;
  result.valuation.match = result.valuation.source === result.valuation.canonical;
  result.stockToGl.match = result.stockToGl.sourceStockValue === result.stockToGl.canonicalJournalDebit;
  return result;
}

export function migrateLegacyFacts(db, {
  companyId: explicitCompanyId = null,
  runId,
  sourceIdentity,
  disposablePath,
  disposableHashBefore,
} = {}) {
  const now = new Date().toISOString();
  const counters = {
    parties: 0,
    warehouses: 0,
    locations: 0,
    categories: 0,
    uoms: 0,
    products: 0,
    barcodes: 0,
    priceLists: 0,
    priceItems: 0,
    workItems: 0,
    quarantined: 0,
  };
  const quarantine = createQuarantineWriter(db, now, counters);
  const customers = readCollection(db, 'finance.customers', quarantine);
  const suppliers = readCollection(db, 'omni.suppliers', quarantine);
  const materials = readCollection(db, 'omni.materials', quarantine);
  const warehouses = readCollection(db, 'omni.warehouses', quarantine);
  const locations = readCollection(db, 'locations', quarantine);
  const workOrders = readCollection(db, 'omni.workOrders', quarantine);
  const taskManager = readMetadata(db, 'omni.taskManager', { spaces: [] }, quarantine);
  const kanban = readMetadata(db, 'omni.kanban', { cards: [] }, quarantine);
  const warehouseStock = readMetadata(db, 'omni.warehouseStock', {}, quarantine);
  const company = inferCompanyId(db, warehouses, explicitCompanyId);
  const workItemSourceCount = flattenTaskManager(taskManager).length + (kanban.cards || []).length + workOrders.length;
  const sourceCounts = {
    customers: customers.length,
    suppliers: suppliers.length,
    materials: materials.length,
    warehouses: warehouses.length,
    locations: locations.length,
    workOrders: workOrders.length,
    taskManagerTasks: flattenTaskManager(taskManager).length,
    kanbanCards: (kanban.cards || []).length,
  };

  db.prepare(`
    INSERT INTO phase04_legacy_migration_runs (
      id, source_path, source_sha256, source_size, source_modified_at,
      disposable_path, disposable_sha256_before, company_id, status,
      source_counts_json, result_json, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, '{}', ?, NULL)
    ON CONFLICT(id) DO NOTHING
  `).run(
    runId,
    sourceIdentity.path,
    sourceIdentity.sha256,
    sourceIdentity.size,
    sourceIdentity.modifiedAt,
    disposablePath,
    disposableHashBefore,
    company.companyId,
    canonicalJson(sourceCounts),
    now,
  );

  migrateParties(db, { companyId: company.companyId, customers, suppliers, now, counters });
  migrateWarehouseAndLocations(db, {
    companyId: company.companyId,
    warehouses,
    locations,
    now,
    counters,
  });
  migrateProductsAndPrices(db, {
    companyId: company.companyId,
    materials,
    suppliers,
    now,
    counters,
    quarantine,
  });
  migrateWorkItems(db, {
    companyId: company.companyId,
    taskManager,
    kanban,
    workOrders,
    now,
    counters,
  });

  for (const material of materials) {
    const expected = Number(material.data.stock || 0);
    const locationMap = warehouseStock?.[material.id] || {};
    const warehouseTotal = Object.values(locationMap).reduce((sum, value) => sum + Number(value || 0), 0);
    if (Object.keys(locationMap).length && Math.abs(expected - warehouseTotal) > 0.0000001) {
      quarantine({
        sourceCollection: 'metadata:omni.warehouseStock',
        sourceId: material.id,
        payload: { materialStock: expected, warehouseLocations: locationMap },
        reasonCode: 'SOURCE_QUANTITY_CONFLICT',
        reasonDetail: 'omni.materials stock does not match omni.warehouseStock',
      });
    }
  }

  const reconciliation = reconcile(db, {
    companyId: company.companyId,
    materials,
    customers,
    suppliers,
    workItemSourceCount,
  });
  const openQuarantine = db.prepare("SELECT COUNT(*) AS n FROM phase04_legacy_quarantine WHERE status = 'open'").get().n;
  const closureMatches = Object.values(reconciliation).every((item) => item.match);
  const status = closureMatches && openQuarantine === 0 ? 'passed' : 'blocked';
  const result = {
    status: status.toUpperCase(),
    company,
    counters,
    sourceCounts,
    reconciliation,
    openQuarantine,
  };
  db.prepare(`
    UPDATE phase04_legacy_migration_runs
    SET status = ?, result_json = ?, completed_at = ?
    WHERE id = ?
  `).run(status, canonicalJson(result), new Date().toISOString(), runId);
  return result;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') out.sourceDbPath = argv[++i];
    else if (argv[i] === '--target') out.targetDbPath = argv[++i];
    else if (argv[i] === '--company-id') out.companyId = argv[++i];
    else if (argv[i] === '--keep') out.keepDisposable = true;
  }
  return out;
}

export async function runDisposableMigration({
  sourceDbPath = DEFAULT_SOURCE,
  targetDbPath = null,
  companyId = null,
  keepDisposable = false,
} = {}) {
  const source = path.resolve(sourceDbPath);
  if (!fs.existsSync(source)) throw new Error(`Source database not found: ${source}`);
  const sourceStatBefore = fs.statSync(source);
  const sourceHashBefore = sha256File(source);
  const disposableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-migration-'));
  const target = path.resolve(targetDbPath || path.join(disposableRoot, 'database-disposable.db'));
  if (target === source) throw new Error('Disposable target must differ from the source database');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  const targetHashBefore = sha256File(target);
  if (targetHashBefore !== sourceHashBefore) throw new Error('Disposable copy hash mismatch');

  const sourceIdentity = {
    path: source,
    sha256: sourceHashBefore,
    size: sourceStatBefore.size,
    modifiedAt: sourceStatBefore.mtime.toISOString(),
  };
  const runId = `p04run_${crypto.randomUUID()}`;
  let result;
  let db;
  try {
    const migrationResult = await runMigrations({
      dbPath: target,
      direction: 'up',
      actor: 'phase04-disposable-migration',
    });
    db = new DatabaseSync(target);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db.exec('BEGIN IMMEDIATE;');
    try {
      result = migrateLegacyFacts(db, {
        companyId,
        runId,
        sourceIdentity,
        disposablePath: target,
        disposableHashBefore: targetHashBefore,
      });
      db.exec('COMMIT;');
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw error;
    }

    const firstCounts = {
      maps: db.prepare('SELECT COUNT(*) AS n FROM phase04_legacy_source_map').get().n,
      quarantine: db.prepare('SELECT COUNT(*) AS n FROM phase04_legacy_quarantine').get().n,
      parties: db.prepare('SELECT COUNT(*) AS n FROM parties WHERE company_id = ?').get(result.company.companyId).n,
      products: db.prepare('SELECT COUNT(*) AS n FROM product_variants WHERE company_id = ?').get(result.company.companyId).n,
      workItems: db.prepare('SELECT COUNT(*) AS n FROM work_items WHERE company_id = ?').get(result.company.companyId).n,
    };
    db.exec('BEGIN IMMEDIATE;');
    try {
      const rerun = migrateLegacyFacts(db, {
        companyId: result.company.companyId,
        runId,
        sourceIdentity,
        disposablePath: target,
        disposableHashBefore: targetHashBefore,
      });
      db.exec('COMMIT;');
      const secondCounts = {
        maps: db.prepare('SELECT COUNT(*) AS n FROM phase04_legacy_source_map').get().n,
        quarantine: db.prepare('SELECT COUNT(*) AS n FROM phase04_legacy_quarantine').get().n,
        parties: db.prepare('SELECT COUNT(*) AS n FROM parties WHERE company_id = ?').get(result.company.companyId).n,
        products: db.prepare('SELECT COUNT(*) AS n FROM product_variants WHERE company_id = ?').get(result.company.companyId).n,
        workItems: db.prepare('SELECT COUNT(*) AS n FROM work_items WHERE company_id = ?').get(result.company.companyId).n,
      };
      result.idempotentRerun = canonicalJson(firstCounts) === canonicalJson(secondCounts);
      result.rerun = rerun;
      result.rerunCounts = { first: firstCounts, second: secondCounts };
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw error;
    }

    db.exec('SAVEPOINT phase04_rollback_probe;');
    db.prepare(`
      INSERT INTO phase04_legacy_quarantine (
        id, source_collection, source_id, source_sha256, reason_code,
        reason_detail, payload_json, status, created_at
      ) VALUES ('phase04_rollback_probe', 'probe', 'probe', 'probe', 'PROBE', 'probe', '{}', 'open', ?)
    `).run(new Date().toISOString());
    db.exec('ROLLBACK TO phase04_rollback_probe; RELEASE phase04_rollback_probe;');
    result.rollbackVerified = !db.prepare("SELECT 1 FROM phase04_legacy_quarantine WHERE id = 'phase04_rollback_probe'").get();
    result.migrationsApplied = migrationResult.migrations;
    result.disposable = {
      path: target,
      sha256Before: targetHashBefore,
      sha256After: sha256File(target),
    };
  } finally {
    try { db?.close(); } catch (_) {}
  }

  const sourceHashAfter = sha256File(source);
  const sourceStatAfter = fs.statSync(source);
  result.source = {
    ...sourceIdentity,
    sha256After: sourceHashAfter,
    sizeAfter: sourceStatAfter.size,
    unchanged: sourceHashAfter === sourceHashBefore && sourceStatAfter.size === sourceStatBefore.size,
  };
  if (!result.source.unchanged) {
    result.status = 'BLOCKED';
    result.source.warning = 'Source database changed during the run; no unchanged-original claim is possible';
  }

  if (!keepDisposable && !targetDbPath) {
    fs.unlinkSync(target);
    fs.rmdirSync(disposableRoot);
    result.disposable.removed = true;
  } else {
    result.disposable.removed = false;
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runDisposableMigration(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'PASSED' ? 0 : 2;
}
