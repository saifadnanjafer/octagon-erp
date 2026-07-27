import crypto from 'node:crypto';

function makeId(prefix = 'prod') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createProductCategory(db, categoryData) {
  const {
    company_id = '*',
    parent_id = null,
    name,
    name_ar = '',
    name_en = '',
    code = '',
    costing_method = 'avco',
    valuation_method = 'real_time',
    income_account_id = '',
    expense_account_id = '',
    stock_account_id = '',
    stock_input_account_id = '',
    stock_output_account_id = '',
  } = categoryData;

  if (!name || !String(name).trim()) throw new Error('Product category name is required');
  const id = makeId('pcat');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_categories (
      id, company_id, parent_id, name, name_ar, name_en, code, costing_method, valuation_method,
      income_account_id, expense_account_id, stock_account_id, stock_input_account_id, stock_output_account_id, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, company_id, parent_id || null, String(name).trim(), name_ar || name, name_en || name, code || '', costing_method, valuation_method,
    income_account_id || '', expense_account_id || '', stock_account_id || '', stock_input_account_id || '', stock_output_account_id || '', now, now
  );

  return db.prepare(`SELECT * FROM product_categories WHERE id = ?`).get(id);
}

export function updateProductCategory(db, categoryData) {
  const { id } = categoryData;
  if (!id) throw new Error('Product category ID is required');
  const existing = db.prepare(`SELECT * FROM product_categories WHERE id = ?`).get(id);
  if (!existing) throw new Error(`Product category not found: ${id}`);
  const now = new Date().toISOString();

  const name = categoryData.name !== undefined ? String(categoryData.name).trim() : existing.name;
  const parent_id = categoryData.parent_id !== undefined ? categoryData.parent_id : existing.parent_id;
  const code = categoryData.code !== undefined ? categoryData.code : existing.code;
  const costing_method = categoryData.costing_method !== undefined ? categoryData.costing_method : existing.costing_method;
  const valuation_method = categoryData.valuation_method !== undefined ? categoryData.valuation_method : existing.valuation_method;
  const is_active = categoryData.is_active !== undefined ? (categoryData.is_active ? 1 : 0) : (existing.is_active ?? 1);

  db.prepare(`
    UPDATE product_categories SET name = ?, parent_id = ?, code = ?, costing_method = ?, valuation_method = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(name, parent_id || null, code, costing_method, valuation_method, is_active, now, id);

  return db.prepare(`SELECT * FROM product_categories WHERE id = ?`).get(id);
}

export function archiveProductCategory(db, { id }) {
  return updateProductCategory(db, { id, is_active: 0 });
}

export function restoreProductCategory(db, { id }) {
  return updateProductCategory(db, { id, is_active: 1 });
}

export function createProductTemplate(db, templateData) {
  const {
    id: inputId,
    company_id = '*',
    name,
    name_ar = '',
    name_en = '',
    description = '',
    code = '',
    type = 'storable',
    tracking_type = 'none',
    category_id = '',
    uom_id = '',
    purchase_uom_id = '',
    list_price = 0.0,
    standard_price = 0.0,
    sku = null,
    barcode = null,
  } = templateData;

  if (!name || !String(name).trim()) throw new Error('Product template name is required');
  const templateId = inputId || makeId('ptpl');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_templates (
      id, company_id, name, name_ar, name_en, description, code, type, tracking_type, category_id, uom_id, purchase_uom_id, list_price, standard_price, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    templateId, company_id, String(name).trim(), name_ar || name, name_en || name, description || '', code || '', type, tracking_type || 'none',
    category_id || '', uom_id || '', purchase_uom_id || uom_id || '', Number(list_price), Number(standard_price), now, now
  );

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

  if (barcode) {
    const existing = db.prepare(`SELECT * FROM product_barcodes WHERE barcode = ?`).get(barcode);
    if (existing && existing.variant_id !== variantId) throw new Error(`Barcode already in use: ${barcode}`);
  }

  db.prepare(`
    INSERT INTO product_variants (
      id, template_id, company_id, sku, name, variant_attributes, list_price_extra, standard_price, barcode, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(variantId, template_id, company_id, sku, name, attributesJson, Number(list_price_extra), Number(standard_price), barcode || '', now, now);

  if (barcode) {
    db.prepare(`
      INSERT INTO product_barcodes (id, variant_id, barcode, barcode_type, is_primary, created_at)
      VALUES (?, ?, ?, 'ean13', 1, ?)
      ON CONFLICT(barcode) DO UPDATE SET variant_id = excluded.variant_id
    `).run(makeId('pbar'), variantId, barcode, now);
  }

  return db.prepare(`SELECT * FROM product_variants WHERE id = ?`).get(variantId);
}

export function updateProduct(db, productData) {
  const { id, template_id } = productData;
  const targetId = id || template_id;
  if (!targetId) throw new Error('Product ID is required');

  // Can be updating template or variant
  let template = db.prepare(`SELECT * FROM product_templates WHERE id = ?`).get(targetId);
  let variant = db.prepare(`SELECT * FROM product_variants WHERE template_id = ? OR id = ?`).get(targetId, targetId);

  if (!template && variant) {
    template = db.prepare(`SELECT * FROM product_templates WHERE id = ?`).get(variant.template_id);
  }
  if (!template) throw new Error(`Product not found: ${targetId}`);

  const now = new Date().toISOString();
  const name = productData.name !== undefined ? String(productData.name).trim() : template.name;
  const name_ar = productData.name_ar !== undefined ? productData.name_ar : (template.name_ar || name);
  const name_en = productData.name_en !== undefined ? productData.name_en : (template.name_en || name);
  const description = productData.description !== undefined ? productData.description : template.description;
  const type = productData.type !== undefined ? productData.type : template.type;
  const tracking_type = productData.tracking_type !== undefined ? productData.tracking_type : template.tracking_type;
  const category_id = productData.category_id !== undefined ? productData.category_id : template.category_id;
  const uom_id = productData.uom_id !== undefined ? productData.uom_id : template.uom_id;
  const purchase_uom_id = productData.purchase_uom_id !== undefined ? productData.purchase_uom_id : template.purchase_uom_id;
  const list_price = productData.list_price !== undefined ? Number(productData.list_price) : template.list_price;
  const standard_price = productData.standard_price !== undefined ? Number(productData.standard_price) : template.standard_price;
  const is_active = productData.is_active !== undefined ? (productData.is_active ? 1 : 0) : template.is_active;

  db.prepare(`
    UPDATE product_templates SET name = ?, name_ar = ?, name_en = ?, description = ?, type = ?, tracking_type = ?, category_id = ?, uom_id = ?, purchase_uom_id = ?, list_price = ?, standard_price = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(name, name_ar, name_en, description, type, tracking_type, category_id, uom_id, purchase_uom_id, list_price, standard_price, is_active, now, template.id);

  if (variant) {
    const sku = productData.sku !== undefined ? productData.sku : variant.sku;
    const barcode = productData.barcode !== undefined ? productData.barcode : variant.barcode;
    db.prepare(`
      UPDATE product_variants SET name = ?, sku = ?, standard_price = ?, barcode = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, sku, standard_price, barcode || '', is_active, now, variant.id);
  }

  return db.prepare(`SELECT * FROM product_templates WHERE id = ?`).get(template.id);
}

export function archiveProduct(db, { id }) {
  return updateProduct(db, { id, is_active: 0 });
}

export function restoreProduct(db, { id }) {
  return updateProduct(db, { id, is_active: 1 });
}

export function getProducts(db, { company_id = '*', category_id = null, type = null, uom_id = null, search = null, include_archived = false } = {}) {
  let sql = `
    SELECT v.id as variant_id, v.sku, v.barcode, v.is_active as variant_active,
           t.*, c.name as category_name, u.name as uom_name
    FROM product_templates t
    LEFT JOIN product_variants v ON v.template_id = t.id
    LEFT JOIN product_categories c ON t.category_id = c.id
    LEFT JOIN uoms u ON t.uom_id = u.id
    WHERE (t.company_id = ? OR t.company_id = '*')
  `;
  const params = [company_id];

  if (!include_archived) {
    sql += ` AND t.is_active = 1`;
  }
  if (category_id) {
    sql += ` AND t.category_id = ?`;
    params.push(category_id);
  }
  if (type) {
    sql += ` AND t.type = ?`;
    params.push(type);
  }
  if (uom_id) {
    sql += ` AND t.uom_id = ?`;
    params.push(uom_id);
  }
  if (search) {
    sql += ` AND (t.name LIKE ? OR t.code LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY t.name ASC`;

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
