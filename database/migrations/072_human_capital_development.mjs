// database/migrations/072_human_capital_development.mjs — Human Capital Development Module Migration.

export const migration = {
  id: '072_human_capital_development',
  description: 'Migration 072: Human Capital Development (Recruitment, Onboarding, Training, Performance Appraisals, Leave Requests)',

  async up(db) {
    // 1. Job Openings
    db.prepare(`
      CREATE TABLE IF NOT EXISTS job_openings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        job_code TEXT NOT NULL,
        title TEXT NOT NULL,
        department_id TEXT,
        headcount INTEGER NOT NULL DEFAULT 1,
        employment_type TEXT NOT NULL DEFAULT 'full_time', -- full_time, part_time, contract, intern
        description TEXT,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, open, filled, closed, cancelled
        opened_at TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_job_openings_company_status
      ON job_openings(company_id, status)
    `).run();

    // 2. Job Applications
    db.prepare(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        application_number TEXT NOT NULL,
        job_opening_id TEXT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
        candidate_name TEXT NOT NULL,
        candidate_email TEXT NOT NULL,
        candidate_phone TEXT,
        resume_url TEXT,
        status TEXT NOT NULL DEFAULT 'applied', -- applied, screening, interview, offer, hired, rejected
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        rejection_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 3. Interview Schedules
    db.prepare(`
      CREATE TABLE IF NOT EXISTS interview_schedules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
        round_name TEXT NOT NULL DEFAULT 'Initial Screening', -- Technical, HR, Managerial
        interviewer_id TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        location_or_link TEXT,
        rating REAL, -- 1.0 to 5.0
        feedback_notes TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, completed, cancelled
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 4. Job Offers
    db.prepare(`
      CREATE TABLE IF NOT EXISTS job_offers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        offer_number TEXT NOT NULL,
        application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
        offered_role TEXT NOT NULL,
        offered_salary REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        start_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, accepted, declined
        sent_at TEXT,
        responded_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 5. Onboarding Checklists
    db.prepare(`
      CREATE TABLE IF NOT EXISTS onboarding_checklists (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'IT & Access', -- HR, IT, Safety, Training
        assigned_to TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, completed
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 6. Training Courses
    db.prepare(`
      CREATE TABLE IF NOT EXISTS training_courses (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        course_code TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        instructor_name TEXT,
        duration_hours REAL NOT NULL DEFAULT 1.0,
        pass_score REAL NOT NULL DEFAULT 70.0,
        is_mandatory INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 7. Training Enrollments
    db.prepare(`
      CREATE TABLE IF NOT EXISTS training_enrollments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        course_id TEXT NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL,
        enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'enrolled', -- enrolled, in_progress, passed, failed
        score REAL,
        completed_at TEXT,
        certificate_url TEXT
      )
    `).run();

    // 8. Performance Appraisals
    db.prepare(`
      CREATE TABLE IF NOT EXISTS performance_appraisals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        appraisal_number TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        reviewer_id TEXT NOT NULL,
        period_name TEXT NOT NULL, -- e.g. 2026 Annual, 2026-H1
        self_rating REAL,
        manager_rating REAL,
        final_score REAL,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, self_submitted, reviewed, finalized
        feedback_summary TEXT,
        finalized_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 9. Performance KPIs
    db.prepare(`
      CREATE TABLE IF NOT EXISTS performance_kpis (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        appraisal_id TEXT NOT NULL REFERENCES performance_appraisals(id) ON DELETE CASCADE,
        kpi_title TEXT NOT NULL,
        target_description TEXT,
        weight_percentage REAL NOT NULL DEFAULT 100.0,
        achieved_score REAL,
        comments TEXT
      )
    `).run();

    // 10. Leave Types
    db.prepare(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        annual_quota_days REAL NOT NULL DEFAULT 20.0,
        requires_attachment INTEGER NOT NULL DEFAULT 0,
        is_paid INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 11. Leave Requests
    db.prepare(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        request_number TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        total_days REAL NOT NULL DEFAULT 1.0,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'requested', -- requested, approved, rejected, cancelled
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_leave_requests_company_status
      ON leave_requests(company_id, status)
    `).run();

    // 12. Leave Balances
    db.prepare(`
      CREATE TABLE IF NOT EXISTS leave_balances (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
        year INTEGER NOT NULL DEFAULT 2026,
        allocated_days REAL NOT NULL DEFAULT 0.0,
        used_days REAL NOT NULL DEFAULT 0.0,
        remaining_days REAL NOT NULL DEFAULT 0.0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'leave_balances',
      'leave_requests',
      'leave_types',
      'performance_kpis',
      'performance_appraisals',
      'training_enrollments',
      'training_courses',
      'onboarding_checklists',
      'job_offers',
      'interview_schedules',
      'job_applications',
      'job_openings'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
