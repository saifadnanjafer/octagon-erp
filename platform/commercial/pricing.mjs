import crypto from 'node:crypto';

function makeId(prefix = 'prc') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createPricelist(db, { company_id = '*', name, currency_id = 'IQD' }) {
  if (!name) throw new Error('Pricelist name is required');
  const id = makeId('plist');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO price_lists (id, company_id, name, currency_id, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, company_id, name, currency_id, now);
  return { id, company_id, name, currency_id, is_active: 1, created_at: now };
}

export function createPricelistItem(db, itemData) {
  const {
    price_list_id,
    applied_on = 'all',
    category_id = null,
    template_id = null,
    variant_id = null,
    min_quantity = 0.0,
    price_discount = 0.0,
    fixed_price = null,
    valid_from = null,
    valid_to = null,
  } = itemData;

  if (!price_list_id) throw new Error('Pricelist ID is required');

  const id = makeId('pritem');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO price_list_items (
      id, price_list_id, applied_on, category_id, template_id, variant_id,
      min_quantity, price_discount, fixed_price, valid_from, valid_to, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, price_list_id, applied_on, category_id, template_id, variant_id,
    Number(min_quantity), Number(price_discount), fixed_price !== null ? Number(fixed_price) : null,
    valid_from, valid_to, now
  );

  return db.prepare(`SELECT * FROM price_list_items WHERE id = ?`).get(id);
}

export function calculateUnitPrice(db, { price_list_id = null, variant_id, qty = 1.0, date = null }) {
  if (!variant_id) throw new Error('Variant ID is required');

  const variant = db.prepare(`
    SELECT v.*, t.list_price, t.category_id FROM product_variants v
    JOIN product_templates t ON v.template_id = t.id
    WHERE v.id = ?
  `).get(variant_id);

  if (!variant) throw new Error(`Product variant not found: ${variant_id}`);

  const basePrice = (variant.list_price || 0) + (variant.list_price_extra || 0);

  if (!price_list_id) {
    return { unitPrice: basePrice, basePrice, discount: 0, ruleApplied: 'base_list_price' };
  }

  const currentDate = date || new Date().toISOString().split('T')[0];

  // Fetch candidate pricelist items sorted by specificity
  const items = db.prepare(`
    SELECT * FROM price_list_items
    WHERE price_list_id = ?
      AND min_quantity <= ?
      AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_to IS NULL OR valid_to >= ?)
  `).all(price_list_id, qty, currentDate, currentDate);

  let bestRule = null;

  // Exact variant match
  bestRule = items.find(i => i.applied_on === 'variant' && i.variant_id === variant_id);
  // Template match
  if (!bestRule) bestRule = items.find(i => i.applied_on === 'template' && i.template_id === variant.template_id);
  // Category match
  if (!bestRule) bestRule = items.find(i => i.applied_on === 'category' && i.category_id === variant.category_id);
  // All products match
  if (!bestRule) bestRule = items.find(i => i.applied_on === 'all');

  if (!bestRule) {
    return { unitPrice: basePrice, basePrice, discount: 0, ruleApplied: 'pricelist_no_match_fallback' };
  }

  let finalPrice = basePrice;
  if (bestRule.fixed_price !== null) {
    finalPrice = bestRule.fixed_price;
  } else if (bestRule.price_discount > 0) {
    finalPrice = basePrice * (1 - bestRule.price_discount / 100);
  }

  return {
    unitPrice: finalPrice,
    basePrice,
    discount: basePrice > 0 ? ((basePrice - finalPrice) / basePrice) * 100 : 0,
    ruleApplied: bestRule.id,
  };
}
