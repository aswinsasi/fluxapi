// ═══════════════════════════════════════════════════════════════════
// FluxAPI Chrome Extension — Content Script
// Runs in page context. Patches fetch/XHR to capture API requests.
// Relays captured data to background service worker.
// ═══════════════════════════════════════════════════════════════════

let isScanning = false;
let reqSeq = 0;

// Listen for start/stop from panel via background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FLUX_INJECT_START') {
    isScanning = true;
    reqSeq = 0;
    injectInterceptors();
    sendResponse({ ok: true });
  } else if (msg.type === 'FLUX_INJECT_STOP') {
    isScanning = false;
    sendResponse({ ok: true });
  }
  return true;
});

function injectInterceptors() {
  // Inject a script into the actual page context to patch fetch/XHR
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // Listen for captured requests from the injected script
  window.addEventListener('__FLUXAPI_REQUEST__', (e) => {
    if (!isScanning) return;
    const detail = (e as CustomEvent).detail;
    if (!detail) return;

    reqSeq++;
    const record = buildRequestRecord(detail, reqSeq);

    chrome.runtime.sendMessage({
      type: 'FLUX_REQUEST_CAPTURED',
      request: record,
    });
  });
}

function buildRequestRecord(raw, seq) {
  const urlParts = parseUrlSimple(raw.url);
  const type = classifyUrl(raw.url, raw.method);

  return {
    id: `ext_${seq}`,
    url: raw.url,
    method: raw.method || 'GET',
    urlParts,
    headers: {},
    bodySize: raw.bodySize || 0,
    bodyHash: null,
    startTime: raw.startTime,
    ttfb: raw.ttfb || raw.startTime + 20,
    endTime: raw.endTime,
    duration: raw.endTime - raw.startTime,
    response: raw.status ? {
      status: raw.status,
      statusText: raw.statusText || '',
      headers: raw.responseHeaders || {},
      bodySize: raw.responseSize || 0,
      contentType: raw.contentType || null,
      cacheHeaders: {
        cacheControl: raw.responseHeaders?.['cache-control'] || null,
        etag: raw.responseHeaders?.['etag'] || null,
        lastModified: raw.responseHeaders?.['last-modified'] || null,
        expires: null,
        age: null,
        acceptEncoding: false,
        contentEncoding: raw.responseHeaders?.['content-encoding'] || null,
      },
      bodyHash: raw.bodyHash || `ext_h_${seq}`,
      jsonFieldCount: null,
      fromCache: false,
    } : null,
    initiator: {
      stackTrace: [],
      componentName: raw.componentName || null,
      componentFile: null,
      rawStack: raw.stack || '',
    },
    navigationContext: {
      currentRoute: location.pathname,
      previousRoute: null,
      timeSinceNavigation: 0,
      pageState: document.readyState,
    },
    type,
    source: raw.source || 'fetch',
    error: raw.error || null,
    sequence: seq,
  };
}

function parseUrlSimple(rawUrl) {
  try {
    const u = new URL(rawUrl, location.origin);
    const segments = u.pathname.split('/').filter(Boolean);
    const pattern = '/' + segments.map(s => {
      if (/^\d+$/.test(s)) return ':id';
      if (/^[0-9a-f]{8}-/.test(s)) return ':uuid';
      if (/^[a-f0-9]{24}$/.test(s)) return ':objectId';
      return s;
    }).join('/');
    return { protocol: u.protocol, host: u.host, pathSegments: segments, pathPattern: pattern, queryParams: {}, pathname: u.pathname };
  } catch {
    return { protocol: '', host: '', pathSegments: [], pathPattern: rawUrl, queryParams: {}, pathname: rawUrl };
  }
}

function classifyUrl(url, method) {
  const lower = url.toLowerCase();
  if (lower.includes('/graphql')) return 'api-graphql';
  if (/\.(js|css|png|jpg|svg|ico|woff2?)(\?|$)/.test(lower)) return 'static';
  if (lower.includes('/api/') || (method && method !== 'GET') || lower.includes('.json')) return 'api-rest';
  return 'other';
}
