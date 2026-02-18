// ═══════════════════════════════════════════════════════════════════
// FluxAPI Chrome Extension — Background Service Worker
// Manages scan state and relays messages between panel and content script
// ═══════════════════════════════════════════════════════════════════

const scans = new Map(); // tabId -> { active, requests[], startTime }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg.tabId || sender.tab?.id;

  switch (msg.type) {
    case 'FLUX_START_SCAN': {
      scans.set(tabId, {
        active: true,
        requests: [],
        startTime: Date.now(),
        config: msg.config || {},
      });
      sendResponse({ ok: true });
      break;
    }

    case 'FLUX_STOP_SCAN': {
      const scan = scans.get(tabId);
      if (scan) {
        scan.active = false;
        scan.endTime = Date.now();
        sendResponse({ ok: true, requestCount: scan.requests.length });
      } else {
        sendResponse({ ok: false, error: 'No active scan' });
      }
      break;
    }

    case 'FLUX_GET_SESSION': {
      const scan = scans.get(tabId);
      if (scan) {
        sendResponse({ ok: true, session: buildSession(scan, tabId) });
      } else {
        sendResponse({ ok: false, error: 'No scan data' });
      }
      break;
    }

    case 'FLUX_REQUEST_CAPTURED': {
      const scan = scans.get(tabId);
      if (scan && scan.active) {
        scan.requests.push(msg.request);
      }
      break;
    }

    case 'FLUX_CLEAR': {
      scans.delete(tabId);
      sendResponse({ ok: true });
      break;
    }
  }

  return true; // Keep channel open for async
});

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  scans.delete(tabId);
});

function buildSession(scan, tabId) {
  const requests = scan.requests;
  const apiRequests = requests.filter(r =>
    r.type === 'api-rest' || r.type === 'api-graphql'
  );

  return {
    id: `ext_${tabId}_${scan.startTime}`,
    startTime: scan.startTime,
    endTime: scan.endTime || Date.now(),
    requests,
    navigations: [],
    stack: {
      framework: scan.detectedStack?.framework || null,
      dataLibrary: scan.detectedStack?.dataLibrary || null,
      apiType: 'rest',
      backendHints: { poweredBy: null, server: null, detectedFramework: null },
    },
    config: {
      duration: Math.round(((scan.endTime || Date.now()) - scan.startTime) / 1000),
      network: scan.config.network || 'wifi',
      ignore: [],
      captureFields: false,
      maxRequests: 5000,
      minDuration: 0,
      verbose: false,
    },
    metadata: {
      pageUrl: scan.pageUrl || 'unknown',
      userAgent: navigator.userAgent,
      scanDuration: (scan.endTime || Date.now()) - scan.startTime,
      totalRequests: requests.length,
      apiRequests: apiRequests.length,
      uniqueEndpoints: new Set(requests.map(r => r.urlParts?.pathPattern || r.url)).size,
      uniqueHosts: [...new Set(requests.map(r => r.urlParts?.host || ''))],
    },
  };
}
