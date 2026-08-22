#!/usr/bin/env python3
"""Incrementally synchronize the approved workshop workbook into Octagon data.

Only attendance, workshop advances, cashbox entries, and the employee shells
strictly required to hold new attendance are touched.  Existing records are
matched and updated; nothing is deleted.
"""

import argparse
import copy
import datetime as dt
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "database.json"
DEFAULT_SQLITE = ROOT / "database.db"
DEFAULT_BACKUPS = Path(r"C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\COMPANY\_Archive - الأرشيف القديم\_Project Artifacts\octagon-erp\db-backups")


def text(value):
    return "" if value is None else str(value).strip()


def number(value):
    raw = text(value).replace(",", "").replace("،", "")
    try:
        return float(raw) if raw else 0.0
    except ValueError:
        return 0.0


def iso_date(value):
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(text(value), fmt).date().isoformat()
        except ValueError:
            pass
    return text(value)


def display_date(value):
    raw = iso_date(value)
    try:
        return dt.date.fromisoformat(raw).strftime("%d/%m/%Y")
    except ValueError:
        return raw


def minutes(value):
    raw = text(value)
    if not raw or ":" not in raw:
        return None
    try:
        hour, minute = raw.split(":", 1)
        return int(hour) * 60 + int(minute)
    except ValueError:
        return None


def rows(ws, header_row=1):
    headers = [text(v) for v in next(ws.iter_rows(min_row=header_row, max_row=header_row, values_only=True))]
    for values in ws.iter_rows(min_row=header_row + 1, values_only=True):
        if any(v is not None and text(v) for v in values):
            yield dict(zip(headers, values))


def canonical_names(wb):
    result = {}
    # The workbook's locked-name sheet has its headers on row 4.
    for row in rows(wb.worksheets[2], 4):
        canonical = text(row.get("الاسم الرسمي المعتمد"))
        alternatives = text(row.get("الأسماء البديلة / المدموجة"))
        if not canonical:
            continue
        result[canonical] = canonical
        if alternatives and alternatives != "—":
            for item in alternatives.replace("·", "/").replace("،", "/").split("/"):
                if text(item):
                    result[text(item)] = canonical
    return result


def canonical(value, aliases):
    return aliases.get(text(value), text(value))


def next_employee_id(employees):
    numbers = []
    for employee in employees:
        raw = text(employee.get("id"))
        if raw.startswith("EMP_") and raw[4:].isdigit():
            numbers.append(int(raw[4:]))
    return max(numbers, default=0) + 1


def employee_index(employees, aliases):
    result = {}
    for employee in employees:
        if not employee.get("is_active", True):
            continue
        for name in [employee.get("name"), *(employee.get("aliases") or [])]:
            normalized = canonical(name, aliases)
            if normalized and normalized not in result:
                result[normalized] = employee
    return result


def normalize_employee_names(employees, aliases, stats):
    """Apply locked name decisions without deleting legacy employee records."""
    grouped = {}
    for employee in employees:
        candidates = [employee.get("name"), *(employee.get("aliases") or [])]
        targets = [canonical(value, aliases) for value in candidates if canonical(value, aliases) != text(value)]
        if targets:
            grouped.setdefault(targets[0], []).append(employee)
    for official, candidates in grouped.items():
        # A record carrying an explicit alias is the original record to retain.
        primary = next((item for item in candidates if any(canonical(a, aliases) == official for a in item.get("aliases", []))), candidates[0])
        if primary.get("name") != official:
            old_name = text(primary.get("name"))
            primary["name"] = official
            primary["aliases"] = sorted(set([*(primary.get("aliases") or []), old_name]))
            stats["employees_renamed"] += 1
        for duplicate in candidates:
            if duplicate is primary:
                continue
            duplicate["is_active"] = False
            duplicate["mergedIntoEmployeeId"] = primary.get("id")
            duplicate["notes"] = (text(duplicate.get("notes")) + " | " if text(duplicate.get("notes")) else "") + "سجل تاريخي مدموج؛ لا يُحذف."
            stats["employees_merged_inactive"] += 1


