# 08 — Maintenance & Equipment Tracking
## Odoo Maintenance → Octagon Machine Health

---

## 1. Odoo Maintenance Models

```
maintenance.equipment.category
├── name, technician_user_id, equipment_properties_definition
├── equipment_ids → maintenance.equipment[]
└── maintenance_ids → maintenance.request[]

maintenance.equipment (inherits maintenance.mixin)
├── name, serial_no (unique), model, category_id
├── owner_user_id, partner_id (vendor), cost
├── effective_date, warranty_date, scrap_date
├── maintenance_team_id, technician_user_id
├── equipment_properties (dynamic fields per category)
├── maintenance_ids → maintenance.request[]
└── COMPUTED: mtbf, mttr, estimated_next_failure, latest_failure_date

maintenance.request
├── name (subject), description, equipment_id
├── stage_id → maintenance.stage (pipeline)
├── priority: 0-3 (Very Low to High)
├── maintenance_type: corrective | preventive
├── schedule_date, schedule_end, duration
├── user_id (technician), owner_user_id (reporter)
├── kanban_state: normal | blocked | done
├── recurring_maintenance, repeat_interval, repeat_unit
└── close_date, archive (soft-delete)

maintenance.team
├── name, member_ids, company_id
├── request_ids, equipment_ids
└── COMPUTED: todo counts, priority counts, blocked counts
```

## 2. Key Patterns to Borrow

### MTBF/MTTR Computation
```python
# Mean Time Between Failure
mtbf = (latest_failure_date - effective_date).days / len(corrective_maintenances)

# Mean Time To Repair
mttr = sum(close_date - request_date for each done corrective) / count

# Estimated Next Failure
estimated_next_failure = latest_failure_date + mtbf days
```

### Recurring Preventive Maintenance
When a preventive request is marked "done", Odoo auto-creates the next one:
```python
if maintenance_type == 'preventive' and recurring:
    next_date = schedule_date + repeat_interval * repeat_unit
    if repeat_type == 'forever' or next_date <= repeat_until:
        self.copy({'schedule_date': next_date, 'stage_id': first_stage})
```

### Kanban Pipeline
```
New Request → In Progress → Repaired → Done
                  ↓
              Blocked (waiting for parts)
```

## 3. Octagon V4 vs V5 Machine Model

### Current (V4)
```javascript
// Flat machine object, no maintenance tracking
{ name: "CNC #1", status: "active", department: "قص" }
```

### V5 Design
```javascript
{
    id: "mach_001",
    name: "CNC #1",
    serial_no: "CNC-2024-A001",
    category: "آلات القص",
    department_id: "dept_cutting",
    status: "operational",            // operational | maintenance | scrapped
    purchase_date: "2024-03-15",
    warranty_expires: "2026-03-15",
    cost: 25000000,                   // IQD
    vendor: "شركة المعدات",
    technician_id: "emp_005",

    // Health metrics (computed from maintenance history)
    mtbf_days: 45,                    // Mean time between failures
    mttr_days: 2,                     // Mean time to repair
    last_failure_date: "2026-04-20",
    next_expected_failure: "2026-06-04",
    total_maintenance_count: 8,
    open_maintenance_count: 1,

    // Preventive schedule
    preventive_schedule: {
        enabled: true,
        interval: 30,                 // days
        unit: "day",
        last_done: "2026-04-15",
        next_due: "2026-05-15",
    },

    // audit fields...
}
```

### V5 Maintenance Request
```javascript
{
    id: "maint_001",
    equipment_id: "mach_001",
    type: "corrective",               // corrective | preventive
    subject: "تغيير شفرة القص",
    description: "الشفرة تالفة بعد قص 500 قطعة",
    priority: 2,                       // 0=low, 3=high
    stage: "in_progress",             // new | in_progress | blocked | done
    technician_id: "emp_005",
    reported_by: "emp_003",
    request_date: "2026-05-14",
    scheduled_date: "2026-05-14T10:00",
    close_date: null,
    duration_hours: null,
    is_recurring: false,
    // audit fields...
}
```

## 4. Integration Points

| Event | Triggers |
|-------|----------|
| Machine breaks down | → Create corrective maintenance request |
| Preventive schedule due | → Auto-create preventive request |
| Maintenance done | → Update machine health metrics, auto-schedule next |
| Machine scrapped | → Archive machine, cancel pending maintenance |
| Task assigned to broken machine | → Warning to supervisor |

---

*Next: [09_state_machines.md](./09_state_machines.md)*
