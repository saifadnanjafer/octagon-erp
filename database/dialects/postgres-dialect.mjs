/**
 * PostgreSQL dialect contract for the Octagon migration runner.
 *
 * Phase 01 scope: define the interface and fail closed if invoked without a
 * real pg driver. This prevents accidental production mutation and documents
 * the exact adapter contract to implement when PostgreSQL is added.
 */
export class PostgresDialect {
  name = 'postgres';

  open() {
    throw new Error(
      'PostgreSQL dialect is not yet configured in Phase 01. ' +
      'Install the pg driver, implement the adapter, and add a dialect test before using this dialect.'
    );
  }

  exec() {
    throw new Error('PostgreSQL dialect is not yet configured in Phase 01.');
  }

  prepare() {
    throw new Error('PostgreSQL dialect is not yet configured in Phase 01.');
  }

  close() {
    throw new Error('PostgreSQL dialect is not yet configured in Phase 01.');
  }

  backup() {
    throw new Error('PostgreSQL dialect is not yet configured in Phase 01.');
  }

  sqlString(value) {
    // PostgreSQL uses single-quoted literals with doubled quotes
    return `'${String(value).replaceAll("'", "''")}'`;
  }
}
