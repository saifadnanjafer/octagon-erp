// 067_contracts_and_legal_management.mjs — Wave 2, W2-M1 (Contracts and Legal Management).
//
// Governed Contracts & Legal schema over canonical Party, Sales, Procurement, Projects, Finance, and Documents.

const MIGRATION_ID = '067_contracts_and_legal_management';
const MODULE_ID = 'contracts';

export const migration = {
  id: MIGRATION_ID,
  owner: 'octagon.contracts',
  version: '2.1.0',
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Wave 2 W2-M1 Contracts and Legal Management',

  up(db, { dialect }) {
    db.exec(`
      -- Contract Types Configuration
      CREATE TABLE IF NOT EXISTS contract_types (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        code TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'commercial', -- commercial, procurement, employment, nda, lease, legal
        requires_approval INTEGER NOT NULL DEFAULT 1,
        default_notice_period_days INTEGER NOT NULL DEFAULT 30,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_type_code ON contract_types(company_id, code);

      -- Clause Library
      CREATE TABLE IF NOT EXISTS contract_clause_library (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        category TEXT NOT NULL DEFAULT 'general',
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        body_ar TEXT NOT NULL,
        body_en TEXT NOT NULL,
        is_standard INTEGER NOT NULL DEFAULT 1,
        is_mandatory INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Main Contracts Table
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        contract_number TEXT NOT NULL,
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        type_id TEXT NOT NULL REFERENCES contract_types(id),
        party_id TEXT REFERENCES parties(id),
        project_id TEXT,
        sale_order_id TEXT,
        purchase_order_id TEXT,
        invoice_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, internal_review, counterparty_review, approved, signature_pending, active, expiring, renewed, completed, terminated, suspended, disputed, cancelled, superseded
        contract_value REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        start_date TEXT,
        end_date TEXT,
        notice_period_days INTEGER NOT NULL DEFAULT 30,
        auto_renew INTEGER NOT NULL DEFAULT 0,
        governing_law TEXT DEFAULT 'Iraqi Law',
        jurisdiction TEXT DEFAULT 'Baghdad Courts',
        owner_user_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT 'system',
        updated_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_number ON contracts(company_id, contract_number);
      CREATE INDEX IF NOT EXISTS idx_contract_party ON contracts(company_id, party_id);
      CREATE INDEX IF NOT EXISTS idx_contract_status ON contracts(company_id, status);

      -- Contract Parties (Multi-party support)
      CREATE TABLE IF NOT EXISTS contract_parties (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        party_id TEXT NOT NULL REFERENCES parties(id),
        role TEXT NOT NULL DEFAULT 'counterparty', -- primary, counterparty, guarantor, witness, legal_representative
        signatory_name TEXT DEFAULT '',
        signatory_title TEXT DEFAULT '',
        signatory_email TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );

      -- Contract Versions & History
      CREATE TABLE IF NOT EXISTS contract_versions (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        summary_of_changes TEXT DEFAULT '',
        document_file_id TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Contract Clauses (Instantiated per Contract)
      CREATE TABLE IF NOT EXISTS contract_clauses (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        clause_library_id TEXT REFERENCES contract_clause_library(id),
        section_number TEXT NOT NULL DEFAULT '1.0',
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        body_ar TEXT NOT NULL,
        body_en TEXT NOT NULL,
        is_custom INTEGER NOT NULL DEFAULT 0,
        sequence INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      -- Contract Obligations
      CREATE TABLE IF NOT EXISTS contract_obligations (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL DEFAULT '*',
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        responsible_party TEXT NOT NULL DEFAULT 'internal', -- internal, counterparty, third_party
        assigned_user_id TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, fulfilled, breached, waived
        fulfilled_at TEXT,
        fulfillment_evidence TEXT DEFAULT '',
        penalty_amount REAL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Contract Milestones
      CREATE TABLE IF NOT EXISTS contract_milestones (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        due_date TEXT NOT NULL,
        amount REAL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, achieved, delayed, cancelled
        achieved_at TEXT,
        created_at TEXT NOT NULL
      );

      -- Contract Renewals
      CREATE TABLE IF NOT EXISTS contract_renewals (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        renewal_number INTEGER NOT NULL DEFAULT 1,
        previous_end_date TEXT NOT NULL,
        new_end_date TEXT NOT NULL,
        revised_value REAL,
        renewal_notes TEXT DEFAULT '',
        renewed_by TEXT NOT NULL,
        renewed_at TEXT NOT NULL
      );

      -- Contract Amendments
      CREATE TABLE IF NOT EXISTS contract_amendments (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        amendment_number INTEGER NOT NULL,
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        description TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, approved, active
        approved_by TEXT,
        approved_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Contract Approvals
      CREATE TABLE IF NOT EXISTS contract_approvals (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        step_name TEXT NOT NULL,
        approver_user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
        comments TEXT DEFAULT '',
        actioned_at TEXT,
        created_at TEXT NOT NULL
      );

      -- Signature Request Foundation
      CREATE TABLE IF NOT EXISTS contract_signature_requests (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        signatory_email TEXT NOT NULL,
        signatory_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent', -- sent, viewed, signed, declined, expired
        signed_at TEXT,
        signature_ip TEXT,
        signature_hash TEXT,
        created_at TEXT NOT NULL
      );

      -- Contract Notices
      CREATE TABLE IF NOT EXISTS contract_notices (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        notice_type TEXT NOT NULL DEFAULT 'general', -- renewal_reminder, expiry_notice, breach_notice, termination_notice
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Legal Matters / Cases
      CREATE TABLE IF NOT EXISTS legal_matters (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        matter_number TEXT NOT NULL,
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        contract_id TEXT REFERENCES contracts(id),
        party_id TEXT REFERENCES parties(id),
        category TEXT NOT NULL DEFAULT 'litigation', -- litigation, arbitration, dispute, regulatory, advisory
        status TEXT NOT NULL DEFAULT 'open', -- open, in_progress, pending_court, resolved, closed
        assigned_lawyer TEXT DEFAULT '',
        estimated_cost REAL DEFAULT 0.0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_matter_number ON legal_matters(company_id, matter_number);

      -- Legal Document Links
      CREATE TABLE IF NOT EXISTS contract_document_links (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL,
        document_type TEXT NOT NULL DEFAULT 'contract_scan', -- contract_scan, annex, amendment_doc, legal_opinion, proof_of_execution
        notes TEXT DEFAULT '',
        uploaded_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Guarantees and Performance Bonds
      CREATE TABLE IF NOT EXISTS contract_guarantees (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL DEFAULT '*',
        guarantee_type TEXT NOT NULL DEFAULT 'performance_bond', -- performance_bond, advance_payment_guarantee, bid_bond, warranty_bond
        bank_name TEXT NOT NULL,
        reference_number TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        issue_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', -- active, released, claimed, expired
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Insurance Requirements
      CREATE TABLE IF NOT EXISTS contract_insurance_requirements (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        insurance_type TEXT NOT NULL DEFAULT 'general_liability', -- general_liability, professional_indemnity, workers_comp, property
        required_coverage REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        insurer_name TEXT DEFAULT '',
        policy_number TEXT DEFAULT '',
        expiry_date TEXT DEFAULT '',
        is_verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // Seed default contract types and standard clause library
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO contract_types (id, company_id, code, name_ar, name_en, category, created_at, updated_at)
      VALUES
        ('ct-comm-01', '*', 'COMMERCIAL', 'عقد تجاري', 'Commercial Agreement', 'commercial', '${now}', '${now}'),
        ('ct-proc-01', '*', 'PROCUREMENT', 'عقد توريد وشراء', 'Procurement & Supply Contract', 'procurement', '${now}', '${now}'),
        ('ct-nda-01', '*', 'NDA', 'اتفاقية عدم إفشاء', 'Non-Disclosure Agreement', 'legal', '${now}', '${now}'),
        ('ct-lease-01', '*', 'LEASE', 'عقد إيجار', 'Lease Agreement', 'lease', '${now}', '${now}');
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO contract_clause_library (id, company_id, category, title_ar, title_en, body_ar, body_en, created_at, updated_at)
      VALUES
        ('cl-gov-01', '*', 'governing_law', 'القانون الواجب التطبيق', 'Governing Law', 'خضع هذا العقد وأي نزاع ينشأ عنه لأحكام القوانين النافذة في جمهورية العراق.', 'This Contract shall be governed by and construed in accordance with the laws of the Republic of Iraq.', '${now}', '${now}'),
        ('cl-conf-01', '*', 'confidentiality', 'السرية والخصوصية', 'Confidentiality', 'يتعهد الطرفان بالحفاظ على سرية المعلومات المتبادلة وعدم إفشائها لأي طرف ثالث.', 'Both parties undertake to maintain strict confidentiality of all shared information.', '${now}', '${now}');
    `).run();

    // Register contracts module in platform_modules
    db.prepare(`
      INSERT OR REPLACE INTO platform_modules (
        id, code, name_ar, name_en, category, owner, version,
        is_installed, is_enabled, installed_at, updated_at
      ) VALUES (
        'contracts', 'contracts', 'إدارة العقود والشؤون القانونية', 'Contracts & Legal Management',
        'legal', 'octagon.contracts', '2.1.0', 1, 1, '${now}', '${now}'
      );
    `).run();

    // Register permissions in platform_permissions
    const perms = [
      ['contracts.view', 'عرض العقود', 'View Contracts'],
      ['contracts.create', 'إنشاء عقد', 'Create Contract'],
      ['contracts.update', 'تعديل عقد', 'Update Contract'],
      ['contracts.approve', 'اعتماد عقد', 'Approve Contract'],
      ['contracts.amend', 'تعديل ملحق عقد', 'Amend Contract'],
      ['contracts.renew', 'تجديد عقد', 'Renew Contract'],
      ['contracts.terminate', 'إنهاء عقد', 'Terminate Contract'],
      ['contracts.obligations.manage', 'إدارة الالتزامات', 'Manage Obligations'],
      ['contracts.legal.manage', 'إدارة القضايا القانونية', 'Manage Legal Matters']
    ];

    for (const [code, nAr, nEn] of perms) {
      db.prepare(`
        INSERT OR IGNORE INTO platform_permissions (id, module_id, code, name_ar, name_en, category, created_at)
        VALUES (?, 'contracts', ?, ?, ?, 'contracts', '${now}')
      `).run(`perm-${code}`, code, nAr, nEn);
    }
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS contract_insurance_requirements;
      DROP TABLE IF EXISTS contract_guarantees;
      DROP TABLE IF EXISTS contract_document_links;
      DROP TABLE IF EXISTS legal_matters;
      DROP TABLE IF EXISTS contract_notices;
      DROP TABLE IF EXISTS contract_signature_requests;
      DROP TABLE IF EXISTS contract_approvals;
      DROP TABLE IF EXISTS contract_amendments;
      DROP TABLE IF EXISTS contract_renewals;
      DROP TABLE IF EXISTS contract_milestones;
      DROP TABLE IF EXISTS contract_obligations;
      DROP TABLE IF EXISTS contract_clauses;
      DROP TABLE IF EXISTS contract_versions;
      DROP TABLE IF EXISTS contract_parties;
      DROP TABLE IF EXISTS contracts;
      DROP TABLE IF EXISTS contract_clause_library;
      DROP TABLE IF EXISTS contract_types;
    `);
  }
};
