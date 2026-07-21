import { SqliteDialect } from './sqlite-dialect.mjs';
import { PostgresDialect } from './postgres-dialect.mjs';

export function createDialect(name) {
  if (name === 'sqlite') return new SqliteDialect();
  if (name === 'postgres') return new PostgresDialect();
  throw new Error(`Unknown dialect: ${name}`);
}

export function inferDialect(connectionStringOrPath) {
  if (typeof connectionStringOrPath === 'string' && connectionStringOrPath.startsWith('postgres')) {
    return 'postgres';
  }
  return 'sqlite';
}
