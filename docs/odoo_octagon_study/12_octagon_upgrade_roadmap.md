# 12 — Octagon V5 Upgrade Roadmap
## From Workshop App to Professional ERP

---

## 🎯 Vision

> Octagon V5 = Octagon's workshop DNA + Odoo-level data maturity

**Keep:** Arabic-first, offline-first, single-file simplicity, workshop focus
**Add:** Audit trails, FK relations, state machines, stock engine, basic accounting

---

## Sprint Plan

### Sprint A — Study (✅ Current)
**Duration:** 1 week
**Deliverable:** This documentation library

- [x] Analyze Odoo 19 source code
- [x] Document architectural patterns
- [x] Create mapping matrix
- [x] Design service layer
- [x] Write safety rules

### Sprint B — Data Foundation
**Duration:** 1-2 weeks
**Deliverable:** Enhanced `database.json` schema

**Tasks:**
1. Add audit fields to current records under `employees[]`, `finance.*`, and `omni.*`
2. Keep current nested data shape; do not flatten `finance` or `omni`
3. Create `departments[]` from `finance.departments[]`, `omni.departments[]`, and employee department strings
4. Create `locations[]` with basic workshop locations
5. Create `users[]` with one system admin seed user
6. Validate with `node --check app.js` and `node scripts/migrate-v5-data-foundation.mjs --check`

**Migration Script:**
```javascript
function migrateToV5Schema(db) {
    // 1. Add audit fields to existing real collections
    const collections = [
        db.employees,
        db.finance?.accounts,
        db.finance?.departments,
        db.finance?.transactions,
        db.omni?.kanban?.cards,
        db.omni?.machines,
        db.omni?.materials,
        db.omni?.opPacks,
        db.omni?.qcRecords,
        db.omni?.departments,
    ].filter(Array.isArray);

    collections.forEach(records => records.forEach(addAuditFields));

    // 2. Extract departments from current nested data
    const deptNames = [...new Set([
        ...(db.finance?.departments || []).map(d => d.name),
        ...(db.omni?.departments || []).map(d => d.name),
        ...(db.employees || []).map(e => e.department),
    ].filter(Boolean))];
    db.departments = deptNames.map(name => ({
        id: generateId('DEPT'),
        name,
        is_active: true,
    }));

    // 3. Add V5 collections beside existing data; do not create top-level accounts[]
    db.locations = db.locations || [];
    db.quants = db.quants || [];
    db.stock_moves = db.stock_moves || [];

    db._schema_version = "5.0";
    return db;
}
```

### Sprint C — Service Layer
**Duration:** 2 weeks
**Deliverable:** `services/` directory with core helpers

**Files to create:**
```
octagon-erp/services/
├── auditService.js      ← createAuditEvent(), getAuditHistory()
├── stateService.js      ← changeState(), STATE_MACHINES config
├── stockService.js      ← createStockMove(), validateMove(), updateQuant()
├── permissionService.js ← checkPermission(), resolveGroups()
├── recordService.js     ← createRecord(), updateRecord() with auto-audit
└── index.js             ← Service registry & initialization
```

**Rule:** Services are standalone JS files. They do NOT modify `app.js`.
They are loaded via `<script>` tags BEFORE `app.js`.

### Sprint D — Inventory Module
**Duration:** 2-3 weeks
**Deliverable:** Stock location tree + movement tracking

**Tasks:**
1. Create location management page
2. Implement quant engine (real-time stock per location)
3. Build stock move form (receive, deliver, internal transfer)
4. Add material reservation for tasks
5. Inventory adjustment (count → reconcile)
6. Low-stock alerts based on reorder points

### Sprint E — Finance Module
**Duration:** 2-3 weeks
**Deliverable:** Basic double-entry ledger

**Tasks:**
1. Define chart of accounts (10-20 accounts for workshop)
2. Journal entry creation form
3. Auto-generated entries for: salary, material purchase, sales
4. Trial balance report
5. Simple P&L report
6. Hash chain for posted entries (tamper-proof)

### Sprint F — Permission Engine
**Duration:** 1-2 weeks
**Deliverable:** Group-based access control

**Tasks:**
1. Define groups: عامل, مشرف, مدير, محاسب, مدير النظام
2. Per-model CRUD permissions
3. Field-level visibility restrictions
4. UI enforcement (hide buttons/pages based on group)
5. Service-layer enforcement (reject unauthorized operations)

### Sprint G — Integration & Release
**Duration:** 2 weeks
**Deliverable:** Octagon V5.0 release

**Tasks:**
1. Data migration script (V4 → V5)
2. Full regression testing
3. Performance optimization
4. Documentation update
5. Backup/restore procedures
6. Release notes

---

## Effort Estimate

| Sprint | Effort | Dependencies |
|--------|--------|-------------|
| A (Study) | 1 week | None |
| B (Data) | 1-2 weeks | Sprint A |
| C (Services) | 2 weeks | Sprint B |
| D (Inventory) | 2-3 weeks | Sprint C |
| E (Finance) | 2-3 weeks | Sprint C |
| F (Permissions) | 1-2 weeks | Sprint C |
| G (Integration) | 2 weeks | D + E + F |
| **Total** | **~12-15 weeks** | |

Sprints D, E, F can run in parallel after Sprint C.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing UI | All new code in separate files |
| Data loss | Backup database.json before every migration |
| Over-engineering | Keep Octagon simplicity — no ORM, no framework |
| Scope creep | Follow this roadmap strictly, defer non-essential features |
| Performance | Monitor database.json size, consider IndexedDB at >10MB |

---

*Next: [13_service_layer_design.md](./13_service_layer_design.md)*
