// Shared error type for the canonical Projects domain.
//
// The HTTP boundary (platform/api/index.mjs) turns any error carrying a
// machine-readable `code` into a 4xx with the code intact, so governed
// business denials stay distinguishable from server faults.

'use strict';

export class ProjectError extends Error {
  constructor(message, code = 'PROJECT_RULE_VIOLATION', statusCode = 422) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function fail(message, code, statusCode) {
  throw new ProjectError(message, code, statusCode);
}

export function requireFields(input, fields) {
  for (const field of fields) {
    const value = input[field];
    if (value === undefined || value === null || value === '') {
      fail(`${field} is required`, 'INPUT_MISSING_FIELD', 400);
    }
  }
}
