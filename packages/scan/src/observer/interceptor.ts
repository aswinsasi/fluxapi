// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Flux Observer
// Monkey-patches fetch() and XMLHttpRequest to intercept all network
// requests without modifying application behavior.
// Target size: ~3KB gzipped when built as IIFE
// ═══════════════════════════════════════════════════════════════════

import type {
  FluxRequestRecord,
  FluxResponseRecord,
  CacheHeaders,
  FluxEvent,
  FluxEventHandler,
  FluxScanConfig,
} from '../types';
import {
  generateId,
  nextSequence,
  parseUrl,
  classifyRequest,
  fastHash,
  sanitizeHeaders,
  headersToObject,
  estimateBodySize,
  shouldIgnore,
} from '../utils';
import { captureInitiator } from '../stack-trace/capture';
import { getNavigationContext } from '../navigation/tracker';

// ─── Observer State ─────────────────────────────────────────────

let _isActive = false;
let _originalFetch: typeof globalThis.fetch | null = null;
let _originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
let _originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;
let _config: FluxScanConfig | null = null;
const _handlers: FluxEventHandler[] = [];

// ─── Event Emitter ──────────────────────────────────────────────

function emit(event: FluxEvent): void {
  for (const handler of _handlers) {
    try {
      handler(event);
    } catch (e) {
      // Never let observer errors affect the application
      if (_config?.verbose) console.warn('[FluxAPI] Event handler error:', e);
    }
  }
}

export function onEvent(handler: FluxEventHandler): () => void {
  _handlers.push(handler);
  return () => {
    const idx = _handlers.indexOf(handler);
    if (idx !== -1) _handlers.splice(idx, 1);
  };
}

// ─── Response Processing ────────────────────────────────────────

function extractCacheHeaders(headers: Record<string, string>): CacheHeaders {
  return {
    cacheControl: headers['cache-control'] || null,
    etag: headers['etag'] || null,
    lastModified: headers['last-modified'] || null,
    expires: headers['expires'] || null,
    age: headers['age'] || null,
    acceptEncoding: false, // Set from request headers
    contentEncoding: headers['content-encoding'] || null,
  };
}

async function processResponse(
  response: Response,
  record: FluxRequestRecord,
  captureFields: boolean,
): Promise<FluxResponseRecord> {
  const headers = headersToObject(response.headers);
  const cacheHeaders = extractCacheHeaders(headers);

  // Clone response so we don't consume the body
  let bodySize = 0;
  let bodyHash = '';
  let jsonFieldCount: number | null = null;

  try {
    const clone = response.clone();
    const blob = await clone.blob();
    bodySize = blob.size;
    
    // For JSON responses, count fields and hash body
    const contentType = headers['content-type'] || '';
    if (contentType.includes('application/json') && captureFields) {
      try {
        const text = await blob.text();
        bodyHash = fastHash(text);
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          jsonFieldCount = Array.isArray(parsed)
            ? (parsed.length > 0 ? Object.keys(parsed[0]).length : 0)
            : Object.keys(parsed).length;
        }
      } catch {
        // Not valid JSON, that's fine
        bodyHash = fastHash(String(bodySize));
      }
    } else {
      bodyHash = fastHash(String(bodySize) + contentType);
    }
  } catch {
    bodyHash = fastHash('error');
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    bodySize,
    contentType: headers['content-type'] || null,
    cacheHeaders,
    bodyHash,
    jsonFieldCount,
    fromCache: response.headers.get('x-cache') === 'HIT' ||
               response.headers.get('cf-cache-status') === 'HIT' ||
               false,
  };
}

// ─── Build Request Record ───────────────────────────────────────

function createRequestRecord(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: BodyInit | null | undefined,
  source: 'fetch' | 'xhr',
): FluxRequestRecord {
  const initiator = captureInitiator();
  const navContext = getNavigationContext();
  const bodyStr = typeof body === 'string' ? body : null;

  return {
    id: generateId(),
    url,
    method: method.toUpperCase(),
    urlParts: parseUrl(url),
    headers: sanitizeHeaders(headers),
    bodySize: estimateBodySize(body),
    bodyHash: bodyStr ? fastHash(bodyStr) : null,
    startTime: performance.now(),
    ttfb: null,
    endTime: null,
    duration: null,
    response: null,
    initiator,
    navigationContext: navContext,
    type: classifyRequest(url, method, headers['content-type'] || null, bodyStr),
    source,
    error: null,
    sequence: nextSequence(),
  };
}

// ─── Fetch Interceptor ─────────────────────────────────────────

function interceptFetch(): void {
  if (!globalThis.fetch || _originalFetch) return;

  _originalFetch = globalThis.fetch;

  globalThis.fetch = async function fluxFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Extract URL and method
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const method = init?.method || (input instanceof Request ? input.method : 'GET');

    // Check if this URL should be ignored
    if (_config && shouldIgnore(url, _config.ignore)) {
      return _originalFetch!.call(globalThis, input, init);
    }

    // Extract headers
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
      } else {
        Object.entries(init.headers).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
      }
    }

    // Create request record
    const record = createRequestRecord(url, method, headers, init?.body, 'fetch');

    // Check request acceptEncoding
    record.response && (record.response.cacheHeaders.acceptEncoding =
      !!headers['accept-encoding']);

    emit({ type: 'request:start', data: record });

    try {
      const response = await _originalFetch!.call(globalThis, input, init);

      // Record timing
      record.ttfb = performance.now();
      record.response = await processResponse(response, record, _config?.captureFields ?? true);
      record.endTime = performance.now();
      record.duration = record.endTime - record.startTime;

      // Update acceptEncoding on response
      record.response.cacheHeaders.acceptEncoding = !!headers['accept-encoding'];

      emit({ type: 'request:end', data: record });

      return response;
    } catch (error) {
      record.endTime = performance.now();
      record.duration = record.endTime - record.startTime;
      record.error = error instanceof Error ? error.message : String(error);

      emit({ type: 'request:error', data: record });

      throw error; // Re-throw to not affect application behavior
    }
  };
}

