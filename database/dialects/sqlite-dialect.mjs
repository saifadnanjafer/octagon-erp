import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite dialect for the Octagon migration runner.
 *
 * Source composition:
 * - VNext migration runner used node:sqlite directly; this dialect wraps that
 *   behavior into the target dialect abstraction so PostgreSQL can be swapped
 *   in later without changing migration or runner code.
 */
export class SqliteDialect {
  name = 'sqlite';

  constructor() {
    if (!DatabaseSync) {
      throw new Error('node:sqlite is not available in this Node.js version');
    }
  }

  open(dbPath) {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    return this;
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  close() {
    this.db.close();
  }

  backup(dbPath, backupPath) {
    // SQLite-specific VACUUM INTO backup
    this.db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}';`);
    return backupPath;
  }

  sqlString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
  }
}
