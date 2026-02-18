// ─── FluxAPI Browser Observer (Injectable) ───
// This is a self-contained script injected into the page via Puppeteer.
// It monkey-patches fetch/XHR and exposes __FLUX_API__ on window.

(function() {
  'use strict';

  if (window.__FLUX_API__) return; // Already injected

  let requestCounter = 0;
  const records = [];
  const navigations = [];
  let isObserving = false;
  let startTime = 0;
  let lastRoute = null;

  const EXCLUDE_PATTERNS = [
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)(\?|$)/i,
    /^chrome-extension:/,
    /hot-update/,
    /__webpack_hmr/,
    /sockjs-node/,
    /favicon/,
    /^data:/,
  ];

  function generateId() {
    return 'flux-' + Date.now() + '-' + (++requestCounter);
  }

  function shouldRecord(url) {
    for (const p of EXCLUDE_PATTERNS) {
      if (p.test(url)) return false;
    }
    return true;
  }

  function getCurrentRoute() {
    return location.pathname + location.search;
  }

  function extractCacheHeaders(headers) {
    return {
      cacheControl: headers['cache-control'] || null,
      etag: headers['etag'] || null,
      lastModified: headers['last-modified'] || null,
      expires: headers['expires'] || null,
      age: headers['age'] || null,
    };
  }

  function getComponentFromStack(stack) {
    if (!stack) return undefined;
    const lines = stack.split('\n');
    for (const line of lines) {
      const reactMatch = line.match(/at\s+([A-Z][a-zA-Z0-9]+)\s+\(/);
      if (reactMatch && !['Object','Function','Array','Promise','XMLHttpRequest','Window'].includes(reactMatch[1])) {
        return reactMatch[1];
      }
      const vueMatch = line.match(/([A-Z][a-zA-Z0-9]+)\.vue/);
      if (vueMatch) return vueMatch[1];
    }
    return undefined;
  }

  function headersToRecord(headers) {
    const record = {};
    if (headers && typeof headers.forEach === 'function') {
      headers.forEach(function(value, key) { record[key.toLowerCase()] = value; });
    } else if (headers && typeof headers === 'object') {
      Object.keys(headers).forEach(function(key) { record[key.toLowerCase()] = String(headers[key]); });
    }
    return record;
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 10000); i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // ─── Patch fetch ───
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input && input.url ? input.url : ''));
    const method = ((init && init.method) || 'GET').toUpperCase();

    if (!isObserving || !shouldRecord(url)) {
      return originalFetch.call(window, input, init);
    }

    const id = generateId();
    const stack = new Error().stack || '';
    const timestamp = Date.now();

    const reqRecord = {
      request: {
        id: id,
        url: url,
        method: method,
        headers: (init && init.headers) ? headersToRecord(init.headers) : {},
        bodySize: (init && init.body) ? (typeof init.body === 'string' ? init.body.length : 0) : 0,
        timestamp: timestamp,
        initiator: 'fetch',
        stackTrace: stack.substring(0, 500),
        component: getComponentFromStack(stack),
        route: getCurrentRoute(),
      },
      response: null,
    };
    records.push(reqRecord);

    return originalFetch.call(window, input, init).then(function(response) {
      const responseTimestamp = Date.now();
      const cloned = response.clone();

      cloned.text().then(function(text) {
        const responseHeaders = headersToRecord(response.headers);
        reqRecord.response = {
          requestId: id,
          status: response.status,
          headers: responseHeaders,
          bodySize: text.length,
          timestamp: responseTimestamp,
          ttfb: responseTimestamp - timestamp,
          totalTime: responseTimestamp - timestamp,
          contentType: responseHeaders['content-type'] || '',
          cacheHeaders: extractCacheHeaders(responseHeaders),
          contentHash: simpleHash(text),
          fieldCount: null,
          usedFieldCount: null,
        };

        // Try to count JSON fields
        if (responseHeaders['content-type'] && responseHeaders['content-type'].indexOf('json') !== -1) {
          try {
            const parsed = JSON.parse(text);
            reqRecord.response.fieldCount = countFields(parsed);
          } catch(e) {}
        }
      }).catch(function() {
        reqRecord.response = {
          requestId: id,
          status: response.status,
          headers: {},
          bodySize: 0,
          timestamp: responseTimestamp,
          ttfb: responseTimestamp - timestamp,
          totalTime: responseTimestamp - timestamp,
          contentType: '',
          cacheHeaders: { cacheControl: null, etag: null, lastModified: null, expires: null, age: null },
          contentHash: '',
        };
      });

      return response;
    }).catch(function(error) {
      reqRecord.response = {
        requestId: id,
        status: 0,
        headers: {},
        bodySize: 0,
        timestamp: Date.now(),
        ttfb: Date.now() - timestamp,
        totalTime: Date.now() - timestamp,
        contentType: '',
        cacheHeaders: { cacheControl: null, etag: null, lastModified: null, expires: null, age: null },
        contentHash: '',
      };
      throw error;
    });
  };

  // ─── Patch XHR ───
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__flux_method = method.toUpperCase();
    this.__flux_url = url.toString();
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const url = this.__flux_url;
    const method = this.__flux_method;

    if (!isObserving || !shouldRecord(url)) {
      return origSend.call(this, body);
    }

    const id = generateId();
    const stack = new Error().stack || '';
    const timestamp = Date.now();

    const reqRecord = {
      request: {
        id: id,
        url: url,
        method: method,
        headers: {},
        bodySize: body ? (typeof body === 'string' ? body.length : 0) : 0,
        timestamp: timestamp,
        initiator: 'xhr',
        stackTrace: stack.substring(0, 500),
        component: getComponentFromStack(stack),
        route: getCurrentRoute(),
      },
      response: null,
    };
    records.push(reqRecord);

    var xhr = this;
    this.addEventListener('loadend', function() {
      var responseHeaders = {};
      var rawHeaders = xhr.getAllResponseHeaders();
      rawHeaders.split('\r\n').forEach(function(line) {
        var parts = line.split(': ');
        if (parts.length >= 2) responseHeaders[parts[0].toLowerCase()] = parts.slice(1).join(': ');
      });

      reqRecord.response = {
        requestId: id,
        status: xhr.status,
        headers: responseHeaders,
        bodySize: xhr.responseText ? xhr.responseText.length : 0,
        timestamp: Date.now(),
        ttfb: Date.now() - timestamp,
        totalTime: Date.now() - timestamp,
        contentType: responseHeaders['content-type'] || '',
        cacheHeaders: extractCacheHeaders(responseHeaders),
        contentHash: xhr.responseText ? simpleHash(xhr.responseText) : '',
      };
    });

    return origSend.call(this, body);
  };

  // ─── Navigation tracking ───
  var origPush = history.pushState;
  var origReplace = history.replaceState;

  function trackNav() {
    var newRoute = getCurrentRoute();
    if (newRoute !== lastRoute && isObserving) {
      navigations.push({ from: lastRoute, to: newRoute, timestamp: Date.now() });
      lastRoute = newRoute;
    }
  }

  history.pushState = function() { var r = origPush.apply(this, arguments); trackNav(); return r; };
  history.replaceState = function() { var r = origReplace.apply(this, arguments); trackNav(); return r; };
  window.addEventListener('popstate', trackNav);

  // ─── Field counter ───
  function countFields(obj, depth) {
    if (!depth) depth = 0;
    if (depth > 5) return 0;
    if (Array.isArray(obj)) {
      return obj.length > 0 ? countFields(obj[0], depth + 1) : 0;
    }
    if (obj && typeof obj === 'object') {
      var count = 0;
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          count++;
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            count += countFields(obj[key], depth + 1);
          }
        }
      }
      return count;
    }
    return 0;
  }

  // ─── Public API ───
  window.__FLUX_API__ = {
    start: function() {
      isObserving = true;
      startTime = Date.now();
      lastRoute = getCurrentRoute();
      records.length = 0;
      navigations.length = 0;
      console.log('[FluxAPI] Observer started');
    },
    stop: function() {
      isObserving = false;
      console.log('[FluxAPI] Observer stopped. ' + records.length + ' requests recorded.');
      return { records: records, navigations: navigations, duration: Date.now() - startTime };
    },
    getStatus: function() {
      return { isObserving: isObserving, requestCount: records.length, duration: isObserving ? Date.now() - startTime : 0 };
    },
    getRecords: function() { return records; },
    getNavigations: function() { return navigations; },
  };

})();
