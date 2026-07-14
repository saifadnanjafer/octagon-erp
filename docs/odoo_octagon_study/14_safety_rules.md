# 14 — Safety Rules & Migration Protocol
## Non-Negotiable Rules for Octagon V5 Development

---

## 🔒 Phase 0 Rules (ACTIVE NOW)

```
┌─────────────────────────────────────────────────────────────┐
│  RULE 1: DO NOT EDIT app.js                                 │
│  ──────────────────────                                     │
│  app.js is 820KB of working production code.                │
│  Any change risks breaking 40+ working pages.               │
│  New functionality goes in NEW files only.                   │
│                                                             │
│  RULE 2: DO NOT RESET database.json                         │
│  ──────────────────────────────                             │
│  400KB of real business data. Historical records.            │
│  Migrations must be ADDITIVE — add fields, don't remove.    │
│  Always backup before any migration script.                  │
│                                                             │
│  RULE 3: DO NOT COPY Odoo code                              │
│  ───────────────────────                                    │
│  Odoo is Python/PostgreSQL. Octagon is JS/JSON.             │
│  Copy PATTERNS, not code. Adapt to Octagon's DNA.           │
│                                                             │
│  RULE 4: DO NOT REWRITE working pages                       │
│  ────────────────────────────────                           │
│  If a page works, leave it. Migrate gradually.               │
│  New pages use service layer. Old pages keep working.        │
│                                                             │
│  RULE 5: STUDY FIRST, CODE LATER                            │
│  ────────────────────────────                               │
│  Sprint A = documentation only.                              │
│  Sprint B = schema design only.                              │
│  Sprint C = service layer (new files).                       │
│  Code changes to existing files start at Sprint D minimum.   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Pre-Change Checklist

Before ANY code change in Sprints C+:

- [ ] `copy database.json database.backup.json`
- [ ] Run `node --check app.js` (must pass)
- [ ] Run `node --check <new_file>.js` (must pass)
- [ ] Document what you're changing and why
- [ ] Test the change doesn't break existing pages
- [ ] Verify database.json is not corrupted after save

---

## 🔄 Migration Protocol

**Sprint B server guard:** because the current UI save payload only includes
`employees`, `finance`, `omni`, `config`, `selectedEmpIdx`, and `reportEmpIdx`,
`server.js` must preserve V5 top-level collections during `/api/db` POST when
the browser does not send those keys. This keeps `app.js` untouched while
preventing `departments[]`, `locations[]`, `audit_log[]`, and other V5
collections from being stripped on a normal save.

### Step 1: Backup
```powershell
Copy-Item database.json database.backup.$(Get-Date -Format 'yyyyMMdd_HHmm').json
```

### Step 2: Validate Current State
```javascript
// migration_validator.js
function validateDatabaseV4(db) {
    const checks = [];

    // Check employees exist
    if (!Array.isArray(db.employees)) checks.push('❌ employees missing');
    else checks.push(`✅ employees: ${db.employees.length} records`);

    // Check Omni task source exists
    if (!Array.isArray(db.omni?.kanban?.cards)) checks.push('❌ omni.kanban.cards missing');
    else checks.push(`✅ omni.kanban.cards: ${db.omni.kanban.cards.length} records`);

    // Check material/stock source
    if (!Array.isArray(db.omni?.materials)) checks.push('❌ omni.materials missing');
    else checks.push(`✅ omni.materials: ${db.omni.materials.length} records`);

    // Check machines
    if (!Array.isArray(db.omni?.machines)) checks.push('❌ omni.machines missing');
    else checks.push(`✅ omni.machines: ${db.omni.machines.length} records`);

    return checks;
}
```

### Step 3: Run Migration
```javascript
function migrateV4toV5(db) {
    // Only run once
    if (db._schema_version === '5.0') {
        console.log('Already at V5');
        return db;
    }

    console.log('Starting V4 → V5 migration...');

    // 1. Add audit fields to existing real collections
    const collections = [
        ['employees', db.employees],
        ['finance.accounts', db.finance?.accounts],
        ['finance.departments', db.finance?.departments],
        ['finance.transactions', db.finance?.transactions],
        ['omni.kanban.cards', db.omni?.kanban?.cards],
        ['omni.machines', db.omni?.machines],
        ['omni.materials', db.omni?.materials],
        ['omni.opPacks', db.omni?.opPacks],
        ['omni.qcRecords', db.omni?.qcRecords],
        ['omni.departments', db.omni?.departments],
    ];
    for (const [col, records] of collections) {
        if (!Array.isArray(records)) continue;
        records.forEach((record, index) => {
            record.id = record.id || `${col.substring(0,3).toUpperCase()}_${String(index+1).padStart(4,'0')}`;
            record.created_at = record.created_at || new Date().toISOString();
            record.created_by = record.created_by || 'system';
            record.updated_at = record.updated_at || new Date().toISOString();
            record.updated_by = record.updated_by || 'system';
            record.is_active = record.is_active !== undefined ? record.is_active : true;
        });
    }

    // 2. Initialize new collections (empty)
    db.contacts = db.contacts || [];
    db.departments = db.departments || [];
    db.users = db.users || [];
    db.locations = db.locations || [];
    db.quants = db.quants || [];
    db.stock_moves = db.stock_moves || [];
    db.transfers = db.transfers || [];
    db.journals = db.journals || [];
    db.journal_entries = db.journal_entries || [];
    db.payments = db.payments || [];
    db.maintenance_requests = db.maintenance_requests || [];
    db.production_orders = db.production_orders || [];
    db.work_orders = db.work_orders || [];
    db.audit_log = db.audit_log || [];

    // 3. Extract departments from current nested data
    {
        const deptNames = [...new Set([
            ...(db.finance?.departments || []).map(d => d.name),
            ...(db.omni?.departments || []).map(d => d.name),
            ...(db.employees || []).map(e => e.department),
        ].filter(Boolean))];
        db.departments = deptNames.map((name, i) => ({
            id: `DEPT_${String(i+1).padStart(3,'0')}`,
            name: name,
            is_active: true,
            created_at: new Date().toISOString(),
        }));
    }

    // 4. Create default locations
    db.locations = [
        { id: 'LOC_MAIN',  name: 'المخزن الرئيسي', type: 'internal', parent_id: null, is_active: true },
        { id: 'LOC_SCRAP', name: 'التالف',         type: 'inventory', parent_id: null, is_active: true },
        { id: 'LOC_CUST',  name: 'العملاء',        type: 'customer',  parent_id: null, is_active: true },
        { id: 'LOC_SUPP',  name: 'الموردين',       type: 'supplier',  parent_id: null, is_active: true },
    ];

    // 5. Keep the existing chart of accounts in finance.accounts[]
    // Do NOT create top-level accounts[] in Sprint B.

    // 6. Mark version
    db._schema_version = '5.0';
    db._migrated_at = new Date().toISOString();

    console.log('Migration complete!');
    return db;
}
```

### Step 4: Verify
```javascript
function validateDatabaseV5(db) {
    const checks = [];

    // Schema version
    checks.push(db._schema_version === '5.0' ? '✅ Schema V5' : '❌ Wrong schema version');

    // Audit fields
    const hasAudit = db.employees?.every(e => e.id && e.created_at && e.is_active !== undefined);
    checks.push(hasAudit ? '✅ Audit fields present' : '❌ Missing audit fields');

    // New collections
    ['departments','users','locations','quants','stock_moves','journals','journal_entries','audit_log'].forEach(col => {
        checks.push(Array.isArray(db[col]) ? `✅ ${col}: ${db[col].length}` : `❌ ${col} missing`);
    });

    // No data loss
    checks.push(db.employees?.length > 0 ? '✅ Employees preserved' : '❌ Employee data lost!');
    checks.push(db.omni?.kanban?.cards?.length >= 0 ? '✅ Omni cards preserved' : '❌ Omni cards missing');

    return checks;
}
```

---

## 🚫 Anti-Patterns to Avoid

| Don't Do This | Do This Instead |
|--------------|-----------------|
| `database.json = {}` | Additive migration only |
| Edit `app.js` line 500 | Create new service file |
| `delete record` | `record.is_active = false` |
| Copy Odoo's ORM | Write simple JS functions |
| Add PostgreSQL dependency | Keep JSON/localStorage |
| Rewrite the page registry | Add new pages alongside |
| Change Arabic labels | Keep existing labels, add new ones |
| Remove old status values | Map old values to new states |

---

## 📊 Success Criteria

Octagon V5 is ready when:

- [ ] All existing pages still work
- [ ] database.json has audit fields on all records
- [ ] Service layer handles CRUD with auto-audit
- [ ] State machines enforce valid transitions
- [ ] Stock movements create traceable records
- [ ] Basic journal entries balance (debit = credit)
- [ ] At least 3 permission groups enforced
- [ ] Audit log captures all data changes
- [ ] No data from V4 is lost or corrupted

---

*← Back to [00_study_index.md](./00_study_index.md)*
