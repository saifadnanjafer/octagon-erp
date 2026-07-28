(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Canonical client layer — Phase 04 original-shell integration.
  //
  // One durable transport between the original Octagon UI and the canonical
  // platform runtime. Every governed Phase 04 fact the original shell needs
  // must travel this path:
  //
  //   original UI
  //     -> CanonicalClient (this file)
  //     -> raw Node HTTP route  (/api/v1/...)
  //     -> server-derived identity and scope
  //     -> ActionExecutor command or canonical query
  //     -> atomic domain transaction
  //     -> audit and outbox
  //     -> canonical response
  //     -> original UI refresh
  //
  // Design rules enforced here:
  //
  // 1. The browser is never an identity authority. Actor, tenant, company,
  //    branch, role and permission are derived server-side from the
  //    octagon_session cookie (platform-runtime-bridge.mjs resolveApiContext
  //    -> resolveContextFromRequest -> stripUntrustedContext). This client
  //    additionally strips those keys before sending so a UI bug cannot even
  //    attempt to spoof them.
  // 2. The browser is never a governed-value authority. Posting status, stock
  //    valuation, tax results, account mappings and approval identity are
  //    computed by the server; this client refuses to transmit them.
  // 3. No duplicate domain logic. This layer transports and maps errors; it
  //    does not compute balances, availability, valuation or posting effects.
  // 4. Fail closed. An unreachable or erroring canonical API raises a typed
  //    CanonicalError; it never silently falls back to a legacy write.
  //
  // Read-only legacy fallback is permitted (and only for reads) while a domain
  // is not yet cut over. Write fallback is never permitted.
  // ---------------------------------------------------------------------

  const root = window;
  const services = root.PentagonServices || {};
  root.PentagonServices = services;

  const API_PREFIX = '/api/v1';

  // Fields the browser must never send. Server-derived or server-computed.
  const FORBIDDEN_INPUT_KEYS = Object.freeze([
    // identity / scope
    'actor', 'actor_id', 'actorId', 'actorType', 'actor_type',
    'user', 'user_id', 'userId',
    'tenant', 'tenant_id', 'tenantId',
    'company', 'company_id', 'companyId',
    'branch', 'branch_id', 'branchId',
    // NOTE: 'roles' is deliberately NOT forbidden. On party:create, `roles`
    // is a business attribute of the party record (['customer'], ['supplier']),
    // not the acting user's identity role. The actor's role is derived
    // server-side from the session and is never read from a command body.
    'role', 'role_id', 'roleId',
    'permission', 'permissions',
    'session', 'session_id', 'sessionId',
    'impersonator_id', 'impersonatorId',
    // governed results the server owns
    'posting_status', 'postingStatus',
    'valuation', 'valuation_value', 'valuationValue',
    'tax_result', 'taxResult',
    'account_mapping', 'accountMapping',
    'approved_by', 'approvedBy', 'approval_identity', 'approvalIdentity',
  ]);

  const PHASE04_DOMAINS = Object.freeze([
    'COMMERCIAL', 'INVENTORY', 'SALES', 'PROCUREMENT', 'POS', 'WORK_ITEM',
  ]);

  /**
   * Typed canonical error. `code` is the machine-readable server code when the
   * server supplied one (e.g. OPENING_CUTOVER_DATE_REQUIRED, PERMISSION_DENIED).
   */
  class CanonicalError extends Error {
    constructor(message, { status = 0, code = null, correlationId = null, payload = null } = {}) {
      super(message);
      this.name = 'CanonicalError';
      this.canonical = true;
      this.status = status;
      this.code = code;
      this.correlationId = correlationId;
      this.payload = payload;
    }

    get isAuthorization() {
      return this.status === 401 || this.status === 403;
    }

    get isConflict() {
      return this.status === 409;
    }

    get isBusinessRule() {
      return this.status === 422;
    }
  }

  /**
   * The server encodes governed denials as "CODE: message" (platform/api/index.mjs).
   * Split that back into a machine code and a human message.
   */
  function splitServerError(raw) {
    const text = String(raw == null ? '' : raw);
    const match = /^([A-Z][A-Z0-9_]{2,}):\s*(.*)$/.exec(text);
    if (match) return { code: match[1], message: match[2] || match[1] };
    return { code: null, message: text || 'canonical API error' };
  }

  /**
   * Remove server-owned keys from a command payload. Returns a new object;
   * the caller's input is never mutated.
   */
  function stripForbidden(input) {
    const clean = {};
    const rejected = [];
    Object.keys(input || {}).forEach((key) => {
      if (FORBIDDEN_INPUT_KEYS.indexOf(key) !== -1) {
        rejected.push(key);
        return;
      }
      clean[key] = input[key];
    });
    if (rejected.length && root.console && typeof root.console.warn === 'function') {
      root.console.warn(
        'CanonicalClient: refused to send server-derived fields:', rejected.join(', '),
      );
    }
    return clean;
  }

  let correlationCounter = 0;
  function newCorrelationId() {
    correlationCounter += 1;
    return `ui-${Date.now().toString(36)}-${correlationCounter}`;
  }

  let idempotencyCounter = 0;
  function newIdempotencyKey(actionId) {
    idempotencyCounter += 1;
    const slug = String(actionId || 'action').replace(/[^a-z0-9]+/gi, '-');
    return `ui-${slug}-${Date.now()}-${idempotencyCounter}`;
  }

  function buildQueryString(params) {
    if (!params) return '';
    const usable = Object.keys(params).filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && v !== '';
    });
    if (!usable.length) return '';
    return '?' + usable.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  /**
   * Single authenticated request primitive. Unwraps the canonical envelope
   * { success, data, error, meta, correlationId } and raises CanonicalError on
   * any non-success. Returns { data, meta, correlationId }.
   */
  async function request(path, options = {}) {
    const {
      method = 'GET',
      body,
      idempotencyKey = null,
      correlationId = newCorrelationId(),
      expectVersion = null,
    } = options;

    if (typeof fetch !== 'function') {
      throw new CanonicalError('canonical API unreachable: no fetch in this environment', { correlationId });
    }

    const headers = { 'x-correlation-id': correlationId };
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    if (expectVersion !== null && expectVersion !== undefined) {
      // Optimistic concurrency: the server compares this against the stored
      // row version and answers 409 on drift.
      headers['if-match'] = String(expectVersion);
    }

    const init = {
      method,
      // Session cookie is the only identity carrier. Never a header token,
      // never a body field.
      credentials: 'same-origin',
      headers,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(path, init);
    } catch (networkError) {
      throw new CanonicalError(
        `canonical API unreachable: ${networkError && networkError.message ? networkError.message : 'network error'}`,
        { correlationId },
      );
    }

    let payload = {};
    try {
      payload = await res.json();
    } catch (_) {
      payload = {};
    }

    if (!res.ok || payload.success === false) {
      const { code, message } = splitServerError(payload.error || `canonical API error (HTTP ${res.status})`);
      if (res.status === 401 && typeof root.syncCanonicalSession === 'function') {
        root.syncCanonicalSession().catch(() => {});
      }
      throw new CanonicalError(message, {
        status: res.status,
        code,
        correlationId: payload.correlationId || correlationId,
        payload,
      });
    }

    return {
      data: payload.data,
      meta: payload.meta || null,
      correlationId: payload.correlationId || correlationId,
    };
  }

  /** Canonical read. Returns the unwrapped data. */
  async function query(path, params) {
    const result = await request(`${API_PREFIX}${path}${buildQueryString(params)}`, { method: 'GET' });
    return result.data;
  }

  /** Canonical read that also needs pagination metadata. */
  async function queryWithMeta(path, params) {
    return request(`${API_PREFIX}${path}${buildQueryString(params)}`, { method: 'GET' });
  }

  /**
   * Canonical governed command. Every command carries an idempotency key so a
   * retried click cannot double-post.
   */
  async function action(actionId, input = {}, options = {}) {
    const clean = stripForbidden(input);
    const idempotencyKey = options.idempotencyKey || clean.idempotency_key || newIdempotencyKey(actionId);
    delete clean.idempotency_key;
    // Do NOT encodeURIComponent the action id. The server reads it from
    // requestUrl.pathname, which is not percent-decoded, and looks the literal
    // segment up in platform_actions. Encoding turns `party:create` into
    // `party%3Acreate` and the lookup fails with ACTION_NOT_REGISTERED.
    // services/financeService.js has always sent these unencoded; this matches
    // that contract. Action ids are fixed internal tokens ([a-z_]+:[a-z_:]+),
    // never user input, so there is nothing to escape.
    const result = await request(`${API_PREFIX}/action/${actionId}`, {
      method: 'POST',
      body: { ...clean, idempotency_key: idempotencyKey },
      idempotencyKey,
      correlationId: options.correlationId,
      expectVersion: options.expectVersion,
    });
    emitChanged(options.domain || null, actionId, result.data);
    return result.data;
  }

  // ---------------------------------------------------------------------
  // Cutover resolution — server decision is authoritative
  // ---------------------------------------------------------------------

  function bootstrapCutover() {
    return (root.__octagonBootstrap && root.__octagonBootstrap.cutover) || null;
  }

  /**
   * Is `domain` (COMMERCIAL | INVENTORY | SALES | PROCUREMENT | POS | WORK_ITEM)
   * cut over to canonical authority?
   *
   * Resolution order — the server always wins when it has an opinion:
   *   1. __octagonBootstrap.cutover.phase04.domains[DOMAIN].enforced
   *   2. window.OCTAGON_FEATURE_FLAGS['FF_CANONICAL_' + DOMAIN]
   *   3. localStorage 'FF_CANONICAL_<DOMAIN>' in {'1','true','on'}
   *   default: false
   *
   * A false result means: reads may use a read-only legacy projection, writes
   * must still go canonical or be refused. It never authorizes a legacy write.
   */
  function isCanonical(domain) {
    const key = String(domain || '').toUpperCase();
    const cutover = bootstrapCutover();
    const serverDomain = cutover && cutover.phase04 && cutover.phase04.domains
      ? cutover.phase04.domains[key]
      : null;
    if (serverDomain && typeof serverDomain.enforced === 'boolean') return serverDomain.enforced;

    const flags = root.OCTAGON_FEATURE_FLAGS;
    const flagKey = `FF_CANONICAL_${key}`;
    if (flags && flags[flagKey] !== undefined) return !!flags[flagKey];

    try {
      const value = root.localStorage && root.localStorage.getItem
        ? root.localStorage.getItem(flagKey)
        : null;
      return value === '1' || value === 'true' || value === 'on';
    } catch (_) {
      return false;
    }
  }

  /** Full server-reported retirement status, for diagnostics surfaces. */
  function cutoverStatus() {
    const cutover = bootstrapCutover();
    const phase04 = (cutover && cutover.phase04) || null;
    return {
      enabled: phase04 ? !!phase04.enabled : false,
      canonicalAuthority: phase04 ? phase04.canonicalAuthority : null,
      domains: Object.fromEntries(PHASE04_DOMAINS.map((d) => [d, {
        enforced: isCanonical(d),
        lock: phase04 && phase04.domains && phase04.domains[d] ? phase04.domains[d].lock : null,
      }])),
      financeEnforced: !!(cutover && cutover.finance && cutover.finance.enforced),
    };
  }

  // ---------------------------------------------------------------------
  // UI refresh events
  // ---------------------------------------------------------------------

  function emitChanged(domain, actionId, data) {
    try {
      if (typeof root.CustomEvent !== 'function' || typeof root.dispatchEvent !== 'function') return;
      root.dispatchEvent(new root.CustomEvent('octagon:canonical-changed', {
        detail: { domain: domain || null, actionId: actionId || null, data: data || null },
      }));
    } catch (_) {
      // Event dispatch must never break a completed canonical write.
    }
  }

  // ---------------------------------------------------------------------
  // Shadow comparison — parity checking during staged cutover
  // ---------------------------------------------------------------------

  /**
   * Compare a canonical value against the legacy value for the same fact.
   * Read-only: it reports drift, it never repairs and never writes.
   */
  function shadowCompare(label, canonicalValue, legacyValue, { tolerance = 0 } = {}) {
    const bothNumeric = typeof canonicalValue === 'number' && typeof legacyValue === 'number';
    const match = bothNumeric
      ? Math.abs(canonicalValue - legacyValue) <= tolerance
      : JSON.stringify(canonicalValue) === JSON.stringify(legacyValue);
    const report = {
      label,
      match,
      canonical: canonicalValue,
      legacy: legacyValue,
      delta: bothNumeric ? canonicalValue - legacyValue : null,
      at: new Date().toISOString(),
    };
    if (!match && root.console && typeof root.console.warn === 'function') {
      root.console.warn('CanonicalClient shadow drift:', report);
    }
    return report;
  }

  // ---------------------------------------------------------------------
  // Domain APIs
  //
  // Queries mirror platform/api/commercial.mjs.
  // Commands mirror the registered ActionExecutor action ids.
  // ---------------------------------------------------------------------

  const parties = {
    list: (params) => query('/commercial/parties', params),
    get: (id) => query(`/commercial/parties/${encodeURIComponent(id)}`),
    create: (input, opts) => action('party:create', input, { ...opts, domain: 'COMMERCIAL' }),
  };

  const products = {
    list: (params) => query('/commercial/products', params),
    get: (id) => query(`/commercial/products/${encodeURIComponent(id)}`),
    createTemplate: (input, opts) => action('product:template:create', input, { ...opts, domain: 'COMMERCIAL' }),
    createVariant: (input, opts) => action('product:variant:create', input, { ...opts, domain: 'COMMERCIAL' }),
  };

  const uoms = {
    list: (params) => query('/commercial/uoms', params),
    create: (input, opts) => action('uom:create', input, { ...opts, domain: 'COMMERCIAL' }),
  };

  const warehouses = {
    list: (params) => query('/inventory/warehouses', params),
    create: (input, opts) => action('warehouse:create', input, { ...opts, domain: 'INVENTORY' }),
  };

  const locations = {
    list: (params) => query('/inventory/locations', params),
    create: (input, opts) => action('stock:location:create', input, { ...opts, domain: 'INVENTORY' }),
  };

  const stock = {
    // Reads — the UI must display these, never compute them.
    balances: (params) => query('/inventory/quants', params),
    operations: (params) => query('/inventory/operations', params),
    valuation: (params) => query('/inventory/valuation', params),
    lots: (params) => query('/inventory/lots', params),
    serials: (params) => query('/inventory/serials', params),
    packages: (params) => query('/inventory/packages', params),

    // Commands.
    postMove: (input, opts) => action('stock:move:post', input, { ...opts, domain: 'INVENTORY' }),
    rebuildQuants: (input, opts) => action('stock:quants:rebuild', input, { ...opts, domain: 'INVENTORY' }),
    createLot: (input, opts) => action('stock:lot:create', input, { ...opts, domain: 'INVENTORY' }),
    createSerial: (input, opts) => action('stock:serial:create', input, { ...opts, domain: 'INVENTORY' }),
    createPackage: (input, opts) => action('stock:package:create', input, { ...opts, domain: 'INVENTORY' }),
    validatePicking: (input, opts) => action('wms:picking:validate', input, { ...opts, domain: 'INVENTORY' }),
  };

  const reservations = {
    list: (params) => query('/inventory/reservations', params),
    reserve: (input, opts) => action('stock:reservation:reserve', input, { ...opts, domain: 'INVENTORY' }),
    release: (input, opts) => action('stock:reservation:release', input, { ...opts, domain: 'INVENTORY' }),
    consume: (input, opts) => action('stock:reservation:consume', input, { ...opts, domain: 'INVENTORY' }),
    expire: (input, opts) => action('stock:reservation:expire', input, { ...opts, domain: 'INVENTORY' }),
    reallocate: (input, opts) => action('stock:reservation:reallocate', input, { ...opts, domain: 'INVENTORY' }),
    reverse: (input, opts) => action('stock:reservation:reverse', input, { ...opts, domain: 'INVENTORY' }),
  };

  const sales = {
    listLeads: (params) => query('/sales/leads', params),
    getLead: (id) => query(`/sales/leads/${encodeURIComponent(id)}`),
    listOpportunities: (params) => query('/sales/opportunities', params),
    getOpportunity: (id) => query(`/sales/opportunities/${encodeURIComponent(id)}`),
    listOrders: (params) => query('/sales/orders', params),
    getOrder: (id) => query(`/sales/orders/${encodeURIComponent(id)}`),
    listReservations: (params) => query('/sales/reservations', params),
    listDeliveries: (params) => query('/sales/deliveries', params),
    listReturns: (params) => query('/sales/returns', params),
    listInvoiceRequests: (params) => query('/sales/invoice-requests', params),
    listCustomerBalances: (params) => query('/sales/customer-balances', params),
    listCommissions: (params) => query('/sales/commissions', params),
    listPriceLists: (params) => query('/commercial/price-lists', params),
    report: (report, params) => query('/sales/reports', { ...(params || {}), report }),
    createLead: (input, opts) => action('crm:lead:create', input, { ...opts, domain: 'SALES' }),
    convertLead: (input, opts) => action('crm:lead:convert', input, { ...opts, domain: 'SALES' }),
    updateOpportunityStage: (input, opts) => action('crm:opportunity:update_stage', input, { ...opts, domain: 'SALES' }),
    addOpportunityActivity: (input, opts) => action('crm:opportunity:add_activity', input, { ...opts, domain: 'SALES' }),
    closeOpportunity: (input, opts) => action('crm:opportunity:close', input, { ...opts, domain: 'SALES' }),
    createQuotation: (input, opts) => action('sales:quotation:create', input, { ...opts, domain: 'SALES' }),
    submitQuotation: (input, opts) => action('sales:quotation:submit', input, { ...opts, domain: 'SALES' }),
    approveQuotation: (input, opts) => action('sales:quotation:approve', input, { ...opts, domain: 'SALES' }),
    reviseQuotation: (input, opts) => action('sales:quotation:revise', input, { ...opts, domain: 'SALES' }),
    acceptQuotation: (input, opts) => action('sales:quotation:accept', input, { ...opts, domain: 'SALES' }),
    confirmOrder: (input, opts) => action('sales:order:confirm', input, { ...opts, domain: 'SALES' }),
    cancelOrder: (input, opts) => action('sales:order:cancel', input, { ...opts, domain: 'SALES' }),
    reserveOrder: (input, opts) => action('sales:order:reserve', input, { ...opts, domain: 'SALES' }),
    postDelivery: (input, opts) => action('sales:delivery:post', input, { ...opts, domain: 'SALES' }),
    createReturn: (input, opts) => action('sales:return:create', input, { ...opts, domain: 'SALES' }),
    createInvoiceRequest: (input, opts) => action('sales:invoice_request:create', input, { ...opts, domain: 'SALES' }),
    accrueCommission: (input, opts) => action('sales:commission:accrue', input, { ...opts, domain: 'SALES' }),
    approveCommission: (input, opts) => action('sales:commission:approve', input, { ...opts, domain: 'SALES' }),
    markCommissionPaid: (input, opts) => action('sales:commission:mark_paid', input, { ...opts, domain: 'SALES' }),
  };

  const procurement = {
    listOrders: (params) => query('/procurement/orders', params),
    getOrder: (id) => query(`/procurement/orders/${encodeURIComponent(id)}`),
    createOrder: (input, opts) => action('procurement:order:create', input, { ...opts, domain: 'PROCUREMENT' }),
    confirmOrder: (input, opts) => action('procurement:order:confirm', input, { ...opts, domain: 'PROCUREMENT' }),
    threeWayMatch: (input, opts) => action('procurement:threewaymatch:perform', input, { ...opts, domain: 'PROCUREMENT' }),
    createBillRequest: (input, opts) => action('procurement:bill_request:create', input, { ...opts, domain: 'PROCUREMENT' }),
  };

  const pos = {
    listOrders: (params) => query('/pos/orders', params),
    openSession: (input, opts) => action('pos:session:open', input, { ...opts, domain: 'POS' }),
    closeSession: (input, opts) => action('pos:session:close', input, { ...opts, domain: 'POS' }),
    processOrder: (input, opts) => action('pos:order:process', input, { ...opts, domain: 'POS' }),
  };

  const workItems = {
    list: (params) => query('/work-items', params),
    get: (id) => query(`/work-items/${encodeURIComponent(id)}`),
    create: (input, opts) => action('work_item:create', input, { ...opts, domain: 'WORK_ITEM' }),
    update: (input, opts) => action('work_item:update', input, { ...opts, domain: 'WORK_ITEM' }),
    approve: (input, opts) => action('work_item:approve', input, { ...opts, domain: 'WORK_ITEM' }),
    remove: (input, opts) => action('work_item:delete', input, { ...opts, domain: 'WORK_ITEM' }),
  };

  const CanonicalClient = {
    // transport
    request,
    query,
    queryWithMeta,
    action,
    CanonicalError,

    // cutover
    isCanonical,
    cutoverStatus,
    PHASE04_DOMAINS,

    // parity + events
    shadowCompare,
    onChanged(handler) {
      if (typeof root.addEventListener !== 'function') return () => {};
      root.addEventListener('octagon:canonical-changed', handler);
      return () => root.removeEventListener('octagon:canonical-changed', handler);
    },

    // domains
    parties,
    products,
    uoms,
    warehouses,
    locations,
    stock,
    reservations,
    sales,
    procurement,
    pos,
    workItems,

    // exposed for tests and diagnostics
    _internal: { stripForbidden, splitServerError, buildQueryString, FORBIDDEN_INPUT_KEYS },
  };

  root.CanonicalClient = CanonicalClient;
  services.canonicalClient = CanonicalClient;
})();