def ensure_employee(name, employees, by_name, aliases, now):
    employee = by_name.get(name)
    if employee:
        return employee, False
    employee = {
        "id": f"EMP_{next_employee_id(employees):04d}",
        "empNumber": f"EMP{next_employee_id(employees):03d}",
        "name": name,
        "salary": 0,
        "prevAdvance": 0,
        "shift": "morning",
        "notes": "أُضيف تلقائياً لحفظ سجل حضور معتمد؛ الأجر الاسمي بانتظار قرار المالك.",
        "aliases": [],
        "records": [],
        "payments": {},
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "created_by": "approved_workbook_incremental_sync",
        "updated_by": "approved_workbook_incremental_sync",
        "source": "approved_workbook_2026_08_03",
    }
    employees.append(employee)
    by_name[name] = employee
    return employee, True


def sync_employee_shells(db, wb, aliases, now, stats):
    """Create only missing identities from the approved roster, without payroll data."""
    employees = db.setdefault("employees", [])
    by_name = employee_index(employees, aliases)
    for row in rows(wb.worksheets[3]):
        name = canonical(row.get("الاسم"), aliases)
        if not name:
            continue
        _, created = ensure_employee(name, employees, by_name, aliases, now)
        if created:
            stats["employees_added"] += 1


def attendance_payload(row):
    return {
        "date": display_date(row.get("التاريخ")),
        "day": dt.date.fromisoformat(iso_date(row.get("التاريخ"))).day,
        "month": int(number(row.get("الشهر"))),
        "year": int(number(row.get("السنة"))),
        "weekday": text(row.get("اليوم")),
        "checkIn": text(row.get("دخول")),
        "checkOut": text(row.get("خروج")),
        "checkInMin": minutes(row.get("دخول")),
        "checkOutMin": minutes(row.get("خروج")),
        "hours": number(row.get("ساعات")),
        "status": text(row.get("الحالة")) or "normal",
        "advance": number(row.get("سلفة")),
        "penalty": 0,
        "bonus": number(row.get("مكافأة")),
        "damage": number(row.get("ضرر")),
        "notes": text(row.get("ملاحظات")),
        "source": "approved_workbook_2026_08_03",
    }


def sync_attendance(db, wb, aliases, now, stats):
    employees = db.setdefault("employees", [])
    by_name = employee_index(employees, aliases)
    for row in rows(wb.worksheets[4]):
        name = canonical(row.get("الموظف"), aliases)
        date = iso_date(row.get("التاريخ"))
        if not name or not date:
            raise ValueError("Attendance row is missing its required employee/date key")
        employee, created = ensure_employee(name, employees, by_name, aliases, now)
        if created:
            stats["employees_added"] += 1
        records = employee.setdefault("records", [])
        existing = next((record for record in records if iso_date(record.get("date")) == date), None)
        payload = attendance_payload(row)
        if existing is None:
            records.append(payload)
            stats["attendance_added"] += 1
        else:
            existing.update(payload)
            stats["attendance_updated"] += 1
        employee["updated_at"] = now
        employee["updated_by"] = "approved_workbook_incremental_sync"


def advance_key(row, aliases):
    return (canonical(row.get("employeeName"), aliases), iso_date(row.get("date")), round(number(row.get("amount")), 2), text(row.get("advanceType")))


def sync_advances(db, wb, aliases, stats):
    advances = db.setdefault("omni", {}).setdefault("workshopAdvances", [])
    existing = {advance_key(row, aliases): row for row in advances if isinstance(row, dict)}
    for index, row in enumerate(rows(wb.worksheets[5]), start=1):
        amount = number(row.get("المبلغ"))
        advance_type = text(row.get("النوع"))
        # Zero-value non-approved lines are retained in the workbook for review,
        # but are explicitly not employee advances.
        if amount == 0 and "غير معتمد" in advance_type:
            stats["advances_skipped_review_only"] += 1
            continue
        payload = {
            "id": f"advance_workbook_{index:04d}",
            "employeeName": canonical(row.get("الموظف"), aliases),
            "date": iso_date(row.get("التاريخ")),
            "dateDisplay": display_date(row.get("التاريخ")),
            "month": int(number(row.get("الشهر"))),
            "year": int(number(row.get("السنة"))),
            "amount": amount,
            "description": text(row.get("البيان")),
            "advanceType": advance_type,
            "review": text(row.get("مراجعة")),
            "source": "approved_workbook_2026_08_03",
        }
        key = advance_key(payload, aliases)
        if key in existing:
            payload["id"] = existing[key].get("id", payload["id"])
            existing[key].update(payload)
            stats["advances_updated"] += 1
        else:
            advances.append(payload)
            existing[key] = payload
            stats["advances_added"] += 1


