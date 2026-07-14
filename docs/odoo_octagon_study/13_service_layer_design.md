# 13 — Service Layer Architecture Design
## The Heart of Octagon V5

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    OCTAGON V5 ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─── UI Layer (index.html + app.js) ──────────────────┐   │
│  │  Pages, Forms, Tables, Charts                        │   │
│  │  Calls service functions instead of raw DB access    │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ function calls                    │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │  SERVICE LAYER (new files, loaded before app.js)     │   │
│  │                                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ auditService│  │ stateService│  │ recordSvc  │  │   │
│  │  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ stockService│  │ financeServ │  │ permService│  │   │
│  │  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ reads/writes                      │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │  DATA LAYER (database.json / localStorage)           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 2. Loading Order

```html
<!-- index.html — script loading order -->
<!-- 1. Service Layer (independent, no app.js dependency) -->
<script src="services/auditService.js"></script>
<script src="services/stateService.js"></script>
<script src="services/recordService.js"></script>
<script src="services/permissionService.js"></script>
<script src="services/stockService.js"></script>
<script src="services/financeService.js"></script>
<script src="services/index.js"></script>

<!-- 2. Main Application (uses services) -->
<script src="app.js"></script>
```

## 3. Service Specifications

### auditService.js

```javascript
/**
 * Audit Service — Append-only event logging
 * Inspired by Odoo's mail.thread tracking system
 */
const AuditService = {
    /**
     * Create an audit event
     * @param {string} eventType - e.g., "task.state_change"
     * @param {string} recordId - ID of affected record
     * @param {object} data - Event-specific data
     * @returns {object} The created event
     */
    createEvent(eventType, recordId, data) {
        const event = {
            id: this._generateId(),
            event_type: eventType,
            record_id: recordId,
            data: data,
            user_id: OctagonAuth.getCurrentUser()?.id || 'system',
            user_name: OctagonAuth.getCurrentUser()?.name || 'النظام',
            timestamp: new Date().toISOString(),
        };
        this._getLog().push(event);
        return event;
    },

    /**
     * Get audit history for a record
     */
    getHistory(recordId, options = {}) {
        let events = this._getLog().filter(e => e.record_id === recordId);
        if (options.type) events = events.filter(e => e.event_type === options.type);
        if (options.since) events = events.filter(e => e.timestamp >= options.since);
        return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },

    /**
     * Get all events of a type (for reports)
     */
    getByType(eventType, options = {}) {
        let events = this._getLog().filter(e => e.event_type.startsWith(eventType));
        if (options.dateFrom) events = events.filter(e => e.timestamp >= options.dateFrom);
        if (options.dateTo) events = events.filter(e => e.timestamp <= options.dateTo);
        return events;
    },

    _getLog() {
        const db = OctagonDB.get();
        if (!db.audit_log) db.audit_log = [];
        return db.audit_log;
    },

    _generateId() {
        return 'AUD_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
};
```

### recordService.js

