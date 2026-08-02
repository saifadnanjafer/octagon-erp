// Governed Document Templates and Printing Service
'use strict';

import crypto from 'node:crypto';

export class DocumentTemplateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DocumentTemplateError';
    this.code = code;
  }
}

export class DocumentTemplateService {
  constructor(dialect, { now = () => new Date() } = {}) {
    this.dialect = dialect;
    this.now = now;
  }

  #now() { return this.now().toISOString(); }

  #row(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      name: r.name,
      docType: r.doc_type,
      bodyHtml: r.body_html,
      locale: r.locale,
      barcodeType: r.barcode_type,
      isActive: r.is_active === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createTemplate({ name, companyId = 'default', docType = 'pdf', bodyHtml = '', locale = 'ar', barcodeType = 'QR' }, ctx) {
    if (!name) {
      throw new DocumentTemplateError('name is required', 'TEMPLATE_INVALID_INPUT');
    }
    const id = `tmpl_${crypto.randomUUID()}`;
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO governed_document_templates
        (id, company_id, name, doc_type, body_html, locale, barcode_type, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, companyId, name, docType, bodyHtml, locale, barcodeType, now, now);

    return this.getTemplate(id);
  }

  getTemplate(id) {
    const row = this.dialect.prepare('SELECT * FROM governed_document_templates WHERE id = ?').get(id);
    return this.#row(row);
  }

  listTemplates({ docType, companyId } = {}) {
    let sql = 'SELECT * FROM governed_document_templates WHERE is_active = 1';
    const params = [];
    if (companyId) {
      sql += ' AND company_id = ?';
      params.push(companyId);
    }
    if (docType) {
      sql += ' AND doc_type = ?';
      params.push(docType);
    }
    sql += ' ORDER BY created_at DESC';
    return this.dialect.prepare(sql).all(...params).map(r => this.#row(r));
  }

  renderDocument(templateId, payload = {}) {
    const template = this.getTemplate(templateId);
    if (!template || !template.isActive) {
      throw new DocumentTemplateError('Template not found or inactive', 'TEMPLATE_NOT_FOUND');
    }

    const content = template.bodyHtml;
    const rendered = String(content || '').replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, path) => {
      const val = path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), payload);
      return val == null ? '' : String(val);
    });

    return {
      templateId: template.id,
      docType: template.docType,
      content: rendered,
      renderedAt: this.#now(),
    };
  }
}

export function createDocumentTemplateService(dialect, deps) {
  return new DocumentTemplateService(dialect, deps);
}
