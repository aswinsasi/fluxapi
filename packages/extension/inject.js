// ═══════════════════════════════════════════════════════════════════
// FluxAPI Chrome Extension — Page Context Interceptor
// Patches window.fetch and XMLHttpRequest to capture API traffic.
// Dispatches custom events that the content script listens for.
// ═══════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  if (window.__FLUXAPI_INJECTED__) return;
  window.__FLUXAPI_INJECTED__ = true;

  const origFetch = window.fetch;
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  // ─── Fetch Interceptor ──────────────────────────────────────

  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const startTime = performance.now();

    // Capture component from stack trace
    const stack = new Error().stack || '';
    const componentName = extractComponent(stack);

    let bodySize = 0;
    if (init?.body) {
      bodySize = typeof init.body === 'string' ? init.body.length : 0;
    }

    try {
      const response = await origFetch.call(this, input, init);
      const endTime = performance.now();

      // Clone to read headers without consuming
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });

      dispatch({
        url: new URL(url, location.origin).href,
        method: method.toUpperCase(),
        startTime,
        endTime,
        ttfb: startTime + (endTime - startTime) * 0.3,
        status: response.status,
        statusText: response.statusText,
        responseHeaders: headers,
        responseSize: parseInt(headers['content-length'] || '0', 10),
        contentType: headers['content-type'] || null,
        bodySize,
        bodyHash: null,
        componentName,
        stack,
        source: 'fetch',
        error: null,
      });

      return response;
    } catch (err) {
      const endTime = performance.now();
      dispatch({
        url: new URL(url, location.origin).href,
        method: method.toUpperCase(),
        startTime,
        endTime,
        status: 0,
        bodySize,
        componentName,
        stack,
        source: 'fetch',
        error: err?.message || 'Fetch failed',
      });
      throw err;
    }
  };

  // ─── XHR Interceptor ───────────────────────────────────────

  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this.__flux_method = method;
    this.__flux_url = url;
    return origXHROpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    const startTime = performance.now();
    const stack = new Error().stack || '';
    const componentName = extractComponent(stack);

    const onDone = () => {
      const endTime = performance.now();
      const headers = {};
      try {
        const raw = xhr.getAllResponseHeaders() || '';
        raw.split('\r\n').forEach(line => {
          const [k, ...v] = line.split(':');
          if (k && v.length) headers[k.trim().toLowerCase()] = v.join(':').trim();
        });
      } catch {}

      dispatch({
        url: new URL(xhr.__flux_url, location.origin).href,
        method: (xhr.__flux_method || 'GET').toUpperCase(),
        startTime,
        endTime,
        ttfb: startTime + (endTime - startTime) * 0.3,
        status: xhr.status,
        statusText: xhr.statusText,
        responseHeaders: headers,
        responseSize: xhr.response ? (typeof xhr.response === 'string' ? xhr.response.length : 0) : 0,
        contentType: xhr.getResponseHeader?.('content-type') || null,
        bodySize: body ? (typeof body === 'string' ? body.length : 0) : 0,
        bodyHash: null,
        componentName,
        stack,
        source: 'xhr',
        error: xhr.status === 0 ? 'Network error' : null,
      });
    };

    xhr.addEventListener('loadend', onDone);
    return origXHRSend.call(this, body);
  };

  // ─── Helpers ────────────────────────────────────────────────

  function dispatch(detail) {
    window.dispatchEvent(new CustomEvent('__FLUXAPI_REQUEST__', { detail }));
  }

  function extractComponent(stack) {
    if (!stack) return null;
    const lines = stack.split('\n');
    for (const line of lines) {
      // Match React component names: at ComponentName (file.js:line:col)
      const match = line.match(/at\s+([A-Z][a-zA-Z0-9]+)\s/);
      if (match && !['Error', 'Object', 'Promise', 'Function', 'Array', 'XMLHttpRequest'].includes(match[1])) {
        return match[1];
      }
    }
    return null;
  }
})();