```javascript
/**
 * Record Service — CRUD with automatic audit trails
 * Inspired by Odoo's BaseModel.create/write/unlink
 */
const RecordService = {
    /**
     * Create a record with audit fields
     */
    create(collection, data) {
        const db = OctagonDB.get();
        if (!db[collection]) db[collection] = [];

        const record = {
            ...data,
            id: data.id || this._generateId(collection),
            created_at: new Date().toISOString(),
            created_by: OctagonAuth.getCurrentUser()?.id || 'system',
            updated_at: new Date().toISOString(),
            updated_by: OctagonAuth.getCurrentUser()?.id || 'system',
            is_active: true,
        };

        db[collection].push(record);
        AuditService.createEvent(`${collection}.created`, record.id, record);
        OctagonDB.save();
        return record;
    },

    /**
     * Update a record with change tracking
     */
    update(collection, recordId, changes) {
        const record = this.get(collection, recordId);
        if (!record) throw new Error('السجل غير موجود');

        const oldValues = {};
        const newValues = {};

        for (const [key, value] of Object.entries(changes)) {
            if (key === 'id' || key === 'created_at' || key === 'created_by') continue;
            if (record[key] !== value) {
                oldValues[key] = record[key];
                newValues[key] = value;
                record[key] = value;
            }
        }

        if (Object.keys(newValues).length > 0) {
            record.updated_at = new Date().toISOString();
            record.updated_by = OctagonAuth.getCurrentUser()?.id || 'system';
            AuditService.createEvent(`${collection}.updated`, recordId, {
                old: oldValues, new: newValues
            });
            OctagonDB.save();
        }

        return record;
    },

    /**
     * Soft-delete (archive) a record
     */
    archive(collection, recordId) {
        return this.update(collection, recordId, {
            is_active: false,
            archived_at: new Date().toISOString(),
        });
    },

    /**
     * Get a single record
     */
    get(collection, recordId) {
        const db = OctagonDB.get();
        return (db[collection] || []).find(r => r.id === recordId);
    },

    /**
     * Search records (active only by default)
     */
    search(collection, filters = {}, includeArchived = false) {
        const db = OctagonDB.get();
        let records = db[collection] || [];

        if (!includeArchived) {
            records = records.filter(r => r.is_active !== false);
        }

        for (const [key, value] of Object.entries(filters)) {
            records = records.filter(r => r[key] === value);
        }

        return records;
    },

    _generateId(collection) {
        const prefix = collection.substring(0, 3).toUpperCase();
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    }
};
```

### stateService.js

```javascript
/**
 * State Machine Service — Enforces document lifecycle
 * Inspired by Odoo's Selection field state transitions
 */
const StateService = {
    machines: {}, // Populated at init

    register(modelType, config) {
        this.machines[modelType] = config;
    },

    transition(collection, recordId, newState) {
        const machine = this.machines[collection];
        if (!machine) throw new Error(`آلة حالة غير معرفة: ${collection}`);

        const record = RecordService.get(collection, recordId);
        if (!record) throw new Error('السجل غير موجود');

        const allowed = machine.transitions[record.state];
        if (!allowed || !allowed.includes(newState)) {
            throw new Error(
                `لا يمكن الانتقال من "${machine.labels[record.state]}" إلى "${machine.labels[newState]}"`
            );
        }

        const oldState = record.state;
        RecordService.update(collection, recordId, { state: newState });

        AuditService.createEvent(`${collection}.state_change`, recordId, {
            from: oldState, to: newState,
            from_label: machine.labels[oldState],
            to_label: machine.labels[newState],
        });

        // Fire side effects
        if (machine.onTransition) {
            machine.onTransition(record, oldState, newState);
        }

        return record;
    },

    getAvailableTransitions(collection, recordId) {
        const machine = this.machines[collection];
        const record = RecordService.get(collection, recordId);
        const allowed = machine?.transitions[record?.state] || [];
        return allowed.map(s => ({ state: s, label: machine.labels[s] }));
    }
};
```

## 4. Integration Point — How app.js Uses Services

```javascript
// BEFORE (current app.js — direct DB manipulation)
function addTask(data) {
    const task = { ...data, status: 'pending' };
    database.tasks.push(task);
    saveDatabase();
}

// AFTER (V5 — using service layer)
function addTask(data) {
    // Permission check
    if (!PermissionService.check('tasks', 'create')) {
        showError('ليس لديك صلاحية إنشاء مهمة');
        return;
    }

    // Create with auto-audit
    const task = RecordService.create('tasks', {
        ...data,
        state: 'draft',
        machine_id: data.machine_id,
        department_id: data.department_id,
    });

    // State machine enforces valid initial state
    // Audit event created automatically
    showSuccess(`تم إنشاء المهمة ${task.id}`);
}
```

## 5. Non-Destructive Integration Rules

1. Services are in SEPARATE files — never modify `app.js` functions directly
2. Services use `OctagonDB.get()` — same database.json, no new storage
3. Old functions keep working — services are additive
4. New pages use services — old pages migrated gradually
5. No breaking changes to database.json structure — only additions

---

*Next: [14_safety_rules.md](./14_safety_rules.md)*
