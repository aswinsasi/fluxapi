// ═══════════════════════════════════════════════════════════════════
// Test Helpers - Mock Builders
// Creates realistic mock data for testing analyzer rules
// ═══════════════════════════════════════════════════════════════════

import type {
  FluxRequestRecord,
  FluxResponseRecord,
  FluxScanSession,
  FluxScanConfig,
  CacheHeaders,
  RequestInitiator,
  NavigationContext,
  NavigationEvent,
  DetectedStack,
  SessionMetadata,
  RequestType,
} from '../types';
import { DEFAULT_CONFIG } from '../types';
import { parseUrl } from '../utils';

let _mockSeq = 0;

export function resetMockSeq() { _mockSeq = 0; }

// ─── Request Builder ────────────────────────────────────────────

interface MockRequestOpts {
  url: string;
  method?: string;
  startTime?: number;
  duration?: number;
  responseSize?: number;
  responseHash?: string;
  status?: number;
  cacheControl?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  contentEncoding?: string | null;
  componentName?: string | null;
  componentFile?: string | null;
  route?: string;
  type?: RequestType;
  error?: string | null;
  jsonFieldCount?: number | null;
}

export function mockRequest(opts: MockRequestOpts): FluxRequestRecord {
  _mockSeq++;
  const method = opts.method || 'GET';
  const startTime = opts.startTime ?? _mockSeq * 100;
  const duration = opts.duration ?? 150;
  const endTime = startTime + duration;

  const urlParts = parseUrl(opts.url);
  const responseSize = opts.responseSize ?? 2048;

  const cacheHeaders: CacheHeaders = {
    cacheControl: opts.cacheControl ?? null,
    etag: opts.etag ?? null,
    lastModified: opts.lastModified ?? null,
    expires: null,
    age: null,
    acceptEncoding: false,
    contentEncoding: opts.contentEncoding ?? null,
  };

  const response: FluxResponseRecord | null = opts.error ? null : {
    status: opts.status ?? 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/json',
      ...(opts.cacheControl ? { 'cache-control': opts.cacheControl } : {}),
      ...(opts.etag ? { 'etag': opts.etag } : {}),
      ...(opts.contentEncoding ? { 'content-encoding': opts.contentEncoding } : {}),
    },
    bodySize: responseSize,
    contentType: 'application/json',
    cacheHeaders,
    bodyHash: opts.responseHash ?? `hash_${_mockSeq}`,
    jsonFieldCount: opts.jsonFieldCount ?? 10,
    fromCache: false,
  };

  const initiator: RequestInitiator = {
    stackTrace: [],
    componentName: opts.componentName ?? null,
    componentFile: opts.componentFile ?? null,
    rawStack: '',
  };

  const navigationContext: NavigationContext = {
    currentRoute: opts.route ?? '/dashboard',
    previousRoute: null,
    timeSinceNavigation: 500,
    pageState: 'complete',
  };

  // Auto-detect type from URL if not specified
  let type: RequestType = opts.type ?? 'api-rest';
  if (!opts.type) {
    if (opts.url.includes('/graphql')) type = 'api-graphql';
    else if (opts.url.endsWith('.js') || opts.url.endsWith('.css')) type = 'static';
  }

  return {
    id: `req_${_mockSeq}`,
    url: opts.url,
    method,
    urlParts,
    headers: { 'content-type': 'application/json' },
    bodySize: 0,
    bodyHash: null,
    startTime,
    ttfb: startTime + 30,
    endTime,
    duration,
    response,
    initiator,
    navigationContext,
    type,
    source: 'fetch',
    error: opts.error ?? null,
    sequence: _mockSeq,
  };
}

// ─── Session Builder ────────────────────────────────────────────

export function mockSession(requests: FluxRequestRecord[]): FluxScanSession {
  const apiRequests = requests.filter(r =>
    r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
  );

  const metadata: SessionMetadata = {
    pageUrl: 'https://myapp.com/dashboard',
    userAgent: 'FluxAPI-Test',
    scanDuration: 60000,
    totalRequests: requests.length,
    apiRequests: apiRequests.length,
    uniqueEndpoints: new Set(requests.map(r => r.urlParts.pathPattern)).size,
    uniqueHosts: [...new Set(requests.map(r => r.urlParts.host))],
  };

  const stack: DetectedStack = {
    framework: { name: 'react', version: '18.2.0', metaFramework: null },
    dataLibrary: { name: 'tanstack-query', version: '5.0.0' },
    apiType: 'rest',
    backendHints: { poweredBy: 'Express', server: null, detectedFramework: 'express' },
  };

  return {
    id: 'session_test',
    startTime: 0,
    endTime: 60000,
    requests,
    navigations: [],
    websockets: { connections: [], totalMessages: 0, messagesPerSecond: 0 },
    stack,
    config: { ...DEFAULT_CONFIG },
    metadata,
  };
}

// ─── Scenario Builders ──────────────────────────────────────────

/**
 * Build a waterfall scenario: N sequential requests on the same route.
 */
