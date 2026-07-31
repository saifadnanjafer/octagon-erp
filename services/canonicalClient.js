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
  function stripForbidden(input, allowedBusinessKeys = []) {
    const clean = {};
    const rejected = [];
    const allowed = new Set(allowedBusinessKeys);
    Object.keys(input || {}).forEach((key) => {
      if (FORBIDDEN_INPUT_KEYS.indexOf(key) !== -1 && !allowed.has(key)) {
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
    const clean = stripForbidden(input, options.allowedBusinessKeys || []);
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

  const crm = {
    listLeads: (params) => query('/crm/leads', params),
    getLead: (id) => query(`/crm/leads/${encodeURIComponent(id)}`),
    listOpportunities: (params) => query('/crm/opportunities', params),
    getOpportunity: (id) => query(`/crm/opportunities/${encodeURIComponent(id)}`),
    listActivities: (params) => query('/crm/activities', params),
    getActivity: (id) => query(`/crm/activities/${encodeURIComponent(id)}`),
    listPipelines: (params) => query('/crm/pipelines', params),
    listStages: (params) => query('/crm/stages', params),
    customer360: (partyId) => query(`/crm/customer_360/${encodeURIComponent(partyId)}`),
    listScoringRules: (params) => query('/crm/scoring_rules', params),
    scoreHistory: (leadId) => query(`/crm/score_history/${encodeURIComponent(leadId)}`),
    report: (type, params) => query('/crm/reports', { ...(params || {}), type }),
    createLead: (input, opts) => action('crm:lead:create', input, { ...opts, domain: 'SALES' }),
    updateLead: (input, opts) => action('crm:lead:update', input, { ...opts, domain: 'SALES' }),
    qualifyLead: (input, opts) => action('crm:lead:qualify', input, { ...opts, domain: 'SALES' }),
    disqualifyLead: (input, opts) => action('crm:lead:disqualify', input, { ...opts, domain: 'SALES' }),
    reopenLead: (input, opts) => action('crm:lead:reopen', input, { ...opts, domain: 'SALES' }),
    convertLead: (input, opts) => action('crm:lead:convert', input, { ...opts, domain: 'SALES' }),
    createOpportunity: (input, opts) => action('crm:opportunity:create', input, { ...opts, domain: 'SALES' }),
    changeOpportunityStage: (input, opts) => action('crm:opportunity:change_stage', input, { ...opts, domain: 'SALES' }),
    markOpportunityWon: (input, opts) => action('crm:opportunity:mark_won', input, { ...opts, domain: 'SALES' }),
    markOpportunityLost: (input, opts) => action('crm:opportunity:mark_lost', input, { ...opts, domain: 'SALES' }),
    reopenOpportunity: (input, opts) => action('crm:opportunity:reopen', input, { ...opts, domain: 'SALES' }),
    requestQuotation: (input, opts) => action('crm:opportunity:create_quotation', input, { ...opts, domain: 'SALES' }),
    createActivity: (input, opts) => action('crm:activity:create', input, { ...opts, domain: 'SALES' }),
    completeActivity: (input, opts) => action('crm:activity:complete', input, { ...opts, domain: 'SALES' }),
    rescheduleActivity: (input, opts) => action('crm:activity:reschedule', input, { ...opts, domain: 'SALES' }),
    cancelActivity: (input, opts) => action('crm:activity:cancel', input, { ...opts, domain: 'SALES' }),
  };

  // Checkpoint D1 — canonical Projects transport. Reads go to the governed
  // /projects query surface; every mutation is an ActionExecutor command.
  const projects = {
    list: (params) => query('/projects/projects', params),
    get: (id) => query(`/projects/projects/${encodeURIComponent(id)}`),
    listTemplates: (params) => query('/projects/templates', params),
    listPhases: (params) => query('/projects/phases', params),
    listMilestones: (params) => query('/projects/milestones', params),
    listCostCodes: (params) => query('/projects/cost-codes', params),
    budget: (projectId) => query('/projects/budget', { project_id: projectId }),
    listCommitments: (params) => query('/projects/commitments', params),
    listChangeOrders: (params) => query('/projects/change-orders', params),
    listRisks: (params) => query('/projects/risks', params),
    listIssues: (params) => query('/projects/issues', params),
    listTasks: (projectId) => query('/projects/tasks', { project_id: projectId }),
    listEffort: (params) => query('/projects/effort', params),
    listBilling: (params) => query('/projects/billing', params),
    costing: (projectId) => query('/projects/costing', { project_id: projectId }),
    profitability: (params) => query('/projects/profitability', params),
    resources: (params) => query('/projects/resources', params),
    costRates: (params) => query('/projects/cost-rates', params),
    report: (report, params) => query('/projects/reports', { ...(params || {}), report }),

    create: (input, opts) => action('projects:project:create', input, { ...opts, domain: 'PROJECTS' }),
    update: (input, opts) => action('projects:project:update', input, { ...opts, domain: 'PROJECTS' }),
    setStatus: (input, opts) => action('projects:project:set_status', input, { ...opts, domain: 'PROJECTS' }),
    archive: (input, opts) => action('projects:project:archive', input, { ...opts, domain: 'PROJECTS' }),
    applyTemplate: (input, opts) => action('projects:project:apply_template', input, { ...opts, domain: 'PROJECTS' }),
    createTemplate: (input, opts) => action('projects:template:create', input, { ...opts, domain: 'PROJECTS' }),
    createPhase: (input, opts) => action('projects:phase:create', input, { ...opts, domain: 'PROJECTS' }),
    updatePhase: (input, opts) => action('projects:phase:update', input, { ...opts, domain: 'PROJECTS' }),
    createMilestone: (input, opts) => action('projects:milestone:create', input, { ...opts, domain: 'PROJECTS' }),
    achieveMilestone: (input, opts) => action('projects:milestone:achieve', input, { ...opts, domain: 'PROJECTS' }),
    createTask: (input, opts) => action('projects:task:create', input, { ...opts, domain: 'PROJECTS' }),
    createCostCode: (input, opts) => action('projects:cost_code:create', input, { ...opts, domain: 'PROJECTS' }),
    setBudgetLine: (input, opts) => action('projects:budget:set_line', input, { ...opts, domain: 'PROJECTS' }),
    approveBudget: (input, opts) => action('projects:budget:approve', input, { ...opts, domain: 'PROJECTS' }),
    reviseBudget: (input, opts) => action('projects:budget:revise', input, { ...opts, domain: 'PROJECTS' }),
    recordCommitment: (input, opts) => action('projects:commitment:record', input, { ...opts, domain: 'PROJECTS' }),
    releaseCommitment: (input, opts) => action('projects:commitment:release', input, { ...opts, domain: 'PROJECTS' }),
    createChangeOrder: (input, opts) => action('projects:change_order:create', input, { ...opts, domain: 'PROJECTS' }),
    approveChangeOrder: (input, opts) => action('projects:change_order:approve', input, { ...opts, domain: 'PROJECTS' }),
    rejectChangeOrder: (input, opts) => action('projects:change_order:reject', input, { ...opts, domain: 'PROJECTS' }),
    createRisk: (input, opts) => action('projects:risk:create', input, { ...opts, domain: 'PROJECTS' }),
    updateRisk: (input, opts) => action('projects:risk:update', input, { ...opts, domain: 'PROJECTS' }),
    createIssue: (input, opts) => action('projects:issue:create', input, { ...opts, domain: 'PROJECTS' }),
    resolveIssue: (input, opts) => action('projects:issue:resolve', input, { ...opts, domain: 'PROJECTS' }),
    recordEffort: (input, opts) => action('projects:effort:record', input, { ...opts, domain: 'PROJECTS' }),
    requestBilling: (input, opts) => action('projects:billing:request', input, { ...opts, domain: 'PROJECTS' }),
    approveBilling: (input, opts) => action('projects:billing:approve', input, { ...opts, domain: 'PROJECTS' }),
  };

  // Checkpoint D2 — canonical Engineering / BOM / Routing / MRP transport.
  const engineering = {
    dashboard: () => query('/engineering/dashboard'),
    listBoms: (params) => query('/boms/list', params),
    getBom: (id) => query(`/boms/detail/${encodeURIComponent(id)}`),
    listBomVersions: (params) => query('/boms/versions', params),
    listBomLines: (params) => query('/boms/lines', params),
    listRoutings: (params) => query('/routings/list', params),
    getRouting: (id) => query(`/routings/detail/${encodeURIComponent(id)}`),
    listRoutingOperations: (params) => query('/routings/operations', params),
    listWorkCenters: (params) => query('/work-centers/list', params),
    listWorkCenterResources: (params) => query('/work-centers/resources', params),
    listChangeOrders: (params) => query('/engineering/change-orders', params),

    createBom: (input, opts) => action('engineering:bom:create', input, { ...opts, domain: 'ENGINEERING' }),
    addBomLine: (input, opts) => action('engineering:bom:add_line', input, { ...opts, domain: 'ENGINEERING' }),
    removeBomLine: (input, opts) => action('engineering:bom:remove_line', input, { ...opts, domain: 'ENGINEERING' }),
    submitBom: (input, opts) => action('engineering:bom:submit', input, { ...opts, domain: 'ENGINEERING' }),
    approveBom: (input, opts) => action('engineering:bom:approve', input, { ...opts, domain: 'ENGINEERING' }),
    rejectBom: (input, opts) => action('engineering:bom:reject', input, { ...opts, domain: 'ENGINEERING' }),
    newBomRevision: (input, opts) => action('engineering:bom:new_revision', input, { ...opts, domain: 'ENGINEERING' }),
    supersedeBom: (input, opts) => action('engineering:bom:supersede', input, { ...opts, domain: 'ENGINEERING' }),
    createEco: (input, opts) => action('engineering:eco:create', input, { ...opts, domain: 'ENGINEERING' }),
    approveEco: (input, opts) => action('engineering:eco:approve', input, { ...opts, domain: 'ENGINEERING' }),
    rejectEco: (input, opts) => action('engineering:eco:reject', input, { ...opts, domain: 'ENGINEERING' }),
    createWorkCenter: (input, opts) => action('engineering:work_center:create', input, { ...opts, domain: 'ENGINEERING' }),
    updateWorkCenter: (input, opts) => action('engineering:work_center:update', input, { ...opts, domain: 'ENGINEERING' }),
    addWorkCenterResource: (input, opts) => action('engineering:work_center:add_resource', input, { ...opts, domain: 'ENGINEERING' }),
    createRouting: (input, opts) => action('engineering:routing:create', input, { ...opts, domain: 'ENGINEERING' }),
    addRoutingOperation: (input, opts) => action('engineering:routing:add_operation', input, { ...opts, domain: 'ENGINEERING' }),
    submitRouting: (input, opts) => action('engineering:routing:submit', input, { ...opts, domain: 'ENGINEERING' }),
    approveRouting: (input, opts) => action('engineering:routing:approve', input, { ...opts, domain: 'ENGINEERING' }),
    newRoutingRevision: (input, opts) => action('engineering:routing:new_revision', input, { ...opts, domain: 'ENGINEERING' }),
  };

  const mrp = {
    listPolicies: (params) => query('/mrp/policies', params),
    listDemand: (params) => query('/mrp/demand', params),
    listRuns: (params) => query('/mrp/runs', params),
    listRequirements: (params) => query('/mrp/requirements', params),
    listProposals: (params) => query('/mrp/proposals', params),
    listShortages: (params) => query('/mrp/shortages', params),
    worklist: (params) => query('/mrp/worklist', params),
    report: (report, params) => query('/mrp/reports', { ...(params || {}), report }),

    setPolicy: (input, opts) => action('mrp:policy:set', input, { ...opts, domain: 'MRP' }),
    recordDemand: (input, opts) => action('mrp:demand:record', input, { ...opts, domain: 'MRP' }),
    run: (input, opts) => action('mrp:run:execute', input || {}, { ...opts, domain: 'MRP' }),
    approveProposal: (input, opts) => action('mrp:proposal:approve', input, { ...opts, domain: 'MRP' }),
    rejectProposal: (input, opts) => action('mrp:proposal:reject', input, { ...opts, domain: 'MRP' }),
  };

  const procurement = {
    listRequests: (params) => query('/procurement/requests', params),
    getRequest: (id) => query(`/procurement/requests/${encodeURIComponent(id)}`),
    listRequisitions: (params) => query('/procurement/requisitions', params),
    getRequisition: (id) => query(`/procurement/requisitions/${encodeURIComponent(id)}`),
    listRfqs: (params) => query('/procurement/rfqs', params),
    getRfq: (id) => query(`/procurement/rfqs/${encodeURIComponent(id)}`),
    listSupplierQuotations: (params) => query('/procurement/supplier-quotations', params),
    getSupplierQuotation: (id) => query(`/procurement/supplier-quotations/${encodeURIComponent(id)}`),
    compareSupplierQuotations: (rfqId) => query('/procurement/comparison', { rfq_id: rfqId }),
    listOrders: (params) => query('/procurement/orders', params),
    getOrder: (id) => query(`/procurement/orders/${encodeURIComponent(id)}`),
    listReceipts: (params) => query('/procurement/receipts', params),
    listQualityChecks: (params) => query('/procurement/quality-checks', params),
    listMatches: (params) => query('/procurement/matches', params),
    listMismatches: (params) => query('/procurement/mismatch-worklist', params),
    listBillRequests: (params) => query('/procurement/bill-requests', params),
    listReturns: (params) => query('/procurement/returns', params),
    listCommitments: (params) => query('/procurement/commitments', params),
    listSupplierPerformance: (params) => query('/procurement/supplier-performance', params),
    report: (report, params) => query('/procurement/reports', { ...(params || {}), report }),
    createRequest: (input, opts) => action('procurement:request:create', input, { ...opts, domain: 'PROCUREMENT' }),
    submitRequest: (input, opts) => action('procurement:request:submit', input, { ...opts, domain: 'PROCUREMENT' }),
    approveRequest: (input, opts) => action('procurement:request:approve', input, { ...opts, domain: 'PROCUREMENT' }),
    approveRequisition: (input, opts) => action('procurement:requisition:approve', input, { ...opts, domain: 'PROCUREMENT' }),
    createRfq: (input, opts) => action('procurement:rfq:create', input, { ...opts, domain: 'PROCUREMENT' }),
    recordSupplierQuotation: (input, opts) => action('procurement:supplier_quotation:record', input, { ...opts, domain: 'PROCUREMENT' }),
    awardSupplierQuotation: (input, opts) => action('procurement:supplier_quotation:award', input, { ...opts, domain: 'PROCUREMENT' }),
    createOrder: (input, opts) => action('procurement:order:create', input, { ...opts, domain: 'PROCUREMENT' }),
    approveOrder: (input, opts) => action('procurement:order:approve', input, { ...opts, domain: 'PROCUREMENT' }),
    confirmOrder: (input, opts) => action('procurement:order:confirm', input, { ...opts, domain: 'PROCUREMENT' }),
    postReceipt: (input, opts) => action('procurement:receipt:post', input, { ...opts, domain: 'PROCUREMENT' }),
    threeWayMatch: (input, opts) => action('procurement:threewaymatch:perform', input, { ...opts, domain: 'PROCUREMENT' }),
    createBillRequest: (input, opts) => action('procurement:bill_request:create', input, { ...opts, domain: 'PROCUREMENT' }),
    createReturn: (input, opts) => action('procurement:return:create', input, { ...opts, domain: 'PROCUREMENT' }),
    recordSupplierScore: (input, opts) => action('procurement:score:record', input, { ...opts, domain: 'PROCUREMENT' }),
  };

  const pos = {
    listOrders: (params) => query('/pos/orders', params),
    getOrder: (id) => query(`/pos/orders/${encodeURIComponent(id)}`),
    listSessions: (params) => query('/pos/sessions', params),
    getSession: (id) => query(`/pos/sessions/${encodeURIComponent(id)}`),
    listTerminals: (params) => query('/pos/terminals', params),
    listPaymentMethods: (params) => query('/pos/payment-methods', params),
    listRefunds: (params) => query('/pos/refunds', params),
    listReconciliations: (params) => query('/pos/reconciliations', params),
    listAuditOutbox: (params) => query('/pos/audit-outbox', params),
    report: (report, params) => query('/pos/reports', { ...(params || {}), report }),
    configureTerminal: (input, opts) => action('pos:terminal:configure', input, { ...opts, domain: 'POS' }),
    configurePaymentMethod: (input, opts) => action('pos:payment_method:configure', input, { ...opts, domain: 'POS' }),
    openSession: (input, opts) => action('pos:session:open', input, { ...opts, domain: 'POS' }),
    // `session_id` is a POS business-record foreign key for these actions,
    // not authentication state. Actor identity still comes only from the
    // secure cookie and every other scope field remains stripped.
    closeSession: (input, opts) => action('pos:session:close', input, { ...opts, domain: 'POS', allowedBusinessKeys: ['session_id'] }),
    processOrder: (input, opts) => action('pos:order:process', input, { ...opts, domain: 'POS', allowedBusinessKeys: ['session_id'] }),
    refundOrder: (input, opts) => action('pos:order:refund', input, { ...opts, domain: 'POS', allowedBusinessKeys: ['session_id'] }),
  };

  const workItems = {
    list: (params) => query('/work-items/items', params),
    get: (id) => query(`/work-items/items/${encodeURIComponent(id)}`),
    report: (report, params) => query('/work-items/reports', { ...(params || {}), report }),
    create: (input, opts) => action('work_item:create', input, { ...opts, domain: 'WORK_ITEM' }),
    update: (input, opts) => action('work_item:update', input, { ...opts, domain: 'WORK_ITEM' }),
    assign: (input, opts) => action('work_item:assign', input, { ...opts, domain: 'WORK_ITEM' }),
    transition: (input, opts) => action('work_item:transition', input, { ...opts, domain: 'WORK_ITEM' }),
    addSubtask: (input, opts) => action('work_item:add_subtask', input, { ...opts, domain: 'WORK_ITEM' }),
    addDependency: (input, opts) => action('work_item:add_dependency', input, { ...opts, domain: 'WORK_ITEM' }),
    complete: (input, opts) => action('work_item:complete', input, { ...opts, domain: 'WORK_ITEM' }),
    cancel: (input, opts) => action('work_item:cancel', input, { ...opts, domain: 'WORK_ITEM' }),
    approve: (input, opts) => action('work_item:approve', input, { ...opts, domain: 'WORK_ITEM' }),
    remove: (input, opts) => action('work_item:delete', input, { ...opts, domain: 'WORK_ITEM' }),
  };

  const controlPlane = {
    list: (resource, params) => query(`/control-plane/${encodeURIComponent(resource)}`, params),
    getModule: (id) => query(`/control-plane/module/${encodeURIComponent(id)}`),
    setModuleStatus: (input, opts) => action('control:module:set_status', input, { ...opts, domain: 'CONTROL_PLANE' }),
    setFeature: (input, opts) => action('control:feature:set', input, { ...opts, domain: 'CONTROL_PLANE' }),
    assignModule: (input, opts) => action('control:module:assign', input, { ...opts, domain: 'CONTROL_PLANE' }),
    setLicense: (input, opts) => action('control:license:set', input, {
      ...opts,
      domain: 'CONTROL_PLANE',
      allowedBusinessKeys: ['company_id'],
    }),
    setJob: (input, opts) => action('control:job:set', input, { ...opts, domain: 'CONTROL_PLANE' }),
    testPing: (input = {}, opts) => action('control:test:ping', input, { ...opts, domain: 'CONTROL_PLANE' }),
  };

  // -------------------------------------------------------------------------
  // Wave 2 domains — Final Page Catalog.
  //
  // The 16 Wave 2 domains share one governed read shape
  // (GET /api/v1/<namespace>/<resource>) and one governed write shape
  // (POST /api/v1/action/<namespace>:<action>), so they need one thin helper
  // rather than 16 hand-written client objects.
  //
  // `describe()` hits the /_meta descriptor so a page can render a truthful
  // "module not installed" / "configuration required" state instead of an
  // empty table that looks like "no data".
  // -------------------------------------------------------------------------
  const WAVE2_NAMESPACES = Object.freeze([
    'contracts', 'subscriptions', 'rental', 'expenses', 'sourcing',
    'human_capital', 'financial_planning', 'treasury', 'wms', 'plm',
    'grc', 'hse', 'bi', 'integration', 'iraq_localization', 'ai_copilot',
  ]);

  const wave2 = {
    NAMESPACES: WAVE2_NAMESPACES,
    /** Governed list read. Company scope is applied server-side. */
    list(namespace, resource, params) {
      return query(`/${namespace}/${resource}`, params);
    },
    /** Governed single-record read. */
    get(namespace, resource, id) {
      return query(`/${namespace}/${resource}/${encodeURIComponent(id)}`);
    },
    /** What this module exposes: resources, actions, permissions. */
    describe(namespace) {
      return query(`/${namespace}/_meta`);
    },
    /** Governed command. Action ids are fixed tokens, never user input. */
    run(actionId, input, opts) {
      return action(actionId, input || {}, { ...(opts || {}), domain: 'WAVE2' });
    },
    /**
     * Resolve a namespace to a small facade, so a page reads as
     * `treasury.list('bank-accounts')` rather than repeating the namespace.
     */
    domain(namespace) {
      return {
        namespace,
        list: (resource, params) => wave2.list(namespace, resource, params),
        get: (resource, id) => wave2.get(namespace, resource, id),
        describe: () => wave2.describe(namespace),
        run: (actionId, input, opts) => wave2.run(actionId, input, opts),
      };
    },
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
    crm,
    projects,
    engineering,
    mrp,
    procurement,
    pos,
    workItems,
    controlPlane,
    wave2,

    // exposed for tests and diagnostics
    _internal: { stripForbidden, splitServerError, buildQueryString, FORBIDDEN_INPUT_KEYS },
  };

  root.CanonicalClient = CanonicalClient;
  services.canonicalClient = CanonicalClient;
})();
