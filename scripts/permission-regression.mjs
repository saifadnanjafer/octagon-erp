/**
 * Read-only permission regression script.
 * Loads services/permissionService.js under a browser-like globalThis stub
 * and asserts expected allow/deny outcomes for the QA users.
 *
 * Usage (from octagon-erp/):
 *   node scripts/permission-regression.mjs
 *
 * Exits non-zero if any assertion fails.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'services', 'permissionService.js');
const src = fs.readFileSync(FILE, 'utf8');

const sandboxWindow = {};
sandboxWindow.window = sandboxWindow;
sandboxWindow.PentagonAuth = { getCurrentUser: () => null };
sandboxWindow.console = console;

vm.createContext(sandboxWindow);
vm.runInContext(src, sandboxWindow, { filename: 'permissionService.js' });

const PS = sandboxWindow.PermissionService;
if (!PS) {
  console.error('FAIL: PermissionService not exposed');
  process.exit(1);
}

const USERS = {
  qa_workshop_only: { id: 'qa_workshop_only', groups: ['workshop.user'] },
  mgr_workshop:     { id: 'mgr_workshop',     groups: ['workshop.manager'] },
  qa_finance_only:  { id: 'qa_finance_only',  groups: ['finance.user'] },
  mgr_finance:      { id: 'mgr_finance',      groups: ['finance.manager'] },
  qa_no_v5_groups:  { id: 'qa_no_v5_groups',  groups: [] },
  admin:            { id: 'admin',            groups: ['system.admin'] },
};

const CASES = [
  // [label, fn, expected]
  ['workshop user can read employees',
    () => PS.check('employees', 'read', USERS.qa_workshop_only), true],
  ['workshop user cannot create employees',
    () => PS.check('employees', 'create', USERS.qa_workshop_only), false],
  ['workshop user cannot delete employees',
    () => PS.check('employees', 'delete', USERS.qa_workshop_only), false],
  ['workshop manager can update employees',
    () => PS.check('employees', 'update', USERS.mgr_workshop), true],
  ['workshop user cannot see salary',
    () => PS.checkField('employees', 'salary', USERS.qa_workshop_only), false],
  ['workshop manager can see salary',
    () => PS.checkField('employees', 'salary', USERS.mgr_workshop), true],
  ['finance user can see salary',
    () => PS.checkField('employees', 'salary', USERS.qa_finance_only), true],
  ['workshop user cannot see prevAdvance/advance/bonus/damage/penalty',
    () => ['prevAdvance','advance','bonus','damage','penalty']
      .every(f => PS.checkField('employees', f, USERS.qa_workshop_only) === false), true],
  ['finance user cannot access workshop page',
    () => PS.checkPage('inventory', USERS.qa_finance_only), false],
  ['workshop user cannot access finance page',
    () => PS.checkPage('finance', USERS.qa_workshop_only), false],
  ['no-groups user cannot access finance',
    () => PS.checkPage('finance', USERS.qa_no_v5_groups), false],
  ['no-groups user cannot access inventory',
    () => PS.checkPage('inventory', USERS.qa_no_v5_groups), false],
  ['admin can access settings',
    () => PS.checkPage('settings', USERS.admin), true],
  ['admin can delete journal entries',
    () => PS.check('journal_entries', 'delete', USERS.admin), true],
  ['finance user can read journal entries',
    () => PS.check('journal_entries', 'read', USERS.qa_finance_only), true],
  ['finance user cannot update journal entries',
    () => PS.check('journal_entries', 'update', USERS.qa_finance_only), false],
  ['finance manager can update journal entries',
    () => PS.check('journal_entries', 'update', USERS.mgr_finance), true],
  ['workshop user cannot read journal entries',
    () => PS.check('journal_entries', 'read', USERS.qa_workshop_only), false],
  ['require denies workshop user employees.create',
    () => { try { PS.require('employees', 'create', USERS.qa_workshop_only); return 'no-throw'; } catch (e) { return 'threw'; } }, 'threw'],
  ['require allows workshop manager employees.update',
    () => { try { PS.require('employees', 'update', USERS.mgr_workshop); return true; } catch (e) { return false; } }, true],
];

let pass = 0, fail = 0;
for (const [label, fn, expected] of CASES) {
  let actual;
  try { actual = fn(); } catch (e) { actual = `error: ${e.message}`; }
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  expected=${expected}  actual=${actual}`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail === 0 ? 0 : 1);