export function waterfallScenario(count: number, opts?: {
  baseDuration?: number;
  route?: string;
  gap?: number;
}): FluxRequestRecord[] {
  resetMockSeq();
  const baseDuration = opts?.baseDuration ?? 200;
  const route = opts?.route ?? '/dashboard';
  const gap = opts?.gap ?? 10; // small gap between requests (sequential)
  const requests: FluxRequestRecord[] = [];

  let time = 100;
  for (let i = 0; i < count; i++) {
    requests.push(mockRequest({
      url: `https://api.example.com/api/endpoint-${i}`,
      startTime: time,
      duration: baseDuration,
      route,
      componentName: 'Dashboard',
    }));
    time += baseDuration + gap; // Next starts after previous ends
  }

  return requests;
}

/**
 * Build a duplicate scenario: same endpoint called N times in quick succession.
 */
export function duplicateScenario(count: number, opts?: {
  endpoint?: string;
  components?: string[];
  route?: string;
}): FluxRequestRecord[] {
  resetMockSeq();
  const endpoint = opts?.endpoint ?? 'https://api.example.com/api/users/123';
  const components = opts?.components ?? ['Header', 'Sidebar', 'Profile', 'Avatar'];
  const route = opts?.route ?? '/dashboard';
  const requests: FluxRequestRecord[] = [];

  const baseTime = 100;
  for (let i = 0; i < count; i++) {
    requests.push(mockRequest({
      url: endpoint,
      startTime: baseTime + i * 50, // 50ms apart (within 2s window)
      duration: 150,
      route,
      componentName: components[i % components.length],
      responseHash: 'same_hash_abc', // Same response data
    }));
  }

  return requests;
}

/**
 * Build an N+1 scenario: list page fires individual requests per item.
 */
export function nPlus1Scenario(itemCount: number, opts?: {
  baseUrl?: string;
  route?: string;
  component?: string;
}): FluxRequestRecord[] {
  resetMockSeq();
  const baseUrl = opts?.baseUrl ?? 'https://api.example.com/api/products';
  const route = opts?.route ?? '/products';
  const component = opts?.component ?? 'ProductList';
  const requests: FluxRequestRecord[] = [];

  const baseTime = 100;
  for (let i = 1; i <= itemCount; i++) {
    requests.push(mockRequest({
      url: `${baseUrl}/${i}`,
      startTime: baseTime + i * 20,
      duration: 90,
      route,
      componentName: component,
    }));
  }

  return requests;
}

/**
 * Build an uncached scenario: endpoints with no cache headers, called multiple times.
 */
export function uncachedScenario(endpoints: number, requestsPer: number): FluxRequestRecord[] {
  resetMockSeq();
  const requests: FluxRequestRecord[] = [];

  for (let e = 0; e < endpoints; e++) {
    for (let r = 0; r < requestsPer; r++) {
      requests.push(mockRequest({
        url: `https://api.example.com/api/resource-${e}`,
        startTime: 100 + e * 1000 + r * 200,
        duration: 120,
        // No cache headers at all
        cacheControl: null,
        etag: null,
        lastModified: null,
        responseHash: `hash_e${e}_r${r}`, // Different each time
      }));
    }
  }

  return requests;
}

/**
 * Build an under-caching scenario: endpoint returns identical data every time.
 */
export function underCachingScenario(requestCount: number, opts?: {
  endpoint?: string;
  identicalRate?: number;
}): FluxRequestRecord[] {
  resetMockSeq();
  const endpoint = opts?.endpoint ?? 'https://api.example.com/api/user/profile';
  const identicalRate = opts?.identicalRate ?? 0.95;
  const requests: FluxRequestRecord[] = [];

  const identicalCount = Math.floor(requestCount * identicalRate);

  for (let i = 0; i < requestCount; i++) {
    const isIdentical = i < identicalCount;
    requests.push(mockRequest({
      url: endpoint,
      startTime: 100 + i * 300,
      duration: 100,
      responseHash: isIdentical ? 'stable_hash_xyz' : `changed_hash_${i}`,
      responseSize: 4096,
    }));
  }

  return requests;
}

/**
 * Build a clean scenario with no violations.
 */
export function cleanScenario(): FluxRequestRecord[] {
  resetMockSeq();
  return [
    // Parallel requests (no waterfall)
    mockRequest({
      url: 'https://api.example.com/api/users/me',
      startTime: 100,
      duration: 200,
      cacheControl: 'max-age=300',
      etag: '"abc123"',
      componentName: 'Dashboard',
    }),
    mockRequest({
      url: 'https://api.example.com/api/notifications',
      startTime: 110, // Starts almost immediately (parallel)
      duration: 180,
      cacheControl: 'max-age=60',
      etag: '"def456"',
      componentName: 'NotificationBell',
    }),
    mockRequest({
      url: 'https://api.example.com/api/dashboard/stats',
      startTime: 105,
      duration: 250,
      cacheControl: 'max-age=120',
      componentName: 'StatsWidget',
    }),
  ];
}
