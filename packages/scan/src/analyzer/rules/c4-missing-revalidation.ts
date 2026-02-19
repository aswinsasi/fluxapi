// ═══════════════════════════════════════════════════════════════════
// Rule C4: Missing Revalidation Strategy
// Detects endpoints where full responses are re-downloaded when a
// conditional request (If-None-Match with ETag, or If-Modified-Since)
// would return a smaller 304 Not Modified.
//
// Severity: Info | Weight: 3/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface C4Config {
  /** Min requests to endpoint for analysis. Default: 2 */
  minRequestsPerEndpoint: number;
  /** Min response size to flag (bytes). Small responses don't benefit much. Default: 2048 */
  minResponseSize: number;
}

const DEFAULT_C4_CONFIG: C4Config = {
  minRequestsPerEndpoint: 2,
  minResponseSize: 2048,
};

// ─── Detection Logic ────────────────────────────────────────────

interface MissingRevalidation {
  pattern: string;
  method: string;
  requests: FluxRequestRecord[];
  avgResponseSize: number;
  hasEtag: boolean;
  hasLastModified: boolean;
  identicalResponses: number;
  wastedBytes: number;
}

function detectMissingRevalidation(
  requests: FluxRequestRecord[],
  config: C4Config,
): MissingRevalidation[] {
  const candidates = requests.filter(r =>
    r.response !== null &&
    r.method === 'GET' &&
    (r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc') &&
    r.response.bodySize >= config.minResponseSize
  );

  const groups = new Map<string, FluxRequestRecord[]>();
  for (const req of candidates) {
    const key = `${req.method}||${req.urlParts.pathPattern}`;
    const group = groups.get(key) || [];
    group.push(req);
    groups.set(key, group);
  }

  const results: MissingRevalidation[] = [];

  for (const [key, group] of groups) {
    if (group.length < config.minRequestsPerEndpoint) continue;
    const [method, pattern] = key.split('||');

    const hasEtag = group.some(r => !!r.response!.cacheHeaders.etag);
    const hasLastModified = group.some(r => !!r.response!.cacheHeaders.lastModified);

    // If server already sends ETag/Last-Modified, revalidation is possible
    if (hasEtag || hasLastModified) continue;

    // Count identical responses (could have been 304s)
    const hashCounts = new Map<string, number>();
    for (const req of group) {
      const hash = req.response!.bodyHash;
      hashCounts.set(hash, (hashCounts.get(hash) || 0) + 1);
    }

    let identicalCount = 0;
    for (const count of hashCounts.values()) {
      if (count > 1) identicalCount += count - 1; // All but first are wasted
    }

    if (identicalCount === 0) continue;

    const avgSize = group.reduce((s, r) => s + (r.response?.bodySize || 0), 0) / group.length;
    const wastedBytes = Math.round(avgSize * identicalCount);

    results.push({
      pattern,
      method,
      requests: group,
      avgResponseSize: Math.round(avgSize),
      hasEtag,
      hasLastModified,
      identicalResponses: identicalCount,
      wastedBytes,
    });
  }

  return results.sort((a, b) => b.wastedBytes - a.wastedBytes);
}

// ─── Violation Builder ──────────────────────────────────────────

function toViolation(ep: MissingRevalidation): RuleViolation {
  const components = [...new Set(
    ep.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];

  const sizeKB = Math.round(ep.avgResponseSize / 1024);
  const wastedKB = Math.round(ep.wastedBytes / 1024);

  return {
    ruleId: 'C4',
    title: `No revalidation: ${ep.method} ${ep.pattern} — ${ep.identicalResponses} full re-downloads`,
    description:
      `"${ep.method} ${ep.pattern}" (~${sizeKB}KB) has no ETag or Last-Modified header. ` +
      `${ep.identicalResponses} of ${ep.requests.length} responses were identical and could have been ` +
      `304 Not Modified (~0 bytes) instead of full ${sizeKB}KB downloads. ` +
      `Adds ~${wastedKB}KB wasted bandwidth. ` +
      `Add ETag support to your API endpoint.`,
    severity: 'info',
    affectedRequests: ep.requests,
    affectedEndpoints: [ep.pattern],
    affectedComponents: components,
    impact: {
      timeSavedMs: Math.round(ep.identicalResponses * 50), // ~50ms per avoided download
      requestsEliminated: 0, // Still makes request, just smaller
      bandwidthSavedBytes: ep.wastedBytes,
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: ep.pattern,
      method: ep.method,
      avgResponseSize: ep.avgResponseSize,
      identicalResponses: ep.identicalResponses,
      requestCount: ep.requests.length,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createC4Rule(config?: Partial<C4Config>): AuditRule {
  const cfg = { ...DEFAULT_C4_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.C4;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const missing = detectMissingRevalidation(session.requests, cfg);
      const violations = missing.map(toViolation);

      const affectedIds = new Set<string>();
      for (const ep of missing) {
        for (const req of ep.requests) affectedIds.add(req.id);
      }

      const violationRatio = apiRequests.length > 0 ? affectedIds.size / apiRequests.length : 0;
      const severityFactor = 0.4; // info
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
