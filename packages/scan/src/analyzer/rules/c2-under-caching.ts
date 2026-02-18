// ═══════════════════════════════════════════════════════════════════
// Rule C2: Under-Caching
// Detects data that is refreshed far more frequently than it actually
// changes. Measured by comparing response content hashes across
// multiple fetches to the same endpoint.
//
// Example: /api/user/profile fetched 340 times/day but content
// changes only ~1 time/week. 99.7% of fetches are wasted.
//
// Severity: Warning | Weight: 8/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface C2Config {
  /** Min requests to endpoint for analysis. Default: 3 */
  minRequestsPerEndpoint: number;
  /** Threshold: if this % of responses are identical, flag it. Default: 0.8 */
  identicalResponseThreshold: number;
  /** Ignore POST/PUT/DELETE. Default: true */
  ignoreNonIdempotent: boolean;
}

const DEFAULT_C2_CONFIG: C2Config = {
  minRequestsPerEndpoint: 3,
  identicalResponseThreshold: 0.8,
  ignoreNonIdempotent: true,
};

// ─── Under-Cached Endpoint ──────────────────────────────────────

export interface UnderCachedEndpoint {
  /** URL pattern */
  pattern: string;
  /** HTTP method */
  method: string;
  /** All requests to this endpoint */
  requests: FluxRequestRecord[];
  /** How many of the total requests returned identical data */
  identicalCount: number;
  /** Percentage of redundant (identical) fetches */
  redundancyRate: number;
  /** Most common response hash */
  dominantHash: string;
  /** Unique response hashes seen */
  uniqueHashes: number;
  /** Average response size */
  avgResponseSize: number;
  /** Wasted bandwidth from redundant fetches */
  wastedBytes: number;
  /** Recommended staleTime (ms) based on observed change patterns */
  recommendedStaleTimeMs: number;
  /** Current effective cache TTL (0 if none) */
  currentCacheTtlMs: number;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectUnderCaching(
  requests: FluxRequestRecord[],
  config: C2Config,
): UnderCachedEndpoint[] {
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    (r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc')
  );

  const candidates = config.ignoreNonIdempotent
    ? apiRequests.filter(r => r.method === 'GET' || r.method === 'HEAD')
    : apiRequests;

  // Group by endpoint
  const endpointGroups = new Map<string, FluxRequestRecord[]>();
  for (const req of candidates) {
    const key = `${req.method}||${req.urlParts.pathPattern}`;
    const group = endpointGroups.get(key) || [];
    group.push(req);
    endpointGroups.set(key, group);
  }

  const underCached: UnderCachedEndpoint[] = [];

  for (const [key, group] of endpointGroups) {
    if (group.length < config.minRequestsPerEndpoint) continue;

    const [method, pattern] = key.split('||');

    // Analyze response hashes to detect unchanged responses
    const hashCounts = new Map<string, number>();
    for (const req of group) {
      const hash = req.response!.bodyHash;
      hashCounts.set(hash, (hashCounts.get(hash) || 0) + 1);
    }

    // Find dominant hash (most common response)
    let dominantHash = '';
    let dominantCount = 0;
    for (const [hash, count] of hashCounts) {
      if (count > dominantCount) {
        dominantHash = hash;
        dominantCount = count;
      }
    }

    const identicalRate = dominantCount / group.length;

    // If most responses are identical, this endpoint is under-cached
    if (identicalRate >= config.identicalResponseThreshold) {
      const avgResponseSize = group.reduce(
        (s, r) => s + (r.response?.bodySize || 0), 0
      ) / group.length;

      const wastedCount = dominantCount - 1; // First fetch is needed
      const wastedBytes = Math.round(avgResponseSize * wastedCount);

      // Calculate recommended staleTime
      const sorted = [...group].sort((a, b) => a.startTime - b.startTime);
      const timeSpan = (sorted[sorted.length - 1].startTime - sorted[0].startTime);

      // Find when content actually changed (transitions between hashes)
      let changeCount = 0;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].response!.bodyHash !== sorted[i - 1].response!.bodyHash) {
          changeCount++;
        }
      }

