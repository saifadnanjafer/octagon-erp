import crypto from 'node:crypto';

function makeId(prefix = 'prod') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createProductCategory(db, categoryData) {
  const {
    company_id = '*',
    parent_id = null,
    name,
    code = '',
    costing_method = 'avco',
    valuation_method = 'real_time',
    income_account_id = '',
    expense_account_id = '',
    stock_account_id = '',
    stock_input_account_id = '',
    stock_output_account_id = '',
  } = categoryData;

  if (!name) throw new Error('Product category name is required');
  const id = makeId('pcat');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_categories (
      id, company_id, parent_id, name, code, costing_method, valuation_method,
      income_account_id, expense_account_id, stock_account_id, stock_input_account_id, stock_output_account_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, company_id, parent_id, name, code, costing_method, valuation_method,
    income_account_id, expense_account_id, stock_account_id, stock_input_account_id, stock_output_account_id, now
  );

  return { id, company_id, parent_id, name, code, costing_method, valuation_method, created_at: now };
}

export function createProductTemplate(db, templateData) {
  const {
    id: inputId,
    company_id = '*',
    name,
    code = '',
    type = 'storable',
    category_id = '',
    uom_id = '',
    purchase_uom_id = '',
    list_price = 0.0,
    standard_price = 0.0,
    sku = null,
    barcode = null,
  } = templateData;

  if (!name) throw new Error('Product template name is required');
  const templateId = inputId || makeId('ptpl');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_templates (
      id, company_id, name, code, type, category_id, uom_id, purchase_uom_id, list_price, standard_price, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(templateId, company_id, name, code, type, category_id, uom_id, purchase_uom_id || uom_id, Number(list_price), Number(standard_price), now);

  // Automatically generate default primary variant if sku provided
  const variantSku = sku || (code ? code : templateId);
  const variant = createProductVariant(db, {
    template_id: templateId,
    company_id,
    sku: variantSku,
    name,
    standard_price,
    barcode,
  });

  return { ...db.prepare(`SELECT * FROM product_templates WHERE id = ?`).get(templateId), default_variant_id: variant.id };
}

export function createProductVariant(db, variantData) {
  const {
    id: inputId,
    template_id,
    company_id = '*',
    sku,
    name,
    variant_attributes = {},
    list_price_extra = 0.0,
    standard_price = 0.0,
    barcode = null,
  } = variantData;

  if (!template_id || !sku || !name) throw new Error('Template ID, SKU, and Name are required');

  const variantId = inputId || makeId('pvar');
  const now = new Date().toISOString();
  const attributesJson = typeof variant_attributes === 'string' ? variant_attributes : JSON.stringify(variant_attributes);

  // Ensure barcode uniqueness if barcode provided
  if (barcode) {
    const existing = db.prepare(`SELECT * FROM product_barcodes WHERE barcode = ?`).get(barcode);
    if (existing) throw new Error(`Barcode already in use: ${barcode}`);
  }

  db.prepare(`
    INSERT INTO product_variants (
      id, template_id, company_id, sku, name, variant_attributes, list_price_extra, standard_price, barcode, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(variantId, template_id, company_id, sku, name, attributesJson, Number(list_price_extra), Number(standard_price), barcode || '', now);

  if (barcode) {
    db.prepare(`
      INSERT INTO product_barcodes (id, variant_id, barcode, barcode_type, is_primary, created_at)
      VALUES (?, ?, ?, 'ean13', 1, ?)
    `).run(makeId('pbar'), variantId, barcode, now);
  }

  return db.prepare(`SELECT * FROM product_variants WHERE id = ?`).get(variantId);
}

export function getProducts(db, { company_id = '*', category_id = null, search = null }) {
  let sql = `
    SELECT v.*, t.type, t.category_id, t.uom_id, t.list_price
    FROM product_variants v
    JOIN product_templates t ON v.template_id = t.id
    WHERE (v.company_id = ? OR v.company_id = '*' OR ? = '*') AND v.is_active = 1
  `;
  const params = [company_id, company_id];

  if (category_id) {
    sql += ` AND t.category_id = ?`;
    params.push(category_id);
  }
  if (search) {
    sql += ` AND (v.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY v.name ASC`;

  return db.prepare(sql).all(...params);
}

export function getProductByBarcode(db, { barcode }) {
  if (!barcode) return null;
  const bcRow = db.prepare(`SELECT variant_id FROM product_barcodes WHERE barcode = ?`).get(barcode);
  const variantId = bcRow ? bcRow.variant_id : null;

  if (!variantId) {
    const direct = db.prepare(`SELECT id FROM product_variants WHERE barcode = ?`).get(barcode);
    if (!direct) return null;
    return db.prepare(`SELECT * FROM product_variants WHERE id = ?`).get(direct.id);
  }

  return db.prepare(`SELECT * FROM product_variants WHERE id = ?`).get(variantId);
}
