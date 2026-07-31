// tests/phase02/returns-rma.test.mjs — Returns/RMA consolidation over canonical authorities.
// Disposable databases only — see tests/phase02/harness.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, cleanup } from './harness.mjs';

import {
  createRMA,
  getRMA,
  listRMAs,
  submitRMA,
  approveRMA,
  rejectRMA,
  recordReceipt,
  recordInspection,
  recordDisposition,
  closeRMA,
  ReturnsError,
} from '../../platform/domains/returns/rma.mjs';
import {
  createDocument, submitDocument, approveDocument, postDocument,
} from '../../platform/finance/engine.mjs';
import { seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';

const CMP_A = 'cmp_A';
const CMP_B = 'cmp_B';
const CTX_A = { companyId: CMP_A, userId: 'u_sales' };
const CTX_B = { companyId: CMP_B, userId: 'u_sales_b' };

function seedCompany(dialect, id) {
  dialect.prepare(`INSERT INTO platform_tenants (id, name, status, created_at) VALUES ('t_default','Default','active',?) ON CONFLICT(id) DO NOTHING`).run(new Date().toISOString());
  dialect.prepare(`INSERT INTO platform_companies (id, tenant_id, name, status, fiscal_year_start, created_at) VALUES (?, 't_default', ?, 'active', 1, ?) ON CONFLICT(id) DO NOTHING`)
    .run(id, id, new Date().toISOString());
}

// Real product master rows — quality_inspections.product_id has a real FK to
// product_variants(id), so a synthetic id would fail closed rather than let
// a test paper over a schema mismatch.
function seedProduct(dialect, id, name) {
  const now = new Date().toISOString();
  dialect.prepare(`INSERT INTO product_templates (id, name, type, created_at) VALUES (?, ?, 'storable', ?) ON CONFLICT(id) DO NOTHING`)
    .run(`tpl_${id}`, name, now);
  dialect.prepare(`INSERT INTO product_variants (id, template_id, sku, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(id, `tpl_${id}`, id, name, now);
}

async function env(suite) {
  const { dialect, dbPath } = await setup(suite);
  seedCompany(dialect, CMP_A);
  seedCompany(dialect, CMP_B);
  for (const [id, name] of [['prod_99', 'Solar Inverter 5kW'], ['prod_55', 'POS Terminal'], ['p1', 'Item'], ['p2', 'B']]) {
    seedProduct(dialect, id, name);
  }
  return { dialect, dbPath };
}

test('1. RMA creation with a valid customer-return payload succeeds', async () => {
  const { dialect, dbPath } = await env('rma-1');
  try {
    const rma = createRMA(dialect, {
      customer_id: 'cust_101',
      customer_name: 'Al-Mansour Trading',
      source_document_id: 'doc_inv_1',
      source_document_number: 'INV-2026-0089',
      lines: [{ product_id: 'prod_99', product_name: 'Solar Inverter 5kW', qty_requested: 2, unit_price: 450.0, reason: 'Defective' }],
    }, CTX_A);

    assert.ok(rma.id.startsWith('rma_'));
    assert.equal(rma.status, 'draft');
    assert.equal(rma.company_id, CMP_A);
    assert.equal(rma.lines.length, 1);
    assert.equal(rma.timeline.length, 1);
    assert.equal(rma.timeline[0].action, 'create');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('2. Missing customer_id on a customer_return throws ReturnsError', async () => {
  const { dialect, dbPath } = await env('rma-2');
  try {
    assert.throws(() => {
      createRMA(dialect, { lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    }, (err) => err instanceof ReturnsError && err.code === 'MISSING_CUSTOMER');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('3. Invalid line quantity throws ReturnsError', async () => {
  const { dialect, dbPath } = await env('rma-3');
  try {
    assert.throws(() => {
      createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 0 }] }, CTX_A);
    }, (err) => err instanceof ReturnsError && err.code === 'INVALID_QUANTITY');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('4. Idempotent replay of create does not duplicate the RMA', async () => {
  const { dialect, dbPath } = await env('rma-4');
  try {
    const payload = {
      customer_id: 'cust_dup', idempotency_key: 'idem-001',
      lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }],
    };
    const first = createRMA(dialect, payload, CTX_A);
    const second = createRMA(dialect, payload, CTX_A);
    assert.equal(first.id, second.id);
    const count = dialect.prepare('SELECT COUNT(*) AS c FROM returns_rma WHERE company_id = ?').get(CMP_A).c;
    assert.equal(count, 1);
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('5. Cross-company access is denied at the domain layer', async () => {
  const { dialect, dbPath } = await env('rma-5');
  try {
    const rma = createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    assert.throws(() => {
      submitRMA(dialect, { id: rma.id }, CTX_B);
    }, (err) => err instanceof ReturnsError && err.code === 'CROSS_COMPANY_DENIED');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('6. Full lifecycle: submit -> approve -> receipt -> inspection(fail->NCR) -> disposition(repair->WorkItem) -> close', async () => {
  const { dialect, dbPath } = await env('rma-6');
  try {
    let rma = createRMA(dialect, {
      customer_id: 'cust_102', customer_name: 'Babylon Tech',
      lines: [{ product_id: 'prod_55', product_name: 'POS Terminal', qty_requested: 1, unit_price: 300 }],
    }, CTX_A);

    rma = submitRMA(dialect, { id: rma.id }, CTX_A);
    assert.equal(rma.status, 'submitted');

    rma = approveRMA(dialect, { id: rma.id, notes: 'Approved for return' }, CTX_A);
    assert.equal(rma.status, 'awaiting_receipt');

    rma = recordReceipt(dialect, { id: rma.id }, CTX_A);
    assert.equal(rma.status, 'under_inspection');

    rma = recordInspection(dialect, { id: rma.id, condition: 'damaged_screen', passes: false, ncr_title: 'Damaged POS Screen' }, CTX_A);
    assert.equal(rma.status, 'disposition_pending');
    assert.ok(rma.ncr_id, 'a real NCR must be created on failed inspection');
    const ncr = dialect.prepare('SELECT * FROM quality_ncrs WHERE id = ?').get(rma.ncr_id);
    assert.ok(ncr, 'the NCR row must exist in the real canonical quality_ncrs table');

    rma = recordDisposition(dialect, { id: rma.id, disposition: 'repair', notes: 'Screen replacement' }, CTX_A);
    assert.equal(rma.status, 'resolved');
    assert.equal(rma.disposition, 'repair');
    assert.ok(rma.work_item_id, 'a real Work Item must be created for a repair disposition');
    const wi = dialect.prepare('SELECT * FROM work_items WHERE id = ?').get(rma.work_item_id);
    assert.ok(wi, 'the Work Item row must exist in the real canonical work_items table');
    assert.equal(wi.quality_ref, rma.ncr_id, 'the Work Item must link back to the real NCR, proving cross-domain provenance');

    rma = closeRMA(dialect, { id: rma.id }, CTX_A);
    assert.equal(rma.status, 'closed');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('7. Approving an RMA in an invalid state is refused', async () => {
  const { dialect, dbPath } = await env('rma-7');
  try {
    const rma = createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    assert.throws(() => approveRMA(dialect, { id: rma.id }, CTX_A), (err) => err instanceof ReturnsError && err.code === 'INVALID_STATE');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('8. Rejection transitions the RMA to rejected', async () => {
  const { dialect, dbPath } = await env('rma-8');
  try {
    let rma = createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    rma = submitRMA(dialect, { id: rma.id }, CTX_A);
    rma = rejectRMA(dialect, { id: rma.id, reason: 'Warranty expired' }, CTX_A);
    assert.equal(rma.status, 'rejected');
    assert.equal(rma.notes, 'Warranty expired');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('9. Multi-company isolation in listRMAs', async () => {
  const { dialect, dbPath } = await env('rma-9');
  try {
    createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'A', qty_requested: 1 }] }, CTX_A);
    createRMA(dialect, { customer_id: 'c2', lines: [{ product_id: 'p2', product_name: 'B', qty_requested: 1 }] }, CTX_B);
    const listA = listRMAs(dialect, { company_id: CMP_A });
    const listB = listRMAs(dialect, { company_id: CMP_B });
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('10. Refund disposition without a source finance document is honestly refused, not fabricated', async () => {
  const { dialect, dbPath } = await env('rma-10');
  try {
    let rma = createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    rma = submitRMA(dialect, { id: rma.id }, CTX_A);
    rma = approveRMA(dialect, { id: rma.id }, CTX_A);
    rma = recordReceipt(dialect, { id: rma.id }, CTX_A);
    rma = recordInspection(dialect, { id: rma.id, passes: true }, CTX_A);
    assert.throws(() => {
      recordDisposition(dialect, { id: rma.id, disposition: 'refund' }, CTX_A);
    }, (err) => err instanceof ReturnsError && err.code === 'SOURCE_DOCUMENT_REQUIRED_FOR_REFUND');
    const reloaded = getRMA(dialect, rma.id);
    assert.equal(reloaded.credit_note_document_id, null, 'no fabricated credit note reference may be stored after a refused refund');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('11. Supplier return disposition without a purchase order is honestly refused, not fabricated', async () => {
  const { dialect, dbPath } = await env('rma-11');
  try {
    let rma = createRMA(dialect, {
      source_type: 'internal', customer_id: null,
      lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }],
    }, CTX_A);
    rma = submitRMA(dialect, { id: rma.id }, CTX_A);
    rma = approveRMA(dialect, { id: rma.id }, CTX_A);
    rma = recordReceipt(dialect, { id: rma.id }, CTX_A);
    rma = recordInspection(dialect, { id: rma.id, passes: true }, CTX_A);
    assert.throws(() => {
      recordDisposition(dialect, { id: rma.id, disposition: 'return_to_supplier' }, CTX_A);
    }, (err) => err instanceof ReturnsError && err.code === 'PURCHASE_ORDER_REQUIRED_FOR_SUPPLIER_RETURN');
    const reloaded = getRMA(dialect, rma.id);
    assert.equal(reloaded.supplier_return_id, null, 'no fabricated supplier-return reference may be stored after a refused disposition');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('12. Replace/refurbish/scrap dispositions record the decision without a fabricated side-effect reference', async () => {
  const { dialect, dbPath } = await env('rma-12');
  try {
    let rma = createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    rma = submitRMA(dialect, { id: rma.id }, CTX_A);
    rma = approveRMA(dialect, { id: rma.id }, CTX_A);
    rma = recordReceipt(dialect, { id: rma.id }, CTX_A);
    rma = recordInspection(dialect, { id: rma.id, passes: true }, CTX_A);
    rma = recordDisposition(dialect, { id: rma.id, disposition: 'scrap', notes: 'Beyond economical repair' }, CTX_A);
    assert.equal(rma.status, 'resolved');
    assert.equal(rma.disposition, 'scrap');
    assert.equal(rma.work_item_id, null);
    assert.equal(rma.credit_note_document_id, null);
    assert.equal(rma.supplier_return_id, null);
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('15. Refund disposition against a real posted invoice creates a real canonical credit note', async () => {
  const { dialect, dbPath } = await env('rma-15');
  try {
    const financeCtx = { companyId: CMP_A, userId: 'u_owner' };
    seedChartOfAccounts(dialect, { companyId: CMP_A, userId: 'u_owner' });
    const receivable = accountIdByCode(dialect, CMP_A, '103000');
    const income = accountIdByCode(dialect, CMP_A, '401000');
    const invoiceDraft = createDocument(dialect, financeCtx, {
      move_type: 'customer_invoice', doc_date: '2026-07-01', partner_id: 'cust_refund',
      lines: [{ account_id: receivable, debit: 100, credit: 0 }, { account_id: income, debit: 0, credit: 100 }],
    });
    submitDocument(dialect, financeCtx, { document_id: invoiceDraft.id });
    approveDocument(dialect, financeCtx, { document_id: invoiceDraft.id });
    const invoice = postDocument(dialect, financeCtx, { document_id: invoiceDraft.id });
    assert.equal(invoice.state, 'posted');

    let rma = createRMA(dialect, {
      customer_id: 'cust_refund', source_document_id: invoice.id, source_document_number: invoice.doc_number,
      lines: [{ product_id: 'prod_99', product_name: 'Solar Inverter 5kW', qty_requested: 1, unit_price: 100 }],
    }, CTX_A);
    rma = submitRMA(dialect, { id: rma.id }, CTX_A);
    rma = approveRMA(dialect, { id: rma.id }, CTX_A);
    rma = recordReceipt(dialect, { id: rma.id }, CTX_A);
    rma = recordInspection(dialect, { id: rma.id, passes: true }, CTX_A);
    rma = recordDisposition(dialect, { id: rma.id, disposition: 'refund' }, CTX_A);

    assert.equal(rma.status, 'resolved');
    assert.equal(rma.disposition, 'refund');
    assert.ok(rma.credit_note_document_id, 'a real credit note document id must be recorded');
    const creditNote = dialect.prepare('SELECT * FROM finance_documents WHERE id = ?').get(rma.credit_note_document_id);
    assert.ok(creditNote, 'the credit note must exist as a real row in the canonical finance_documents table');
    assert.equal(creditNote.move_type, 'customer_credit_note');
    assert.equal(creditNote.source_type, 'credit_note_of');
    assert.equal(creditNote.source_id, invoice.id, 'the credit note must link back to the real original invoice');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('13. Cannot close an RMA that is not resolved', async () => {
  const { dialect, dbPath } = await env('rma-13');
  try {
    const rma = createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    assert.throws(() => closeRMA(dialect, { id: rma.id }, CTX_A), (err) => err instanceof ReturnsError && err.code === 'INVALID_STATE');
  } finally {
    await cleanup(dialect, dbPath);
  }
});

test('14. Timeline records every lifecycle transition in order', async () => {
  const { dialect, dbPath } = await env('rma-14');
  try {
    let rma = createRMA(dialect, { customer_id: 'c1', lines: [{ product_id: 'p1', product_name: 'Item', qty_requested: 1 }] }, CTX_A);
    rma = submitRMA(dialect, { id: rma.id }, CTX_A);
    rma = rejectRMA(dialect, { id: rma.id, reason: 'test' }, CTX_A);
    const actions = rma.timeline.map((t) => t.action);
    assert.deepEqual(actions, ['create', 'submit', 'reject']);
  } finally {
    await cleanup(dialect, dbPath);
  }
});