      // Estimate change interval
      const changeIntervalMs = changeCount > 0
        ? timeSpan / changeCount
        : timeSpan * 2; // If no changes observed, assume very stable

      // Recommended staleTime: half the observed change interval (safety margin)
      const recommendedStaleTimeMs = Math.min(
        Math.max(changeIntervalMs * 0.5, 30000), // At least 30 seconds
        30 * 60 * 1000, // Cap at 30 minutes
      );

      // Current cache TTL
      const currentCacheTtlMs = parseCacheTtl(group[0]);

      underCached.push({
        pattern,
        method,
        requests: group,
        identicalCount: dominantCount,
        redundancyRate: identicalRate,
        dominantHash,
        uniqueHashes: hashCounts.size,
        avgResponseSize,
        wastedBytes,
        recommendedStaleTimeMs,
        currentCacheTtlMs,
      });
    }
  }

  return underCached.sort((a, b) => b.redundancyRate - a.redundancyRate);
}

/**
 * Parse the effective cache TTL from Cache-Control headers.
 */
function parseCacheTtl(req: FluxRequestRecord): number {
  const cc = req.response?.cacheHeaders.cacheControl;
  if (!cc) return 0;

  const maxAgeMatch = cc.match(/max-age=(\d+)/);
  if (maxAgeMatch) return parseInt(maxAgeMatch[1], 10) * 1000;

  if (cc.includes('no-store') || cc.includes('no-cache')) return 0;

  return 0;
}

// ─── Violation Builder ──────────────────────────────────────────

function endpointToViolation(endpoint: UnderCachedEndpoint): RuleViolation {
  const components = [...new Set(
    endpoint.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];

  const redundancyPct = Math.round(endpoint.redundancyRate * 100);
  const recommendedSecs = Math.round(endpoint.recommendedStaleTimeMs / 1000);

  return {
    ruleId: 'C2',
    title: `Under-cached: ${endpoint.method} ${endpoint.pattern} — ${redundancyPct}% of fetches are redundant`,
    description:
      `"${endpoint.method} ${endpoint.pattern}" was fetched ${endpoint.requests.length} times ` +
      `but returned identical data ${redundancyPct}% of the time. ` +
      (endpoint.currentCacheTtlMs === 0
        ? 'Currently has no client-side cache. '
        : `Current cache TTL: ${Math.round(endpoint.currentCacheTtlMs / 1000)}s. `) +
      `Recommended staleTime: ${recommendedSecs}s ` +
      `(based on observed data change frequency). ` +
      `This would save ~${Math.round(endpoint.wastedBytes / 1024)}KB of bandwidth ` +
      `and ${endpoint.identicalCount - 1} unnecessary requests.`,
    severity: 'warning',
    affectedRequests: endpoint.requests,
    affectedEndpoints: [endpoint.pattern],
    affectedComponents: components,
    impact: {
      timeSavedMs: endpoint.requests.reduce((s, r) => s + (r.duration || 0), 0) *
                   (endpoint.redundancyRate - 0.1), // Account for some needed refreshes
      requestsEliminated: endpoint.identicalCount - 1,
      bandwidthSavedBytes: endpoint.wastedBytes,
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: endpoint.pattern,
      method: endpoint.method,
      requestCount: endpoint.requests.length,
      identicalCount: endpoint.identicalCount,
      redundancyRate: endpoint.redundancyRate,
      uniqueHashes: endpoint.uniqueHashes,
      avgResponseSize: endpoint.avgResponseSize,
      currentCacheTtlMs: endpoint.currentCacheTtlMs,
      recommendedStaleTimeMs: endpoint.recommendedStaleTimeMs,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createC2Rule(config?: Partial<C2Config>): AuditRule {
  const cfg = { ...DEFAULT_C2_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.C2;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const underCached = detectUnderCaching(session.requests, cfg);
      const violations = underCached.map(endpointToViolation);

      const affectedIds = new Set<string>();
      for (const ep of underCached) {
        for (const req of ep.requests) {
          affectedIds.add(req.id);
        }
      }

      const violationRatio = apiRequests.length > 0
        ? affectedIds.size / apiRequests.length
        : 0;
      const severityFactor = 0.7; // warning
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
