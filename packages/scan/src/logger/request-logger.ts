// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Request Logger
// Central data store that collects, indexes, and provides query
// access to all intercepted request records.
// ═══════════════════════════════════════════════════════════════════

import type {
  FluxRequestRecord,
  FluxScanConfig,
  FluxEvent,
  SessionMetadata,
} from '../types';
import { requestSignature, shouldIgnore } from '../utils';

// ─── Logger State ───────────────────────────────────────────────

/** All recorded requests */
let _requests: FluxRequestRecord[] = [];

/** Index: URL pattern → request IDs (for duplicate detection) */
let _urlPatternIndex: Map<string, string[]> = new Map();

/** Index: request signature → request IDs (for exact dedup) */
let _signatureIndex: Map<string, string[]> = new Map();

/** Index: component name → request IDs */
let _componentIndex: Map<string, string[]> = new Map();

/** Index: host → request IDs */
let _hostIndex: Map<string, string[]> = new Map();

/** Index: route → request IDs (requests made on that route) */
let _routeIndex: Map<string, string[]> = new Map();

let _config: FluxScanConfig | null = null;

// ─── Indexing ───────────────────────────────────────────────────

function addToIndex(index: Map<string, string[]>, key: string, id: string): void {
  const existing = index.get(key);
  if (existing) {
    existing.push(id);
  } else {
    index.set(key, [id]);
  }
}

function indexRequest(record: FluxRequestRecord): void {
  // URL pattern index (e.g., /api/users/:id)
  addToIndex(_urlPatternIndex, record.urlParts.pathPattern, record.id);

  // Signature index (exact URL + method + body hash)
  const sig = requestSignature(record.url, record.method, null);
  addToIndex(_signatureIndex, sig, record.id);

  // Component index
  if (record.initiator.componentName) {
    addToIndex(_componentIndex, record.initiator.componentName, record.id);
  }

  // Host index
  addToIndex(_hostIndex, record.urlParts.host, record.id);

  // Route index
  addToIndex(_routeIndex, record.navigationContext.currentRoute, record.id);
}

// ─── Event Handler ──────────────────────────────────────────────

/**
 * Handle events from the observer. This is the bridge between
 * the interceptor and the logger.
 */
export function handleEvent(event: FluxEvent): void {
  switch (event.type) {
    case 'request:start': {
      const record = event.data;
      
      // Check max requests limit
      if (_config && _requests.length >= _config.maxRequests) {
        return; // Silently drop to prevent memory issues
      }

      // Check minimum duration filter (only on start, will update on end)
      _requests.push(record);
      indexRequest(record);
      break;
    }

    case 'request:end':
    case 'request:error': {
      // Update existing record in place (it's the same object reference)
      // No additional indexing needed since we indexed on start
      break;
    }
  }
}

// ─── Query API ──────────────────────────────────────────────────

/**
 * Get all recorded requests.
 */
export function getAllRequests(): FluxRequestRecord[] {
  return _requests;
}

/**
 * Get only API requests (excluding static assets, documents, etc.)
 */
export function getApiRequests(): FluxRequestRecord[] {
  return _requests.filter(r =>
    r.type === 'api-rest' ||
    r.type === 'api-graphql' ||
    r.type === 'api-grpc'
  );
}

/**
 * Get completed requests only (have a response).
 */
export function getCompletedRequests(): FluxRequestRecord[] {
  return _requests.filter(r => r.response !== null);
}

/**
 * Get requests matching a URL pattern.
 */
export function getByUrlPattern(pattern: string): FluxRequestRecord[] {
  const ids = _urlPatternIndex.get(pattern) || [];
  return ids.map(id => _requests.find(r => r.id === id)!).filter(Boolean);
}

/**
 * Get requests with the same signature (potential duplicates).
 */
export function getDuplicateGroups(): Map<string, FluxRequestRecord[]> {
  const groups = new Map<string, FluxRequestRecord[]>();

  _signatureIndex.forEach((ids, sig) => {
    if (ids.length > 1) {
      const requests = ids.map(id => _requests.find(r => r.id === id)!).filter(Boolean);
      groups.set(sig, requests);
    }
  });

  return groups;
}

/**
 * Get requests from a specific component.
 */
export function getByComponent(componentName: string): FluxRequestRecord[] {
  const ids = _componentIndex.get(componentName) || [];
  return ids.map(id => _requests.find(r => r.id === id)!).filter(Boolean);
}

