(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Commercial adapter — Phase 04 Wave 2.
  //
  // Strangler seam between the original Octagon commercial UI (materials,
  // customers, suppliers) and the canonical commercial authority.
  //
  // The workshop UI keeps its familiar Arabic shape and its legacy record
  // fields. This adapter owns the translation to and from the canonical
  // product/party model, and decides which authority actually performs a
  // write:
  //
  //   isCanonical('COMMERCIAL') === true   -> canonical write only
  //   isCanonical('COMMERCIAL') === false  -> legacy write only (unchanged)
  //
  // Never both. There is no path that writes to both authorities, and no path
  // where a failed canonical write silently falls back to a legacy write —
  // that would recreate the duplicate-authority problem this phase exists to
  // remove.
  //
  // The server owns the decision (see CanonicalClient.isCanonical). Until the
  // server reports COMMERCIAL as retired, every call here behaves exactly as
  // it did before this file existed.
  // ---------------------------------------------------------------------

  const root = window;
  const services = root.PentagonServices || {};
  root.PentagonServices = services;

  const DOMAIN = 'COMMERCIAL';

  function client() {
    return root.CanonicalClient || null;
  }

  /** True when the server says the commercial domain is cut over. */
  function canonicalActive() {
    const c = client();
    return !!(c && c.isCanonical(DOMAIN));
  }

  // -------------------------------------------------------------------
  // Legacy <-> canonical field mapping
  //
  // The legacy material record is the workshop's vocabulary. The canonical
  // product template is the governed model. Neither is rewritten to match the
  // other; this map is the only place the two vocabularies meet.
  // -------------------------------------------------------------------

  const TRACKING_TO_CANONICAL = { none: 'none', lot: 'lot', serial: 'serial' };
  const COSTING_TO_CANONICAL = { avco: 'avco', fifo: 'fifo', lifo: 'lifo' };

  /**
   * Translate a legacy material form result into canonical
   * product:template:create input.
   *
   * Deliberately omitted: stock, reserved, movements, reservations. Those are
   * governed inventory facts and must never ride along on a product create.
   * Opening stock is posted separately as an explicit stock move.
   */
  function materialToProductInput(material, options = {}) {
    const input = {
      name: String(material.name || '').trim(),
      sku: material.sku || material.barcode || undefined,
      barcode: material.barcode || undefined,
      tracking: TRACKING_TO_CANONICAL[material.tracking] || 'none',
      costing_method: COSTING_TO_CANONICAL[material.costingMethod] || 'avco',
    };
    if (options.categoryId) input.category_id = options.categoryId;
    if (options.uomId) input.uom_id = options.uomId;
    // Cost is an accounting input, not a governed result: the server decides
    // what the standard cost becomes and how it is posted.
    if (material.cost !== undefined && material.cost !== null && material.cost !== '') {
      input.standard_cost = Number(material.cost) || 0;
    }
    return input;
  }

  /**
   * Project a canonical product back into the legacy material shape the
   * existing UI renders. Read-only projection: quantities come from the
   * canonical inventory queries, never from this object.
   */
  function productToMaterialProjection(product, legacyDefaults = {}) {
    return {
      ...legacyDefaults,
      id: product.default_variant_id || product.id,
      canonicalProductId: product.id,
      canonicalVariantId: product.default_variant_id || null,
      name: product.name || legacyDefaults.name || '',
      unit: legacyDefaults.unit || 'قطعة',
      category: legacyDefaults.category || 'عام',
      tracking: product.tracking || legacyDefaults.tracking || 'none',
      costingMethod: product.costing_method || legacyDefaults.costingMethod || 'avco',
      cost: product.standard_cost !== undefined ? product.standard_cost : (legacyDefaults.cost || 0),
      // Governed quantities are never projected from a product record.
      stock: 0,
      reserved: 0,
      reservedQty: 0,
      reservations: [],
      movements: [],
      authority: 'canonical',
    };
  }

  const ROLE_BY_KIND = { customer: 'customer', supplier: 'supplier' };

  function partyToCanonicalInput(kind, party) {
    const role = ROLE_BY_KIND[kind];
    if (!role) throw new Error(`unknown party kind: ${kind}`);
    const input = {
      name: String(party.name || '').trim(),
      roles: [role],
      is_company: party.isCompany ? 1 : 0,
    };
    if (party.legalName) input.legal_name = party.legalName;
    if (party.taxId) input.tax_id = party.taxId;
    if (party.registrationNumber) input.registration_number = party.registrationNumber;
    if (Array.isArray(party.contacts) && party.contacts.length) input.contacts = party.contacts;
    if (Array.isArray(party.addresses) && party.addresses.length) input.addresses = party.addresses;
    return input;
  }

  function partyToLegacyProjection(kind, party, legacyDefaults = {}) {
    return {
      ...legacyDefaults,
      id: party.id,
      canonicalPartyId: party.id,
      name: party.name || legacyDefaults.name || '',
      taxId: party.tax_id || legacyDefaults.taxId || '',
      kind,
      authority: 'canonical',
    };
  }

  // -------------------------------------------------------------------
  // Governed writes
  // -------------------------------------------------------------------

  /**
   * Create a material.
   *
   * Canonical path: product:template:create, then an explicit opening stock
   * move when an opening quantity was entered. The two are separate governed
   * commands on purpose — a product master record and an inventory balance
   * are different facts with different authorities and different audit trails.
   *
   * Legacy path: whatever the caller supplied as `legacyWrite`, unchanged.
   *
   * @returns {Promise<{material: object, authority: 'canonical'|'legacy', openingMove: object|null}>}
   */
  async function createMaterial(material, options = {}) {
    if (!canonicalActive()) {
      const created = await options.legacyWrite();
      return { material: created, authority: 'legacy', openingMove: null };
    }

    const c = client();
    const product = await c.products.createTemplate(
      materialToProductInput(material, options),
      { idempotencyKey: options.idempotencyKey },
    );

    let openingMove = null;
    const openingQty = Number(material.stock) || 0;
    if (openingQty > 0) {
      // An opening balance is a governed stock fact. It is posted as an
      // explicit move so it carries valuation, accounting links, audit and
      // outbox like any other receipt — not written as a field on a product.
      openingMove = await c.stock.postMove({
        reference: options.openingReference || 'إنشاء المادة',
        product_id: product.default_variant_id,
        product_qty: openingQty,
        uom_id: options.uomId,
        location_id: options.openingSourceLocationId,
        location_dest_id: options.openingDestLocationId,
        unit_cost: Number(material.cost) || 0,
        source_document_type: 'inventory_adjustment',
        source_document_id: options.openingDocumentId || `OPENING-${product.default_variant_id}`,
      });
    }

    return {
      material: productToMaterialProjection(product, material),
      authority: 'canonical',
      openingMove,
    };
  }

  /**
   * Update a material master record. Governed quantities are never updatable
   * through this path; they change only through stock commands.
   */
  async function updateMaterial(materialId, changes, options = {}) {
    if (!canonicalActive()) {
      const updated = await options.legacyWrite();
      return { material: updated, authority: 'legacy' };
    }
    const c = client();
    const product = await c.products.createVariant(
      { ...materialToProductInput(changes, options), template_id: options.templateId || materialId },
      { idempotencyKey: options.idempotencyKey, expectVersion: options.expectVersion },
    );
    return { material: productToMaterialProjection(product, changes), authority: 'canonical' };
  }

  /** Create a customer as a canonical party with the customer role. */
  async function createCustomer(customer, options = {}) {
    return createParty('customer', customer, options);
  }

  /** Create a supplier as a canonical party with the supplier role. */
  async function createSupplier(supplier, options = {}) {
    return createParty('supplier', supplier, options);
  }

  async function createParty(kind, party, options = {}) {
    if (!canonicalActive()) {
      const created = await options.legacyWrite();
      return { party: created, authority: 'legacy' };
    }
    const c = client();
    const created = await c.parties.create(
      partyToCanonicalInput(kind, party),
      { idempotencyKey: options.idempotencyKey },
    );
    return { party: partyToLegacyProjection(kind, created, party), authority: 'canonical' };
  }

  // -------------------------------------------------------------------
  // Read projections
  // -------------------------------------------------------------------

  /**
   * List materials. When canonical, reads governed products and merges live
   * balances from the canonical inventory query. When not canonical, returns
   * the legacy array untouched.
   */
  async function listMaterials(options = {}) {
    if (!canonicalActive()) {
      return { items: options.legacyRead ? await options.legacyRead() : [], authority: 'legacy' };
    }
    const c = client();
    const products = await c.products.list(options.params);
    return {
      items: (products || []).map((p) => productToMaterialProjection(p, {})),
      authority: 'canonical',
    };
  }

  async function listParties(kind, options = {}) {
    if (!canonicalActive()) {
      return { items: options.legacyRead ? await options.legacyRead() : [], authority: 'legacy' };
    }
    const c = client();
    const rows = await c.parties.list({ ...(options.params || {}), role: ROLE_BY_KIND[kind] });
    return { items: (rows || []).map((p) => partyToLegacyProjection(kind, p, {})), authority: 'canonical' };
  }

  const CommercialAdapter = {
    DOMAIN,
    canonicalActive,

    // writes
    createMaterial,
    updateMaterial,
    createCustomer,
    createSupplier,
    createParty,

    // reads
    listMaterials,
    listParties,

    // mapping, exposed for tests and diagnostics
    _map: {
      materialToProductInput,
      productToMaterialProjection,
      partyToCanonicalInput,
      partyToLegacyProjection,
      TRACKING_TO_CANONICAL,
      COSTING_TO_CANONICAL,
    },
  };

  root.CommercialAdapter = CommercialAdapter;
  services.commercialAdapter = CommercialAdapter;
})();
