// tests/module-wave-2/human_capital/human_capital.test.mjs — Integration tests for W2-M6 Human Capital Development.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m072 } from '../../../database/migrations/072_human_capital_development.mjs';
import * as hcService from '../../../platform/domains/human_capital/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-hc-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed Employee
  db.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('emp-hc-01', 'company-alpha', 'Ali Hassan (HSE Engineer)', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 072: Up, rerun, and schema verification', async () => {
  const env = await setup('m072-schema');
  try {
    await m072.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('job_openings', 'job_applications', 'training_courses', 'leave_requests', 'leave_balances')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m072.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Recruitment Lifecycle: Job Opening -> Application -> Hired', async () => {
  const env = await setup('recruitment');
  try {
    await m072.up(env.db);

    const job = hcService.createJobOpening(env.db, {
      company_id: 'company-alpha',
      title: 'Senior ERP Consultant',
      headcount: 2,
      employment_type: 'full_time'
    });
    assert.equal(job.status, 'open');
    assert.ok(job.job_code.startsWith('JOB-2026-'));

    const app = hcService.submitApplication(env.db, {
      company_id: 'company-alpha',
      job_opening_id: job.id,
      candidate_name: 'Zainab Kadhim',
      candidate_email: 'zainab@example.com',
      candidate_phone: '+9647700000000'
    });
    assert.equal(app.status, 'applied');
    assert.ok(app.application_number.startsWith('APP-2026-'));

    const hired = hcService.hireCandidate(env.db, {
      id: app.id,
      company_id: 'company-alpha'
    });
    assert.equal(hired.status, 'hired');
  } finally {
    cleanup(env);
  }
});

test('3. Training Lifecycle: Course Creation -> Enrollment -> Pass/Fail Score Recording', async () => {
  const env = await setup('training');
  try {
    await m072.up(env.db);

    const course = hcService.createCourse(env.db, {
      company_id: 'company-alpha',
      course_code: 'TRN-HSE-101',
      title: 'Industrial Safety & Risk Management',
      duration_hours: 8.0,
      pass_score: 80.0
    });
    assert.equal(course.pass_score, 80.0);

    const enr = hcService.enrollEmployeeInCourse(env.db, {
      company_id: 'company-alpha',
      course_id: course.id,
      employee_id: 'emp-hc-01'
    });
    assert.equal(enr.status, 'enrolled');

    const completed = hcService.recordCourseCompletion(env.db, {
      id: enr.id,
      company_id: 'company-alpha',
      score: 92.5
    });
    assert.equal(completed.status, 'passed');
    assert.equal(completed.score, 92.5);
  } finally {
    cleanup(env);
  }
});

test('4. Leave Request Lifecycle & Balance Deduction', async () => {
  const env = await setup('leave-lifecycle');
  try {
    await m072.up(env.db);

    const lt = hcService.createLeaveType(env.db, {
      company_id: 'company-alpha',
      code: 'ANNUAL',
      name: 'Annual Paid Leave',
      annual_quota_days: 20.0
    });

    const lr = hcService.requestLeave(env.db, {
      company_id: 'company-alpha',
      employee_id: 'emp-hc-01',
      leave_type_id: lt.id,
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      total_days: 5.0,
      reason: 'Summer Vacation'
    });
    assert.equal(lr.status, 'requested');
    assert.ok(lr.request_number.startsWith('LR-2026-'));

    const approved = hcService.approveLeave(env.db, {
      id: lr.id,
      company_id: 'company-alpha',
      approved_by: 'hr-mgr-01'
    });
    assert.equal(approved.status, 'approved');

    // Verify remaining leave balance is 15.0 (20.0 - 5.0)
    const bal = env.db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type_id = ?').get('emp-hc-01', lt.id);
    assert.equal(bal.used_days, 5.0);
    assert.equal(bal.remaining_days, 15.0);
  } finally {
    cleanup(env);
  }
});

test('5. Over-quota Leave Request Rejection', async () => {
  const env = await setup('leave-overquota');
  try {
    await m072.up(env.db);

    const lt = hcService.createLeaveType(env.db, {
      company_id: 'company-alpha',
      code: 'SICK',
      name: 'Sick Leave',
      annual_quota_days: 10.0
    });

    // Requesting 15 days when quota is 10 days
    assert.throws(() => {
      hcService.requestLeave(env.db, {
        company_id: 'company-alpha',
        employee_id: 'emp-hc-01',
        leave_type_id: lt.id,
        start_date: '2026-09-01',
        end_date: '2026-09-15',
        total_days: 15.0,
        reason: 'Extended recovery'
      });
    }, /Insufficient leave balance/);
  } finally {
    cleanup(env);
  }
});
