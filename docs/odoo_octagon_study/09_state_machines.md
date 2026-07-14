# 09 — State Machines & Workflow Patterns
## How Odoo Enforces Business Logic Through States

---

## 1. State Machine Catalog

Every major Odoo document has a state field with enforced transitions:

### stock.move
```
draft → confirmed → partially_available → assigned → done
  ↓        ↓              ↓                   ↓
cancel   cancel         cancel              cancel
```

### stock.picking
```
draft → waiting → confirmed → assigned → done
  ↓                              ↓
cancel                         cancel
```

### account.move
```
draft → posted
  ↓
cancel
(posted can only be reversed with a new credit note entry)
```

### mrp.workorder
```
blocked → ready → progress → done
                     ↓
                  cancel
```

### maintenance.request (Kanban Pipeline)
```
New → In Progress → Done
         ↓
      Blocked
```

### hr.employee (Presence)
```
present ↔ absent ↔ out_of_working_hour ↔ archive
```

## 2. Transition Enforcement Pattern

Odoo enforces transitions in `write()` methods:

```python
def write(self, vals):
    if 'qty_produced' in values:
        for wo in self:
            if wo.state in ['done', 'cancel']:
                raise UserError('Cannot change qty of done/cancelled order')
            elif values['qty_produced'] < 0:
                raise UserError('Quantity must be positive')

    if 'workcenter_id' in values:
        for workorder in self:
            if workorder.state in ('done', 'cancel'):
                raise UserError('Cannot change workcenter of done order')
    # ...
    return super().write(vals)
```

### Button Methods Pattern

```python
def button_start(self):
    """Start a workorder — validates preconditions"""
    if any(wo.working_state == 'blocked' for wo in self):
        raise UserError('Please unblock the work center first')
    for wo in self:
        if wo.state in ('done', 'cancel'):
            raise UserError('Cannot start done/cancelled order')
        if wo.qty_producing == 0:
            wo.qty_producing = wo.qty_remaining
        # Create time tracking entry
        self.env['mrp.workcenter.productivity'].create(
            wo._prepare_timeline_vals(wo.duration, fields.Datetime.now())
        )
        wo.state = 'progress'

def button_finish(self):
    """Finish a workorder — marks as done, records costs"""
    for workorder in self:
        vals = {
            'qty_produced': workorder.qty_producing or workorder.qty_production,
            'state': 'done',
            'date_finished': fields.Datetime.now(),
            'costs_hour': workorder.workcenter_id.costs_hour
        }
        workorder.write(vals)
```

## 3. Octagon V5 State Engine

### Universal State Transition Map

```javascript
const STATE_MACHINES = {
    'task': {
        states: ['draft', 'confirmed', 'in_progress', 'quality_check', 'done', 'cancelled', 'rework'],
        transitions: {
            'draft':         ['confirmed', 'cancelled'],
            'confirmed':     ['in_progress', 'cancelled'],
            'in_progress':   ['quality_check', 'cancelled'],
            'quality_check': ['done', 'rework'],
            'rework':        ['in_progress'],
            'done':          [],
            'cancelled':     ['draft'],
        },
        labels: {
            'draft': 'مسودة', 'confirmed': 'مؤكد', 'in_progress': 'قيد التنفيذ',
            'quality_check': 'فحص الجودة', 'done': 'مكتمل', 'cancelled': 'ملغي', 'rework': 'إعادة عمل',
        }
    },

    'stock_move': {
        states: ['draft', 'confirmed', 'assigned', 'done', 'cancel'],
        transitions: {
            'draft':     ['confirmed', 'cancel'],
            'confirmed': ['assigned', 'cancel'],
            'assigned':  ['done', 'cancel'],
            'done':      [],
            'cancel':    ['draft'],
        },
        labels: {
            'draft': 'جديد', 'confirmed': 'بالانتظار', 'assigned': 'جاهز',
            'done': 'تم', 'cancel': 'ملغي',
        }
    },

    'journal_entry': {
        states: ['draft', 'posted', 'cancel'],
        transitions: {
            'draft':  ['posted', 'cancel'],
            'posted': [],           // Can only reverse with new entry
            'cancel': ['draft'],
        },
        labels: { 'draft': 'مسودة', 'posted': 'مرحّل', 'cancel': 'ملغي' }
    },

    'maintenance': {
        states: ['new', 'in_progress', 'blocked', 'done'],
        transitions: {
            'new':         ['in_progress', 'done'],
            'in_progress': ['blocked', 'done'],
            'blocked':     ['in_progress'],
            'done':        [],
        },
        labels: { 'new': 'جديد', 'in_progress': 'قيد الصيانة', 'blocked': 'متوقف', 'done': 'تم' }
    }
};
```

### Transition Function

```javascript
function changeState(modelType, recordId, newState) {
    const machine = STATE_MACHINES[modelType];
    if (!machine) throw new Error(`نوع غير معروف: ${modelType}`);

    const record = getRecord(modelType, recordId);
    const allowed = machine.transitions[record.state];

    if (!allowed || !allowed.includes(newState)) {
        const fromLabel = machine.labels[record.state];
        const toLabel = machine.labels[newState];
        throw new Error(`لا يمكن الانتقال من "${fromLabel}" إلى "${toLabel}"`);
    }

    const oldState = record.state;
    record.state = newState;
    record.updated_at = new Date().toISOString();
    record.updated_by = getCurrentUser().id;

    // Audit log
    createAuditEvent(`${modelType}.state_change`, recordId, {
        from: oldState, to: newState,
        from_label: machine.labels[oldState],
        to_label: machine.labels[newState],
    });

    // Trigger side effects
    onStateChange(modelType, record, oldState, newState);
    saveDatabase();
}
```

### Side Effects Engine

```javascript
function onStateChange(modelType, record, from, to) {
    // Task completed → update machine queue
    if (modelType === 'task' && to === 'done') {
        updateMachineQueue(record.machine_id);
        releaseReservedStock(record.id);
    }

    // Maintenance done → update machine health metrics
    if (modelType === 'maintenance' && to === 'done') {
        record.close_date = new Date().toISOString();
        updateMachineHealth(record.equipment_id);
        if (record.is_recurring) scheduleNextMaintenance(record);
    }

    // Stock move done → update quants
    if (modelType === 'stock_move' && to === 'done') {
        executeStockMovement(record);
    }

    // Journal entry posted → lock from editing
    if (modelType === 'journal_entry' && to === 'posted') {
        record.is_locked = true;
        record.posted_at = new Date().toISOString();
    }
}
```

---

*Next: [10_audit_trail.md](./10_audit_trail.md)*
