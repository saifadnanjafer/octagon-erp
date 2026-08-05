import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';

export async function openWorkshopFixture(t, name = 'fixture') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-workshop-${name}-`));
  const dbPath = path.join(directory, 'workshop.db');
  await freshInstall({ dbPath, backupDir: path.join(directory, 'backups'), actor: `workshop-${name}` });
  const dialect = openMigrationDatabase(dbPath);
  t.after(() => {
    dialect.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    dialect,
    ctx: {
      companyId: 'default', activeCompanyId: 'default', branchId: 'branch-a',
      warehouseId: 'wh-main', actorId: 'operator-a', userId: 'operator-a', locale: 'en', direction: 'ltr',
    },
  };
}

export function insertWorkItem(dialect, overrides = {}) {
  const stamp = new Date().toISOString();
  const row = {
    id: `wi-${Math.random().toString(36).slice(2)}`,
    companyId: 'default', branchId: 'branch-a', title: 'Workshop task', sourceType: 'task',
    status: 'todo', stage: 'backlog', priority: 'medium', assignedUserId: 'operator-a',
    dueDate: new Date(Date.now() + 86400000).toISOString(), createdAt: stamp, updatedAt: stamp,
    ...overrides,
  };
  dialect.prepare(`INSERT INTO work_items(
    id,company_id,branch_id,title,source_type,status,stage,priority,assigned_user_id,due_date,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.companyId, row.branchId, row.title, row.sourceType, row.status, row.stage,
    row.priority, row.assignedUserId, row.dueDate, row.createdAt, row.updatedAt,
  );
  return row;
}