// ─── XHR Interceptor ────────────────────────────────────────────

function interceptXHR(): void {
  if (!globalThis.XMLHttpRequest || _originalXHROpen) return;

  _originalXHROpen = XMLHttpRequest.prototype.open;
  _originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function fluxXHROpen(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    // Store metadata on the XHR instance
    (this as any).__flux_method = method;
    (this as any).__flux_url = typeof url === 'string' ? url : url.href;
    (this as any).__flux_headers = {};

    // Also intercept setRequestHeader
    const originalSetHeader = this.setRequestHeader;
    this.setRequestHeader = function(name: string, value: string) {
      (this as any).__flux_headers[name.toLowerCase()] = value;
      return originalSetHeader.call(this, name, value);
    };

    return _originalXHROpen!.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function fluxXHRSend(
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const url = (this as any).__flux_url;
    const method = (this as any).__flux_method || 'GET';
    const headers = (this as any).__flux_headers || {};

    // Check if ignored
    if (_config && shouldIgnore(url, _config.ignore)) {
      return _originalXHRSend!.call(this, body);
    }

    const bodyInit = body as BodyInit | null;
    const record = createRequestRecord(url, method, headers, bodyInit, 'xhr');

    emit({ type: 'request:start', data: record });

    // Listen for completion
    this.addEventListener('load', function onLoad() {
      record.ttfb = record.ttfb || performance.now();
      record.endTime = performance.now();
      record.duration = record.endTime - record.startTime;

      // Extract response data
      const responseHeaders: Record<string, string> = {};
      const rawHeaders = this.getAllResponseHeaders();
      rawHeaders.split('\r\n').forEach(line => {
        const [key, ...rest] = line.split(':');
        if (key && rest.length) {
          responseHeaders[key.trim().toLowerCase()] = rest.join(':').trim();
        }
      });

      const responseText = this.responseType === '' || this.responseType === 'text'
        ? this.responseText
        : '';
      const responseSize = responseText
        ? new Blob([responseText]).size
        : (this.response instanceof ArrayBuffer ? this.response.byteLength : 0);

      let jsonFieldCount: number | null = null;
      const contentType = responseHeaders['content-type'] || '';
      if (contentType.includes('application/json') && responseText) {
        try {
          const parsed = JSON.parse(responseText);
          if (parsed && typeof parsed === 'object') {
            jsonFieldCount = Array.isArray(parsed)
              ? (parsed.length > 0 ? Object.keys(parsed[0]).length : 0)
              : Object.keys(parsed).length;
          }
        } catch { /* ignore */ }
      }

      record.response = {
        status: this.status,
        statusText: this.statusText,
        headers: responseHeaders,
        bodySize: responseSize,
        contentType: contentType || null,
        cacheHeaders: extractCacheHeaders(responseHeaders),
        bodyHash: fastHash(responseText || String(responseSize)),
        jsonFieldCount,
        fromCache: responseHeaders['x-cache'] === 'HIT',
      };

      emit({ type: 'request:end', data: record });
    });

    this.addEventListener('error', function onError() {
      record.endTime = performance.now();
      record.duration = record.endTime - record.startTime;
      record.error = 'Network error';
      emit({ type: 'request:error', data: record });
    });

    this.addEventListener('timeout', function onTimeout() {
      record.endTime = performance.now();
      record.duration = record.endTime - record.startTime;
      record.error = 'Request timeout';
      emit({ type: 'request:error', data: record });
    });

    // Track TTFB
    this.addEventListener('progress', function onProgress() {
      if (!record.ttfb) {
        record.ttfb = performance.now();
      }
    });

    return _originalXHRSend!.call(this, body);
  };
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Start observing all network requests.
 * Monkey-patches fetch() and XMLHttpRequest.
 * Returns a cleanup function to restore originals.
 */
export function startObserving(config: FluxScanConfig): () => void {
  if (_isActive) {
    console.warn('[FluxAPI] Observer already active. Call stop first.');
    return () => {};
  }

  _config = config;
  _isActive = true;

  interceptFetch();
  interceptXHR();

  if (config.verbose) {
    console.log('[FluxAPI] Observer started. Intercepting fetch() and XMLHttpRequest.');
  }

  return stopObserving;
}

/**
 * Stop observing and restore original fetch/XHR.
 */
export function stopObserving(): void {
  if (!_isActive) return;

  // Restore fetch
  if (_originalFetch) {
    globalThis.fetch = _originalFetch;
    _originalFetch = null;
  }

  // Restore XHR
  if (_originalXHROpen) {
    XMLHttpRequest.prototype.open = _originalXHROpen;
    _originalXHROpen = null;
  }
  if (_originalXHRSend) {
    XMLHttpRequest.prototype.send = _originalXHRSend;
    _originalXHRSend = null;
  }

  _isActive = false;

  if (_config?.verbose) {
    console.log('[FluxAPI] Observer stopped. Original fetch/XHR restored.');
  }

  _config = null;
}

/** Check if observer is currently active */
export function isObserving(): boolean {
  return _isActive;
}
