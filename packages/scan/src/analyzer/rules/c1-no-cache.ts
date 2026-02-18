// ═══════════════════════════════════════════════════════════════════
// Rule C1: No Cache Strategy
// Detects endpoints that have no caching configuration at all:
// - No Cache-Control headers
// - No ETag / Last-Modified
// - No client-side cache (staleTime = 0 or not set)
//
// These endpoints hit the network on every single request.
//
// Severity: Critical | Weight: 12/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface C1Config {
  /** Minimum number of requests to an endpoint to analyze. Default: 2 */
  minRequestsPerEndpoint: number;
  /** Ignore POST/PUT/DELETE (mutations are typically not cached). Default: true */
  ignoreNonIdempotent: boolean;
}

const DEFAULT_C1_CONFIG: C1Config = {
  minRequestsPerEndpoint: 2,
  ignoreNonIdempotent: true,
};

// ─── Uncached Endpoint ──────────────────────────────────────────

export interface UncachedEndpoint {
  /** URL pattern */
  pattern: string;
  /** HTTP method */
  method: string;
  /** All requests to this endpoint */
  requests: FluxRequestRecord[];
  /** Times this endpoint was called */
  requestCount: number;
  /** Average response size */
  avgResponseSize: number;
  /** Average response time */
  avgResponseTime: number;
  /** Why it's uncached */
  reasons: string[];
  /** Total bandwidth wasted by refetching */
  wastedBytes: number;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectUncached(
  requests: FluxRequestRecord[],
  config: C1Config,
): UncachedEndpoint[] {
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    (r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc')
  );

  // Filter out non-idempotent if configured
  const candidates = config.ignoreNonIdempotent
    ? apiRequests.filter(r => r.method === 'GET' || r.method === 'HEAD')
    : apiRequests;

  // Group by endpoint pattern + method
  const endpointGroups = new Map<string, FluxRequestRecord[]>();
  for (const req of candidates) {
    const key = `${req.method}||${req.urlParts.pathPattern}`;
    const group = endpointGroups.get(key) || [];
    group.push(req);
    endpointGroups.set(key, group);
  }

  const uncached: UncachedEndpoint[] = [];

  for (const [key, group] of endpointGroups) {
    if (group.length < config.minRequestsPerEndpoint) continue;

    const [method, pattern] = key.split('||');

    // Check cache status of responses
    const reasons: string[] = [];
    let hasAnyCaching = false;

    for (const req of group) {
      const ch = req.response!.cacheHeaders;

      // Check server-side cache headers
      if (ch.cacheControl) {
        // Has Cache-Control, but check if it's actually useful
        if (ch.cacheControl.includes('no-store') || ch.cacheControl.includes('no-cache')) {
          // Explicit no-cache is intentional, but still worth noting
          reasons.push('Cache-Control: no-store/no-cache');
        } else if (ch.cacheControl.includes('max-age=0')) {
          reasons.push('Cache-Control: max-age=0');
        } else {
          hasAnyCaching = true;
        }
      }

      if (ch.etag || ch.lastModified) {
        hasAnyCaching = true; // Has conditional request support
      }

      if (req.response!.fromCache) {
        hasAnyCaching = true; // Actually served from cache
      }
    }

    // If no request in the group has any caching, this is a violation
    if (!hasAnyCaching) {
      // Determine specific reasons
      const hasNoCacheControl = group.every(r => !r.response!.cacheHeaders.cacheControl);
      const hasNoEtag = group.every(r => !r.response!.cacheHeaders.etag);
      const hasNoLastModified = group.every(r => !r.response!.cacheHeaders.lastModified);

      if (hasNoCacheControl) reasons.push('No Cache-Control header');
      if (hasNoEtag) reasons.push('No ETag header');
      if (hasNoLastModified) reasons.push('No Last-Modified header');
      if (reasons.length === 0) reasons.push('No caching mechanism detected');

      const avgResponseSize = group.reduce((s, r) => s + (r.response?.bodySize || 0), 0) / group.length;
      const avgResponseTime = group.reduce((s, r) => s + (r.duration || 0), 0) / group.length;
      const wastedBytes = Math.round(avgResponseSize * (group.length - 1)); // First request is needed

      uncached.push({
        pattern,
        method,
        requests: group,
        requestCount: group.length,
        avgResponseSize,
        avgResponseTime,
        reasons,
        wastedBytes,
      });
    }
  }

  return uncached.sort((a, b) => b.requestCount - a.requestCount);
}

// ─── Violation Builder ──────────────────────────────────────────

function endpointToViolation(endpoint: UncachedEndpoint): RuleViolation {
  const components = [...new Set(
    endpoint.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];

  return {
    ruleId: 'C1',
    title: `No cache: ${endpoint.method} ${endpoint.pattern} (called ${endpoint.requestCount}x)`,
    description:
      `"${endpoint.method} ${endpoint.pattern}" was called ${endpoint.requestCount} times ` +
      `with no caching strategy. Issues: ${endpoint.reasons.join('; ')}. ` +
      `Average response: ${Math.round(endpoint.avgResponseSize / 1024)}KB in ` +
      `${Math.round(endpoint.avgResponseTime)}ms. ` +
      `${endpoint.requestCount - 1} requests could have been served from cache, ` +
      `saving ~${Math.round(endpoint.wastedBytes / 1024)}KB of bandwidth.`,
    severity: 'critical',
    affectedRequests: endpoint.requests,
    affectedEndpoints: [endpoint.pattern],
    affectedComponents: components,
    impact: {
      timeSavedMs: endpoint.avgResponseTime * (endpoint.requestCount - 1),
      requestsEliminated: endpoint.requestCount - 1,
      bandwidthSavedBytes: endpoint.wastedBytes,
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: endpoint.pattern,
      method: endpoint.method,
      requestCount: endpoint.requestCount,
      avgResponseSize: endpoint.avgResponseSize,
      avgResponseTime: endpoint.avgResponseTime,
      reasons: endpoint.reasons,
      wastedBytes: endpoint.wastedBytes,
      sampleCacheHeaders: endpoint.requests[0].response?.cacheHeaders,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createC1Rule(config?: Partial<C1Config>): AuditRule {
  const cfg = { ...DEFAULT_C1_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.C1;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const uncached = detectUncached(session.requests, cfg);
      const violations = uncached.map(endpointToViolation);

      const affectedIds = new Set<string>();
      for (const ep of uncached) {
        for (const req of ep.requests) {
          affectedIds.add(req.id);
        }
      }

      const violationRatio = apiRequests.length > 0
        ? affectedIds.size / apiRequests.length
        : 0;
      const severityFactor = 1.0;
      const score = definition.maxWeight * (1 - severityFactor * Math.min(violationRatio, 1));

      return {
        rule: definition,
        score: Math.max(0, Math.round(score * 10) / 10),
        violations,
        totalRelevantRequests: apiRequests.length,
        affectedRequestCount: affectedIds.size,
        passed: violations.length === 0,
        analysisTimeMs: performance.now() - start,
      };
    },
  };
}
