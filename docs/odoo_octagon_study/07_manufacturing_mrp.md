# 07 — Manufacturing (MRP) & Workorders
## Odoo Production → Octagon Workshop Tasks

---

## 1. MRP Model Hierarchy

```
mrp.production (Manufacturing Order)
├── product_id          → What to produce
├── bom_id              → Bill of Materials (recipe)
├── product_qty         → How many to produce
├── qty_producing       → Currently producing
├── move_raw_ids        → Raw material consumption (stock.move[])
├── move_finished_ids   → Finished product output (stock.move[])
├── workorder_ids       → Work orders (mrp.workorder[])
└── state               → draft/confirmed/progress/to_close/done/cancel

mrp.workorder (Work Order — single operation)
├── production_id       → Parent MO
├── workcenter_id       → Machine/workstation
├── operation_id        → Operation template
├── name                → Operation name
├── state               → blocked/ready/progress/done/cancel
├── qty_producing       → Current batch qty
├── qty_produced        → Completed qty
├── qty_remaining       → Remaining qty
├── duration_expected   → Planned time (minutes)
├── duration            → Actual time (minutes)
├── time_ids            → Time tracking entries
├── date_start/finished → Timestamps
└── blocked_by_workorder_ids → Dependencies
```

## 2. Workorder State Machine

```
blocked → ready → progress → done
              ↓       ↓
           cancel  cancel
```

- **blocked**: Waiting for previous operation
- **ready**: Previous ops done, stock available
- **progress**: Worker clicked "Start"
- **done**: Completed

### Time Tracking

Each workorder has `time_ids` → `mrp.workcenter.productivity`:
```python
time_ids = fields.One2many('mrp.workcenter.productivity', 'workorder_id')
# Each entry: user_id, date_start, date_end, duration, loss_type
```

Workers click Start → creates a timeline entry.
Click Pause → closes the entry with `date_end`.
Multiple workers can work simultaneously on the same order.

### Duration Computation
```python
duration = sum(time_ids.mapped('duration'))
duration_unit = duration / max(qty_produced, 1)       # Per-unit time
duration_percent = 100 * (expected - actual) / expected  # Deviation %
progress = duration * 100 / duration_expected            # Progress %
```

## 3. Workorder Dependencies

```python
blocked_by_workorder_ids = fields.Many2many('mrp.workorder', ...)
needed_by_workorder_ids = fields.Many2many('mrp.workorder', ...)

@api.constrains('blocked_by_workorder_ids')
def _check_no_cyclic_dependencies(self):
    if self._has_cycle('blocked_by_workorder_ids'):
        raise ValidationError("Cannot create cyclic dependency.")
```

## 4. Cost Tracking

```python
costs_hour = fields.Float('Cost per hour')

def _cal_cost(self):
    # If estimated cost mode: use expected duration
    # If actual cost mode: use real tracked intervals
    duration = self.duration_expected / 60 if self._should_estimate_cost()
               else sum_intervals(time_entries)
    return duration * self.costs_hour
```

## 5. Octagon Mapping

| Odoo Concept | Octagon V4 | Octagon V5 Goal |
|-------------|-------------|-----------------|
| `mrp.production` | Task (top level) | `production_orders[]` |
| `mrp.workorder` | Task steps (subtasks) | `work_orders[]` |
| `mrp.workcenter` | Machine | `machines[]` (already exists) |
| `mrp.bom` | ❌ Missing | `bill_of_materials[]` |
| Time tracking | ❌ Missing | `time_entries[]` |
| Dependencies | ❌ Missing | `blocked_by_ids[]` |

### Octagon V5 Work Order

```javascript
{
    id: "wo_001",
    production_id: "po_001",        // Parent production order
    machine_id: "mach_cnc_01",      // Workcenter
    operation: "قص",                // Operation name
    sequence: 1,
    state: "progress",              // blocked/ready/progress/done/cancel
    qty_planned: 50,
    qty_done: 30,
    duration_expected: 120,          // minutes
    duration_actual: 95,             // minutes (from time entries)
    blocked_by_ids: [],              // No dependencies for first op
    time_entries: [
        { user_id: "emp_001", start: "2026-05-14T08:00", end: "2026-05-14T09:35", duration: 95 }
    ],
    cost_per_hour: 15000,            // IQD
    // audit fields...
}
```

---

*Next: [08_maintenance_equipment.md](./08_maintenance_equipment.md)*
