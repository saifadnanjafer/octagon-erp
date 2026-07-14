# 10 — Audit Trail & Change Tracking
## How Odoo Tracks Every Change (And Octagon Must Too)

---

## 1. Odoo's Tracking Mechanisms

### Level 1: Golden Fields (Automatic)
Every record gets `create_uid`, `create_date`, `write_uid`, `write_date` automatically.

### Level 2: Field Tracking (Chatter)
Fields marked with `tracking=True` log changes in the chatter:
```python
name = fields.Char(tracking=True)
stage_id = fields.Many2one('maintenance.stage', tracking=True)
user_id = fields.Many2one('res.users', tracking=True)
contract_wage = fields.Monetary(tracking=True)
```

When a tracked field changes, Odoo creates a `mail.message` with:
- Old value → New value
- Who changed it
- When

### Level 3: mail.thread (Full Message Log)
Models inheriting `mail.thread` get a full communication history:
```python
class MaintenanceRequest(models.Model):
    _inherit = ['mail.thread.cc', 'mail.activity.mixin']
    # Gets: message_ids, message_follower_ids, activity_ids
```

### Level 4: Accounting Hash Chain
Posted journal entries get an `inalterable_hash` — a SHA256 chain:
```python
inalterable_hash = fields.Char('Inalterability Hash')
# Each entry hashes: previous_hash + date + move_name + partner + lines
# This creates a tamper-proof chain like blockchain
```

## 2. Octagon V4 — Current State

❌ No audit trail whatsoever.
❌ No tracking of who changed what.
❌ No history of state changes.
❌ No message/chatter system.

## 3. Octagon V5 Audit System Design

### Audit Event Model

```javascript
function createAuditEvent(eventType, recordId, data) {
    const event = {
        id: generateId('AUD'),
        event_type: eventType,           // e.g., "task.state_change"
        record_id: recordId,
        data: data,                      // { from: "draft", to: "confirmed" }
        user_id: getCurrentUser().id,
        user_name: getCurrentUser().name,
        timestamp: new Date().toISOString(),
        ip_address: null,                // For future network mode
    };

    // Store in separate audit collection (append-only)
    if (!db.audit_log) db.audit_log = [];
    db.audit_log.push(event);
    saveDatabase();
    return event;
}
```

### Event Types

| Event Type | When | Data Captured |
|-----------|------|--------------|
| `*.created` | Record created | Full record snapshot |
| `*.updated` | Record modified | Changed fields only |
| `*.state_change` | State transition | from, to |
| `*.deleted` | Record archived | Record ID, reason |
| `stock.move.done` | Stock movement completed | product, qty, locations |
| `journal.posted` | Journal entry posted | entry ID, total |
| `user.login` | User logged in | user, timestamp |
| `salary.calculated` | Salary computed | employee, amounts |
| `maintenance.done` | Maintenance completed | equipment, duration |

### Query Audit Log

```javascript
function getAuditHistory(recordId, options = {}) {
    let events = db.audit_log.filter(e => e.record_id === recordId);

    if (options.eventType) {
        events = events.filter(e => e.event_type === options.eventType);
    }
    if (options.since) {
        events = events.filter(e => e.timestamp >= options.since);
    }
    if (options.userId) {
        events = events.filter(e => e.user_id === options.userId);
    }

    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// Usage: Show task history
const history = getAuditHistory('task_001');
// Returns: [{state_change: confirmed→in_progress, by: أحمد, at: ...}, ...]
```

### Auto-Tracking Wrapper

```javascript
function updateRecord(collection, recordId, changes) {
    const record = db[collection].find(r => r.id === recordId);
    if (!record) throw new Error('السجل غير موجود');

    // Capture what changed
    const oldValues = {};
    const newValues = {};
    for (const [key, value] of Object.entries(changes)) {
        if (record[key] !== value) {
            oldValues[key] = record[key];
            newValues[key] = value;
            record[key] = value;
        }
    }

    // Only log if something actually changed
    if (Object.keys(newValues).length > 0) {
        record.updated_at = new Date().toISOString();
        record.updated_by = getCurrentUser().id;

        createAuditEvent(`${collection}.updated`, recordId, {
            old: oldValues,
            new: newValues,
        });
    }

    saveDatabase();
    return record;
}
```

### Integrity Hash (For Financial Records)

```javascript
function hashJournalEntry(entry, previousHash) {
    const payload = JSON.stringify({
        prev: previousHash,
        date: entry.date,
        name: entry.name,
        total: entry.amount_total,
        lines: entry.lines.map(l => `${l.account_id}:${l.debit}:${l.credit}`),
    });
    return sha256(payload);
}
```

---

*Next: [11_mapping_matrix.md](./11_mapping_matrix.md)*