/**
 * Get requests to a specific host.
 */
export function getByHost(host: string): FluxRequestRecord[] {
  const ids = _hostIndex.get(host) || [];
  return ids.map(id => _requests.find(r => r.id === id)!).filter(Boolean);
}

/**
 * Get requests made on a specific route.
 */
export function getByRoute(route: string): FluxRequestRecord[] {
  const ids = _routeIndex.get(route) || [];
  return ids.map(id => _requests.find(r => r.id === id)!).filter(Boolean);
}

/**
 * Get all unique URL patterns.
 */
export function getUniquePatterns(): string[] {
  return Array.from(_urlPatternIndex.keys());
}

/**
 * Get all unique hosts.
 */
export function getUniqueHosts(): string[] {
  return Array.from(_hostIndex.keys());
}

/**
 * Get all detected component names.
 */
export function getDetectedComponents(): string[] {
  return Array.from(_componentIndex.keys());
}

/**
 * Get requests in time order within a specific time window.
 */
export function getRequestsInWindow(
  startTime: number,
  endTime: number,
): FluxRequestRecord[] {
  return _requests.filter(r =>
    r.startTime >= startTime && r.startTime <= endTime
  );
}

/**
 * Get request timeline for waterfall analysis.
 * Returns requests sorted by start time with overlap information.
 */
export function getTimeline(): Array<{
  request: FluxRequestRecord;
  overlaps: string[];
}> {
  const sorted = [...getApiRequests()]
    .filter(r => r.endTime !== null)
    .sort((a, b) => a.startTime - b.startTime);

  return sorted.map(req => {
    const overlaps = sorted
      .filter(other =>
        other.id !== req.id &&
        other.startTime < (req.endTime || Infinity) &&
        (other.endTime || Infinity) > req.startTime
      )
      .map(o => o.id);

    return { request: req, overlaps };
  });
}

/**
 * Generate session metadata summary.
 */
export function getSessionMetadata(
  pageUrl: string,
  scanDuration: number,
): SessionMetadata {
  const apiRequests = getApiRequests();
  
  return {
    pageUrl,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    scanDuration,
    totalRequests: _requests.length,
    apiRequests: apiRequests.length,
    uniqueEndpoints: _urlPatternIndex.size,
    uniqueHosts: getUniqueHosts(),
  };
}

/**
 * Get aggregate statistics.
 */
export function getStats(): {
  totalRequests: number;
  apiRequests: number;
  failedRequests: number;
  avgDuration: number;
  totalBytesReceived: number;
  totalBytesSent: number;
  uniqueEndpoints: number;
  uniqueHosts: number;
  requestsByType: Record<string, number>;
  requestsByMethod: Record<string, number>;
} {
  const api = getApiRequests();
  const completed = getCompletedRequests();

  const durations = completed
    .filter(r => r.duration !== null)
    .map(r => r.duration!);

  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  const totalBytesReceived = completed
    .filter(r => r.response)
    .reduce((sum, r) => sum + (r.response?.bodySize || 0), 0);

  const totalBytesSent = _requests
    .reduce((sum, r) => sum + r.bodySize, 0);

  const requestsByType: Record<string, number> = {};
  const requestsByMethod: Record<string, number> = {};

  _requests.forEach(r => {
    requestsByType[r.type] = (requestsByType[r.type] || 0) + 1;
    requestsByMethod[r.method] = (requestsByMethod[r.method] || 0) + 1;
  });

  return {
    totalRequests: _requests.length,
    apiRequests: api.length,
    failedRequests: _requests.filter(r => r.error).length,
    avgDuration,
    totalBytesReceived,
    totalBytesSent,
    uniqueEndpoints: _urlPatternIndex.size,
    uniqueHosts: _hostIndex.size,
    requestsByType,
    requestsByMethod,
  };
}

// ─── Lifecycle ──────────────────────────────────────────────────

/**
 * Initialize the logger with config.
 */
export function initLogger(config: FluxScanConfig): void {
  _config = config;
  resetLogger();
}

/**
 * Reset all logged data and indexes.
 */
export function resetLogger(): void {
  _requests = [];
  _urlPatternIndex = new Map();
  _signatureIndex = new Map();
  _componentIndex = new Map();
  _hostIndex = new Map();
  _routeIndex = new Map();
}
