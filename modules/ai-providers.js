/**
 * OCTAGON OMNISYSTEM - modules/ai-providers.js
 *
 * Unified AI provider layer. Lets the whole ERP (Jarvis brain, the floating
 * assistant, and the System Brain page) run on OpenRouter models — DeepSeek /
 * Qwen — while keeping Google Gemini as a fallback and for voice-audio
 * transcription (OpenRouter text models can't take inline audio).
 *
 * It transparently overrides window.callOctagonAi / window.callPentagonAi with a
 * single `chat(userText, systemContext, opts)` that keeps the exact same
 * signature the rest of the app already uses, so nothing else has to change.
 *
 * MUST load AFTER app.js (which defines the original Gemini caller we keep as a
 * fallback) and is loaded BEFORE the assistant/brain that call it lazily.
 *
 * SECURITY (offline build): the OpenRouter key is inlined as a default the same
 * way the Gemini key is, so the system works offline-from-disk. It is ALSO
 * overridable from localStorage (key: octagonAIProvider) so you can rotate it
 * without editing code. Set a spending limit on OpenRouter and ROTATE this key
 * before putting the app online — anything in client JS is readable by users.
 */
(function () {
  'use strict';

  const LS_KEY = 'octagonAIProvider';

  // Friendly aliases -> full OpenRouter model ids.
  const MODELS = {
    deepseek: 'deepseek/deepseek-chat',          // DeepSeek V3 — cheap, strong, great with the brain prompt
    'deepseek-r1': 'deepseek/deepseek-r1',        // DeepSeek R1 — deeper reasoning (slower/pricier)
    qwen: 'qwen/qwen-2.5-72b-instruct',           // Qwen 2.5 72B — excellent Arabic, very clean JSON
    'qwen-coder': 'qwen/qwen-2.5-coder-32b-instruct'
  };

  const DEFAULTS = {
    provider: 'openrouter',                       // 'openrouter' | 'gemini'
    model: 'qwen/qwen3.5-flash-02-23',
    openrouterKey: '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',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    maxTokens: 1400,
    temperature: 0.3
  };

  function cfg() {
    try {
      const stored = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      const merged = Object.assign({}, DEFAULTS, stored);
      if (stored.model === MODELS.deepseek && !stored.modelPinned) merged.model = DEFAULTS.model;
      return merged;
    }
    catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function setCfg(patch) {
    const next = Object.assign(cfg(), patch || {});
    // never persist the inline default key unless the user explicitly set one
    const toStore = Object.assign({}, next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(toStore)); } catch (_) {}
    return next;
  }

  // The original Gemini caller installed by app.js. Captured once, kept as fallback.
  const geminiCall = (typeof window.callOctagonAi === 'function' && window.callOctagonAi)
    || (typeof window.callPentagonAi === 'function' && window.callPentagonAi)
    || null;

  // ---- governance: live provider health (no keys ever stored here) ----------
  const STATE = {
    lastProvider: '', lastStatus: 'unknown', lastError: '',
    lastSuccessAt: '', lastFailureAt: '', failCount: 0, callCount: 0
  };
  function audit(eventType, data) {
    try { if (window.OctagonAIGovernance && typeof window.OctagonAIGovernance.audit === 'function') window.OctagonAIGovernance.audit(eventType, data); } catch (_) {}
  }
  function markSuccess(provider, model) {
    STATE.lastProvider = provider; STATE.lastStatus = 'ok'; STATE.lastError = '';
    STATE.lastSuccessAt = new Date().toISOString(); STATE.callCount++;
    audit('ai.provider.call', { provider: provider, model: model || '', ok: true });
  }
  function markFailure(provider, err) {
    STATE.lastProvider = provider; STATE.lastStatus = 'failed';
    STATE.lastError = String(err && err.message ? err.message : err).slice(0, 200);
    STATE.lastFailureAt = new Date().toISOString(); STATE.failCount++; STATE.callCount++;
    audit('ai.provider.failure', { provider: provider, error: STATE.lastError });
  }

  async function callOpenRouter(userText, systemContext, opts) {
    opts = opts || {};
    const c = cfg();
    const key = opts.key || c.openrouterKey;
    if (!key) throw new Error('No OpenRouter API key configured');

    const messages = [];
    if (systemContext) messages.push({ role: 'system', content: String(systemContext) });
    messages.push({ role: 'user', content: String(userText || '') });

    const headers = {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    };
    // OpenRouter ranking headers (harmless, optional).
    try { headers['HTTP-Referer'] = (typeof location !== 'undefined' && location.origin) ? location.origin : 'http://localhost'; } catch (_) {}
    headers['X-Title'] = 'Octagon ERP Jarvis';

    const res = await fetch(opts.endpoint || c.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model || c.model,
        messages,
        temperature: typeof opts.temperature === 'number' ? opts.temperature : c.temperature,
        max_tokens: opts.maxTokens || c.maxTokens,
        reasoning: opts.reasoning || c.reasoning || { effort: 'none' }
      })
    });

    let data;
    try { data = await res.json(); } catch (e) { throw new Error('OpenRouter returned a non-JSON response (HTTP ' + res.status + ')'); }
    if (data && data.error) throw new Error((data.error.message || 'OpenRouter error') + (data.error.code ? ' [' + data.error.code + ']' : ''));
    if (!res.ok) throw new Error('OpenRouter HTTP ' + res.status);
    const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return String(out || '').trim();
  }

  /**
   * Unified entry point. Same signature as the old callOctagonAi:
   *   chat(userText, systemContext, opts)
   * opts may include: { audio, model, temperature, maxTokens, provider }
   */
  async function chat(userText, systemContext, opts) {
    opts = opts || {};
    const c = cfg();
    const provider = opts.provider || c.provider;

    const mixedLangRule = "\nArabic is the primary language. English words inside Arabic are technical terms and must not change the response language. Reply in clear Arabic unless the user explicitly asks for English.";
    if (systemContext) {
      systemContext = String(systemContext) + mixedLangRule;
    } else {
      systemContext = mixedLangRule;
    }

    // Audio messages must go to Gemini (inline audio); OpenRouter text models can't.
    if (opts.audio) {
      if (typeof geminiCall === 'function') return geminiCall(userText, systemContext, opts);
      throw new Error('Audio requires the Gemini provider, which is not available');
    }

    if (provider === 'openrouter' && (opts.key || c.openrouterKey)) {
      try {
        const out = await callOpenRouter(userText, systemContext, opts);
        if (out) { markSuccess('openrouter', opts.model || c.model); return out; }
        markFailure('openrouter', 'empty response');
        console.warn('[OctagonAI] OpenRouter returned empty; falling back to Gemini.');
      } catch (e) {
        markFailure('openrouter', e);
        console.warn('[OctagonAI] OpenRouter failed; falling back to Gemini:', e && e.message ? e.message : e);
      }
    }

    if (typeof geminiCall === 'function') {
      try {
        const out = await geminiCall(userText, systemContext, opts);
        markSuccess('gemini', 'gemini-flash');
        return out;
      } catch (e) {
        markFailure('gemini', e);
        throw e; // callers (Jarvis brain / assistant) have their own deterministic fallback
      }
    }
    markFailure('none', 'no provider configured');
    throw new Error('No AI provider available');
  }

  // ---- install: route the whole app through this layer ----------------------
  window.__octagonGeminiAi = geminiCall;   // keep the original reachable
  window.callOctagonAi = chat;
  window.callPentagonAi = chat;

  // ---- public control surface ----------------------------------------------
  window.OctagonAI = {
    chat,
    callOpenRouter,
    gemini: geminiCall,
    config: cfg,
    setConfig: setCfg,
    /** Switch model. Accepts an alias ('deepseek','qwen',...) or a full id. */
    setModel(m) { const id = MODELS[m] || m; setCfg({ model: id, provider: 'openrouter' }); console.log('[OctagonAI] model =', id); return id; },
    /** Force the Gemini provider (e.g. if OpenRouter credits run out). */
    useGemini() { setCfg({ provider: 'gemini' }); console.log('[OctagonAI] provider = gemini'); return 'gemini'; },
    /** Back to OpenRouter. */
    useOpenRouter() { setCfg({ provider: 'openrouter' }); console.log('[OctagonAI] provider = openrouter'); return 'openrouter'; },
    /** Replace the OpenRouter key at runtime (persists to localStorage). */
    setKey(k) { setCfg({ openrouterKey: k }); console.log('[OctagonAI] OpenRouter key updated'); return true; },
    /** Live provider health — safe to show in UI, never includes keys. */
    status() {
      const c = cfg();
      return {
        activeProvider: c.provider,
        model: c.model,
        fallbackProvider: (typeof geminiCall === 'function') ? 'gemini' : 'deterministic',
        deterministicFallbackEnabled: true,
        hasOpenRouterKey: !!c.openrouterKey,
        lastProvider: STATE.lastProvider,
        lastStatus: STATE.lastStatus,
        lastError: STATE.lastError,
        lastSuccessAt: STATE.lastSuccessAt,
        lastFailureAt: STATE.lastFailureAt,
        failCount: STATE.failCount,
        callCount: STATE.callCount
      };
    },
    /** Round-trip test against the active provider chain. */
    async testProvider() {
      try {
        const out = await chat('ping — reply with the single word: pong', 'You are a health check. Reply with one word only.', { temperature: 0, maxTokens: 10 });
        console.log('[OctagonAI] testProvider OK:', String(out).slice(0, 60));
        return { ok: true, reply: String(out).slice(0, 60), provider: STATE.lastProvider };
      } catch (e) {
        console.warn('[OctagonAI] testProvider FAILED:', e && e.message);
        return { ok: false, error: String(e && e.message || e), provider: STATE.lastProvider };
      }
    },
    models: MODELS,
    version: '2.0' // governance sprint: health state + audit + testProvider/status
  };

  try {
    const c = cfg();
    console.log('[OctagonAI] ready — provider=%s model=%s (Gemini fallback=%s)', c.provider, c.model, geminiCall ? 'yes' : 'no');
  } catch (_) {}
})();
