// Master Data Governance (MDG) Service
'use strict';

import crypto from 'node:crypto';

export class MdgError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MdgError';
    this.code = code;
  }
}

export class MasterDataGovernanceService {
  constructor(dialect, { now = () => new Date() } = {}) {
    this.dialect = dialect;
    this.now = now;
  }

  #now() { return this.now().toISOString(); }

  #candidateRow(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      entityType: r.entity_type,
      primaryRecordId: r.primary_record_id,
      candidateRecordId: r.candidate_record_id,
      confidenceScore: r.confidence_score,
      matchEvidence: typeof r.match_evidence === 'string' ? JSON.parse(r.match_evidence || '{}') : r.match_evidence,
      status: r.status,
      stewardNotes: r.steward_notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  #proposalRow(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      entityType: r.entity_type,
      survivingRecordId: r.surviving_record_id,
      mergedRecordId: r.merged_record_id,
      fieldResolutions: typeof r.field_resolutions === 'string' ? JSON.parse(r.field_resolutions || '{}') : r.field_resolutions,
      status: r.status,
      proposedBy: r.proposed_by,
      approvedBy: r.approved_by,
      rejectionReason: r.rejection_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  detectDuplicates({ companyId = 'default', entityType = 'party' }, ctx = {}) {
    const candidates = [];
    const now = this.#now();

    if (entityType === 'party') {
      const parties = this.dialect.prepare("SELECT * FROM parties WHERE company_id = ? OR company_id = '*'").all(companyId);
      for (let i = 0; i < parties.length; i++) {
        for (let j = i + 1; j < parties.length; j++) {
          const p1 = parties[i];
          const p2 = parties[j];
          let score = 0;
          const matchEvidence = {};

          if (p1.tax_id && p2.tax_id && p1.tax_id === p2.tax_id) {
            score += 0.95;
            matchEvidence.taxIdMatch = true;
          } else if (p1.name && p2.name && p1.name.trim().toLowerCase() === p2.name.trim().toLowerCase()) {
            score += 0.85;
            matchEvidence.nameMatch = true;
          }

          if (score >= 0.80) {
            const id = `mdg_dup_${crypto.randomUUID()}`;
            this.dialect.prepare(`
              INSERT INTO mdg_duplicate_candidates
                (id, company_id, entity_type, primary_record_id, candidate_record_id, confidence_score, match_evidence, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `).run(id, companyId, entityType, p1.id, p2.id, score, JSON.stringify(matchEvidence), now, now);
            candidates.push(this.getCandidate(id));
          }
        }
      }
    } else if (entityType === 'product') {
      const products = this.dialect.prepare('SELECT id, sku, name FROM products WHERE company_id = ? OR company_id = "*"').all(companyId);
      for (let i = 0; i < products.length; i++) {
        for (let j = i + 1; j < products.length; j++) {
          const pr1 = products[i];
          const pr2 = products[j];
          let score = 0;
          const matchEvidence = {};

          if (pr1.sku && pr2.sku && pr1.sku.trim().toLowerCase() === pr2.sku.trim().toLowerCase()) {
            score += 0.95;
            matchEvidence.skuMatch = true;
          }

          if (score >= 0.80) {
            const id = `mdg_dup_${crypto.randomUUID()}`;
            this.dialect.prepare(`
              INSERT INTO mdg_duplicate_candidates
                (id, company_id, entity_type, primary_record_id, candidate_record_id, confidence_score, match_evidence, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `).run(id, companyId, entityType, pr1.id, pr2.id, score, JSON.stringify(matchEvidence), now, now);
            candidates.push(this.getCandidate(id));
          }
        }
      }
    }

    return candidates;
  }

  getCandidate(id) {
    const row = this.dialect.prepare('SELECT * FROM mdg_duplicate_candidates WHERE id = ?').get(id);
    return this.#candidateRow(row);
  }

  listDuplicateCandidates({ companyId = 'default', entityType, status } = {}) {
    let sql = 'SELECT * FROM mdg_duplicate_candidates WHERE company_id = ? OR company_id = "*"';
    const params = [companyId];
    if (entityType) {
      sql += ' AND entity_type = ?';
      params.push(entityType);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY confidence_score DESC';
    return this.dialect.prepare(sql).all(...params).map(r => this.#candidateRow(r));
  }

  proposeMerge({ candidateId, survivingRecordId, mergedRecordId, fieldResolutions = {} }, ctx = {}) {
    const candidate = this.getCandidate(candidateId);
    if (!candidate) throw new MdgError('Duplicate candidate not found', 'CANDIDATE_NOT_FOUND');

    const id = `mdg_mrg_${crypto.randomUUID()}`;
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO mdg_merge_proposals
        (id, company_id, entity_type, surviving_record_id, merged_record_id, field_resolutions, status, proposed_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
    `).run(id, candidate.companyId, candidate.entityType, survivingRecordId, mergedRecordId, JSON.stringify(fieldResolutions), ctx.userId || 'system', now, now);

    this.dialect.prepare(`
      UPDATE mdg_duplicate_candidates
      SET status = 'confirmed_duplicate', updated_at = ?
      WHERE id = ?
    `).run(now, candidateId);

    return this.getMergeProposal(id);
  }

  getMergeProposal(id) {
    const row = this.dialect.prepare('SELECT * FROM mdg_merge_proposals WHERE id = ?').get(id);
    return this.#proposalRow(row);
  }

  approveMerge(proposalId, ctx = {}) {
    const proposal = this.getMergeProposal(proposalId);
    if (!proposal || proposal.status !== 'proposed') {
      throw new MdgError('Merge proposal not found or not in proposed state', 'INVALID_MERGE_PROPOSAL');
    }

    const now = this.#now();

    // Orchestrate governed merge without deleting historical records (save alias / lineage)
    this.dialect.prepare(`
      INSERT INTO x_records (id, entity, company_id, created_by, data, created_at, updated_at)
      VALUES (?, 'mdg_alias_lineage', ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      `alias_${proposal.mergedRecordId}`,
      proposal.companyId,
      ctx.userId || 'system',
      JSON.stringify({ mergedInto: proposal.survivingRecordId, entityType: proposal.entityType }),
      now,
      now
    );

    this.dialect.prepare(`
      UPDATE mdg_merge_proposals
      SET status = 'executed', approved_by = ?, updated_at = ?
      WHERE id = ?
    `).run(ctx.userId || 'system', now, proposalId);

    return this.getMergeProposal(proposalId);
  }

  rejectMerge(proposalId, reason = '', ctx = {}) {
    const proposal = this.getMergeProposal(proposalId);
    if (!proposal) throw new MdgError('Merge proposal not found', 'PROPOSAL_NOT_FOUND');

    const now = this.#now();
    this.dialect.prepare(`
      UPDATE mdg_merge_proposals
      SET status = 'rejected', rejection_reason = ?, approved_by = ?, updated_at = ?
      WHERE id = ?
    `).run(reason, ctx.userId || 'system', now, proposalId);

    return this.getMergeProposal(proposalId);
  }
}

export function createMasterDataGovernanceService(dialect, deps) {
  return new MasterDataGovernanceService(dialect, deps);
}
