// Review Freeze — disposable People Development fixtures.
//
// Fictional demo rows for the BUILD-12 people-development tables (see
// database/migrations/089_build12_ai_people_marketing_events_pack.mjs for the
// real schema this is grounded in). Never real data, never written outside a
// disposable review database. All invented ids are prefixed `rev_` and every
// insert is idempotent via ON CONFLICT(id) DO NOTHING.
//
// `employees` / payroll / attendance / timesheet tables are the frozen zone
// (see the repo-root CLAUDE.md) and are never touched here. Instead these
// records attach to the disposable review identities that
// scripts/review/identities.mjs already seeds for this tenant
// (scripts/review/roles.mjs): the People Development Manager acts as the
// plan owner / evidence recorder, and the Employee Self-Service reviewer
// stands in as the demo employee whose development is being tracked.

'use strict';

const PEOPLE_MANAGER = 'usr_review_people_manager';
const DEMO_EMPLOYEE = 'usr_review_employee_self_service';

/**
 * @returns {Promise<{summary: object}>}
 */
export async function seedPeopleDevelopmentFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  const ts = now || new Date().toISOString();

  // A small skill catalog, scoped to this review tenant (the migration's own
  // SKILL_TEMPLATES seed lives under tenant 'default', not the review tenant).
  const SKILLS = [
    ['rev_skill_fiber_laser_demo', 'fiber_laser_demo', 'Fiber Laser Operation (Demo)'],
    ['rev_skill_quality_inspection_demo', 'quality_inspection_demo', 'Quality Inspection (Demo)'],
    ['rev_skill_customer_comms_demo', 'customer_communication_demo', 'Customer Communication (Demo)'],
  ];
  const insertSkill = dialect.prepare(`INSERT INTO people_skills(id,tenant_id,code,name,description,level_scale,status,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'active',1,?,?) ON CONFLICT(id) DO NOTHING`);
  for (const [id, code, name] of SKILLS) {
    insertSkill.run(id, tenantId, code, name, `DEMO - fictional review-environment skill: ${name}.`, '{"min":0,"max":5}', ts, ts);
  }

  // Competency profile for the demo employee across the seeded skills.
  const insertCompetency = dialect.prepare(`INSERT INTO people_competencies(id,tenant_id,person_id,skill_id,level,visibility,version,updated_at)
    VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(id) DO NOTHING`);
  insertCompetency.run('rev_competency_fiber_laser', tenantId, DEMO_EMPLOYEE, 'rev_skill_fiber_laser_demo', 3, 'team', ts);
  insertCompetency.run('rev_competency_quality_inspection', tenantId, DEMO_EMPLOYEE, 'rev_skill_quality_inspection_demo', 2, 'team', ts);

  // Skill evidence record, recorded by the People Development Manager.
  dialect.prepare(`INSERT INTO people_skill_evidence(id,tenant_id,person_id,skill_id,evidence_type,description,source_ref,observed_at,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_skill_evidence_1', tenantId, DEMO_EMPLOYEE, 'rev_skill_fiber_laser_demo', 'supervisor_observation',
      'DEMO - observed independently completing a fiber laser job setup and quality checkpoint.', 'rev_evidence_source_workshop_log', ts, PEOPLE_MANAGER, ts);

  // Development plan owned by the manager, for the demo employee.
  const dueAt = new Date(Date.parse(ts) + 90 * 86400000).toISOString();
  dialect.prepare(`INSERT INTO people_development_plans(id,tenant_id,person_id,title,objective,status,due_at,owner_id,ai_proposal_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_development_plan_1', tenantId, DEMO_EMPLOYEE, 'DEMO - Advance to Senior Fiber Laser Operator',
      'DEMO - Build independent competency across fiber laser setup, quality inspection, and customer handoff.',
      'active', dueAt, PEOPLE_MANAGER, null, ts, ts);

  // Expiring certification (inside the 30-day warning window used elsewhere
  // in BUILD-12's certification_warnings read model).
  const expiresAt = new Date(Date.parse(ts) + 20 * 86400000).toISOString();
  dialect.prepare(`INSERT INTO people_certifications(id,tenant_id,person_id,name,expires_at,status,evidence_ref,created_by,created_at)
    VALUES(?,?,?,?,?,'active',?,?,?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_certification_expiring_1', tenantId, DEMO_EMPLOYEE, 'DEMO - CO2 Laser Safety Certification', expiresAt, 'rev_evidence_cert_scan_1', PEOPLE_MANAGER, ts);

  // Completed learning activity.
  dialect.prepare(`INSERT INTO people_learning_records(id,tenant_id,person_id,course,provider,status,completed_at,evidence_ref,created_by,created_at)
    VALUES(?,?,?,?,?,'completed',?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_learning_record_1', tenantId, DEMO_EMPLOYEE, 'DEMO - Fiber Laser Advanced Techniques', 'DEMO Training Provider', ts, 'rev_evidence_learning_cert_1', PEOPLE_MANAGER, ts);

  return {
    summary: {
      skillsSeeded: SKILLS.length,
      competencyProfiles: 2,
      skillEvidenceRecords: 1,
      developmentPlans: 1,
      expiringCertifications: 1,
      completedLearningActivities: 1,
      person: DEMO_EMPLOYEE,
      owner: PEOPLE_MANAGER,
      tenantId, companyId, branchId,
    },
  };
}

export default seedPeopleDevelopmentFixtures;