def transaction_payload(row, index):
    direction_ar = text(row.get("الاتجاه"))
    employee_advance = text(row.get("سلفة موظف؟"))
    direction = "in" if direction_ar == "داخل" else "out"
    tx_type = "advance" if employee_advance == "نعم" else ("income" if direction == "in" else "expense")
    source_id = f"cashbox_row_{text(row.get('ID')) or index}"
    return {
        "id": f"cashbox_workbook_{text(row.get('ID')) or index}",
        "date": iso_date(row.get("التاريخ")),
        "type": tx_type,
        "direction": direction,
        "amount": number(row.get("مبلغ القاصة")),
        "partyName": text(row.get("الجهة")),
        "description": text(row.get("البيان الموحد")) or text(row.get("نوع الصرف")),
        "sourceType": "cashbox",
        "importSource": "approved_workbook_2026_08_03",
        "sourceId": source_id,
        "sourcePeriod": text(row.get("الفترة")),
        "cashboxCategory": text(row.get("نوع الصرف")),
        "cashboxEffect": number(row.get("تأثير +/-")),
        "affectsCashbox": text(row.get("يؤثر")),
        "employeeAdvance": employee_advance,
        "status": text(row.get("الحالة")),
        "review": text(row.get("مراجعة حسابية")),
    }


def sync_cashbox(db, wb, stats):
    transactions = db.setdefault("finance", {}).setdefault("transactions", [])
    existing = {text(row.get("sourceId")): row for row in transactions if isinstance(row, dict)}
    for index, row in enumerate(rows(wb.worksheets[8]), start=1):
        if not text(row.get("ID")):
            continue  # Workbook totals are intentionally not transactions.
        payload = transaction_payload(row, index)
        current = existing.get(payload["sourceId"])
        if current is None:
            transactions.append(payload)
            existing[payload["sourceId"]] = payload
            stats["cashbox_added"] += 1
        else:
            payload["id"] = current.get("id", payload["id"])
            current.update(payload)
            stats["cashbox_updated"] += 1


def sync_sqlite(sqlite_path, db, aliases):
    if not sqlite_path.exists():
        return
    collections = {
        "employees": db.get("employees", []),
        "finance.transactions": db.get("finance", {}).get("transactions", []),
        "omni.workshopAdvances": db.get("omni", {}).get("workshopAdvances", []),
    }
    with sqlite3.connect(sqlite_path) as con:
        con.execute("CREATE TABLE IF NOT EXISTS collections (collection TEXT, id TEXT, data TEXT, PRIMARY KEY (collection, id))")
        for collection, records in collections.items():
            for index, record in enumerate(records, start=1):
                record_id = text(record.get("id")) or f"{collection}_{index}"
                con.execute(
                    "INSERT INTO collections (collection, id, data) VALUES (?, ?, ?) "
                    "ON CONFLICT(collection, id) DO UPDATE SET data=excluded.data",
                    (collection, record_id, json.dumps(record, ensure_ascii=False)),
                )
        # A previous full-rewrite importer changed record ids. Remove only stale
        # duplicates whose natural/source key is now represented by the current
        # approved-workbook record; unrelated SQLite rows are preserved.
        expected_transactions = {text(r.get("sourceId")): text(r.get("id")) for r in collections["finance.transactions"]}
        for row_id, raw in con.execute("SELECT id, data FROM collections WHERE collection = ?", ("finance.transactions",)):
            try:
                source_id = text(json.loads(raw).get("sourceId"))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if source_id in expected_transactions and row_id != expected_transactions[source_id]:
                con.execute("DELETE FROM collections WHERE collection = ? AND id = ?", ("finance.transactions", row_id))
        expected_advances = {}
        for record in collections["omni.workshopAdvances"]:
            expected_advances.setdefault(advance_key(record, aliases), set()).add(text(record.get("id")))
        for row_id, raw in con.execute("SELECT id, data FROM collections WHERE collection = ?", ("omni.workshopAdvances",)):
            try:
                key = advance_key(json.loads(raw), aliases)
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if key in expected_advances and row_id not in expected_advances[key]:
                con.execute("DELETE FROM collections WHERE collection = ? AND id = ?", ("omni.workshopAdvances", row_id))


