(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  const states = new Map();

  function getState(pageKey) {
    if (!states.has(pageKey)) {
      states.set(pageKey, {
        phase: 'idle', // 'idle' | 'loading' | 'loaded' | 'empty' | 'error' | 'denied'
        rows: [],
        filter: '',
        error: '',
        updatedAt: null,
        abortController: null
      });
    }
    return states.get(pageKey);
  }

  function setState(pageKey, updates) {
    const current = getState(pageKey);
    Object.assign(current, updates);
    return current;
  }

  function cancelPending(pageKey) {
    const current = getState(pageKey);
    if (current.abortController) {
      current.abortController.abort();
      current.abortController = null;
    }
  }

  root.Build10State = {
    getState,
    setState,
    cancelPending
  };
})();
