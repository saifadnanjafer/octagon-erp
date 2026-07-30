// platform/domains/human_capital/service.mjs — Human Capital Development Domain Services.

export function generateJobCode(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `JOB-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM job_openings WHERE company_id = ? AND job_code LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateApplicationNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `APP-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM job_applications WHERE company_id = ? AND application_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateLeaveRequestNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `LR-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM leave_requests WHERE company_id = ? AND request_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createJobOpening(db, { company_id, title, department_id = null, headcount = 1, employment_type = 'full_time', description = null }) {
  const id = `job-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const code = generateJobCode(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO job_openings (id, company_id, job_code, title, department_id, headcount, employment_type, description, status, opened_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(id, company_id, code, title, department_id, headcount, employment_type, description, now, now, now);

  return db.prepare('SELECT * FROM job_openings WHERE id = ?').get(id);
}

export function submitApplication(db, { company_id, job_opening_id, candidate_name, candidate_email, candidate_phone = null, resume_url = null }) {
  const id = `app-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const appNum = generateApplicationNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO job_applications (id, company_id, application_number, job_opening_id, candidate_name, candidate_email, candidate_phone, resume_url, status, applied_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?)
  `).run(id, company_id, appNum, job_opening_id, candidate_name, candidate_email, candidate_phone, resume_url, now, now, now);

  return db.prepare('SELECT * FROM job_applications WHERE id = ?').get(id);
}

export function hireCandidate(db, { id, company_id }) {
  const app = db.prepare('SELECT * FROM job_applications WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!app) throw new Error(`Application ${id} not found`);

  const now = new Date().toISOString();
  db.prepare(`UPDATE job_applications SET status = 'hired', updated_at = ? WHERE id = ?`).run(now, id);

  return db.prepare('SELECT * FROM job_applications WHERE id = ?').get(id);
}

export function createCourse(db, { company_id, course_code, title, description = null, instructor_name = null, duration_hours = 1.0, pass_score = 70.0, is_mandatory = 0 }) {
  const id = `crs-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO training_courses (id, company_id, course_code, title, description, instructor_name, duration_hours, pass_score, is_mandatory, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, course_code, title, description, instructor_name, duration_hours, pass_score, is_mandatory, now);

  return db.prepare('SELECT * FROM training_courses WHERE id = ?').get(id);
}

export function enrollEmployeeInCourse(db, { company_id, course_id, employee_id }) {
  const id = `enr-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO training_enrollments (id, company_id, course_id, employee_id, enrolled_at, status)
    VALUES (?, ?, ?, ?, ?, 'enrolled')
  `).run(id, company_id, course_id, employee_id, now);

  return db.prepare('SELECT * FROM training_enrollments WHERE id = ?').get(id);
}

export function recordCourseCompletion(db, { id, company_id, score }) {
  const enr = db.prepare('SELECT e.*, c.pass_score FROM training_enrollments e JOIN training_courses c ON e.course_id = c.id WHERE e.id = ? AND e.company_id = ?').get(id, company_id);
  if (!enr) throw new Error(`Enrollment ${id} not found`);

  const now = new Date().toISOString();
  const status = score >= enr.pass_score ? 'passed' : 'failed';

  db.prepare(`
    UPDATE training_enrollments SET status = ?, score = ?, completed_at = ? WHERE id = ?
  `).run(status, score, now, id);

  return db.prepare('SELECT * FROM training_enrollments WHERE id = ?').get(id);
}

export function createLeaveType(db, { company_id, code, name, annual_quota_days = 20.0, requires_attachment = 0, is_paid = 1 }) {
  const id = `lt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO leave_types (id, company_id, code, name, annual_quota_days, requires_attachment, is_paid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, code, name, annual_quota_days, requires_attachment, is_paid, now);

  return db.prepare('SELECT * FROM leave_types WHERE id = ?').get(id);
}

export function requestLeave(db, { company_id, employee_id, leave_type_id, start_date, end_date, total_days, reason = null }) {
  const id = `lr-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const reqNum = generateLeaveRequestNumber(db, company_id);
  const now = new Date().toISOString();

  // Ensure balance record exists
  const year = new Date(start_date).getFullYear();
  let bal = db.prepare('SELECT * FROM leave_balances WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ?').get(company_id, employee_id, leave_type_id, year);
  if (!bal) {
    const lt = db.prepare('SELECT annual_quota_days FROM leave_types WHERE id = ?').get(leave_type_id);
    const quota = lt ? lt.annual_quota_days : 20.0;
    const balId = `bal-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    db.prepare(`
      INSERT INTO leave_balances (id, company_id, employee_id, leave_type_id, year, allocated_days, used_days, remaining_days, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?)
    `).run(balId, company_id, employee_id, leave_type_id, year, quota, quota, now);
    bal = db.prepare('SELECT * FROM leave_balances WHERE id = ?').get(balId);
  }

  if (bal.remaining_days < total_days) {
    throw new Error(`Insufficient leave balance. Remaining: ${bal.remaining_days} days, Requested: ${total_days} days.`);
  }

  db.prepare(`
    INSERT INTO leave_requests (id, company_id, request_number, employee_id, leave_type_id, start_date, end_date, total_days, reason, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
  `).run(id, company_id, reqNum, employee_id, leave_type_id, start_date, end_date, total_days, reason, now, now);

  return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
}

export function approveLeave(db, { id, company_id, approved_by }) {
  const lr = db.prepare('SELECT * FROM leave_requests WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!lr) throw new Error(`Leave request ${id} not found`);
  if (lr.status !== 'requested') throw new Error(`Cannot approve leave request in status: ${lr.status}`);

  const now = new Date().toISOString();
  const year = new Date(lr.start_date).getFullYear();

  db.prepare(`
    UPDATE leave_requests SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
  `).run(approved_by, now, now, id);

  // Deduct from remaining days
  db.prepare(`
    UPDATE leave_balances
    SET used_days = used_days + ?, remaining_days = remaining_days - ?, updated_at = ?
    WHERE company_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ?
  `).run(lr.total_days, lr.total_days, now, company_id, lr.employee_id, lr.leave_type_id, year);

  return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
}