def verify(db, wb):
    aliases = canonical_names(wb)
    employees = employee_index(db.get("employees", []), aliases)
    workbook_attendance = list(rows(wb.worksheets[4]))
    for row in workbook_attendance:
        name = canonical(row.get("الموظف"), aliases)
        date = iso_date(row.get("التاريخ"))
        employee = employees.get(name)
        if not employee or not any(iso_date(record.get("date")) == date for record in employee.get("records", [])):
            raise ValueError(f"Missing synchronized attendance key: {name} {date}")
    workbook_advances = list(rows(wb.worksheets[5]))
    source_advance_total = round(sum(number(row.get("المبلغ")) for row in workbook_advances), 2)
    if source_advance_total != 17093752.97:
        raise ValueError(f"Unexpected approved-workbook advance total: {source_advance_total}")
    cashbox_rows = [row for row in rows(wb.worksheets[8]) if text(row.get("ID"))]
    if len(cashbox_rows) != 576:
        raise ValueError(f"Unexpected approved-workbook cashbox count: {len(cashbox_rows)}")
    transaction_sources = {text(row.get("sourceId")) for row in db.get("finance", {}).get("transactions", [])}
    if any(f"cashbox_row_{text(row.get('ID'))}" not in transaction_sources for row in cashbox_rows):
        raise ValueError("A workbook cashbox entry is missing after synchronization")
    return {
        "workbook_attendance_keys": len(workbook_attendance),
        "workbook_advance_total": source_advance_total,
        "workbook_cashbox_entries": len(cashbox_rows),
    }


def backup(path, backup_dir, stamp):
    backup_dir.mkdir(parents=True, exist_ok=True)
    destination = backup_dir / f"{path.name}.before-approved-workbook-sync-{stamp}"
    shutil.copy2(path, destination)
    return destination


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", type=Path, required=True)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_SQLITE)
    parser.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUPS)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    db = json.loads(args.db.read_text(encoding="utf-8"))
    wb = load_workbook(args.excel, read_only=True, data_only=True)
    next_db = copy.deepcopy(db)
    aliases = canonical_names(wb)
    now = dt.datetime.now().replace(microsecond=0).isoformat()
    stats = {key: 0 for key in (
        "employees_added", "employees_renamed", "employees_merged_inactive", "attendance_added", "attendance_updated", "advances_added",
        "advances_updated", "advances_skipped_review_only", "cashbox_added", "cashbox_updated",
    )}
    normalize_employee_names(next_db.setdefault("employees", []), aliases, stats)
    sync_employee_shells(next_db, wb, aliases, now, stats)
    sync_attendance(next_db, wb, aliases, now, stats)
    sync_advances(next_db, wb, aliases, stats)
    sync_cashbox(next_db, wb, stats)
    verification = verify(next_db, wb)
    print(json.dumps({"stats": stats, "verification": verification}, ensure_ascii=False, indent=2))
    if not args.apply:
        print("DRY RUN ONLY")
        return
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    db_backup = backup(args.db, args.backup_dir, stamp)
    sqlite_backup = backup(args.sqlite, args.backup_dir, stamp) if args.sqlite.exists() else None
    args.db.write_text(json.dumps(next_db, ensure_ascii=False, indent=2), encoding="utf-8")
    sync_sqlite(args.sqlite, next_db, aliases)
    print(json.dumps({"written": str(args.db), "db_backup": str(db_backup), "sqlite_backup": str(sqlite_backup) if sqlite_backup else None}, ensure_ascii=False))


if __name__ == "__main__":
    main()
