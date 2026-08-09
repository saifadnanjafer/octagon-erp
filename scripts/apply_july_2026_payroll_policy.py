#!/usr/bin/env python3
"""Apply the owner-approved July 2026 attendance/payroll policy safely.

The script updates the JSON runtime mirror and the SQLite operational store in
one controlled operation.  Run without --apply first to inspect the impact.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

YEAR, MONTH = 2026, 7
DOUBLE_FRIDAY = "2026-07-17"
OVERTIME_DAY = "2026-07-01"


def minutes(value):
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and ":" in value:
        try:
            hour, minute = value.strip().split(":", 1)
            return int(hour) * 60 + int(minute)
        except ValueError:
            return None
    return None


def is_worked(record):
    return (record.get("hours") or 0) > 0 or minutes(record.get("checkInMin")) is not None or minutes(record.get("checkIn")) is not None


def update_record(record, stats):
    """Mutate a single July record and return whether it is the worked Friday."""
    # Source imports use DD/MM/YYYY, so canonicalize from the structural fields.
    date = f"{record.get('year'):04d}-{record.get('month'):02d}-{record.get('day'):02d}"
    original = record.get("status", "normal")
    worked_friday = date == DOUBLE_FRIDAY and is_worked(record)

    record["payrollShiftHours"] = 8
    record["penalty"] = 0
    record["lateOverride"] = 0
    record["earlyDeductionOverride"] = 0
    record["july2026PayrollPolicy"] = "owner-approved-8h-no-late-deductions"

    if original == "absent":
        record["status"] = "leave"
        record.pop("otHoursOverride", None)
        stats["absence_to_unpaid_leave"] += 1
        return False

    if worked_friday:
        record["status"] = "friday_work"
        record.pop("otHoursOverride", None)
        stats["double_friday_worked"] += 1
        return True

    check_in = minutes(record.get("checkInMin"))
    if check_in is None:
        check_in = minutes(record.get("checkIn"))
    if check_in is not None and check_in >= 15 * 60:
        record["status"] = "night_shift"
        stats["night_shift"] += 1
    elif original != "friday":
        # A normal paid day with no late/early deduction in the approved month.
        record["status"] = "late_excused"
        stats["paid_no_deduction"] += 1

    if date == OVERTIME_DAY:
        record["otHoursOverride"] = max(0, float(record.get("hours") or 0) - 8)
        stats["july_1_overtime_records"] += 1
    elif original != "friday":
        record["otHoursOverride"] = 0
    else:
        record.pop("otHoursOverride", None)
    return False


def apply_policy(data):
    stats = Counter()
    changed = []
    for employee in data.get("employees", []):
        employee_changed = False
        for record in employee.get("records", []):
            if record.get("year") == YEAR and record.get("month") == MONTH:
                update_record(record, stats)
                stats["july_records"] += 1
                employee_changed = True
        if employee_changed:
            employee["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
            employee["updated_by"] = "owner-approved-july-2026-payroll-policy"
            changed.append(employee)
    stats["employees"] = len(changed)
    return changed, stats


def backup(paths, backup_dir):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = backup_dir / f"july-2026-payroll-policy-{stamp}"
    target.mkdir(parents=True, exist_ok=False)
    for path in paths:
        if path.exists():
            shutil.copy2(path, target / path.name)
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, default=Path("database.json"))
    parser.add_argument("--sqlite", type=Path, default=Path("database.db"))
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if not args.json.exists() or not args.sqlite.exists():
        sys.exit("database.json and database.db must both exist")
    data = json.loads(args.json.read_text(encoding="utf-8"))
    employees, stats = apply_policy(data)
    print(json.dumps(dict(stats), sort_keys=True))
    if not args.apply:
        print("Dry run only; no files changed.")
        return

    backup_paths = [args.json, args.sqlite, args.sqlite.with_name(args.sqlite.name + "-wal"), args.sqlite.with_name(args.sqlite.name + "-shm")]
    backup_path = backup(backup_paths, args.backup_dir)
    args.json.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with sqlite3.connect(args.sqlite) as conn:
        conn.execute("BEGIN IMMEDIATE")
        for employee in employees:
            conn.execute(
                "INSERT INTO collections(collection, id, data) VALUES ('employees', ?, ?) "
                "ON CONFLICT(collection, id) DO UPDATE SET data=excluded.data",
                (str(employee["id"]), json.dumps(employee, ensure_ascii=False, separators=(",", ":"))),
            )
        conn.commit()
    print(f"Applied. Backup folder: {backup_path.name}")


if __name__ == "__main__":
    main()
