// ═══════════════════════════════════════════════════════════════════
// Rule E4: Payload Over-fetching
// Detects API responses where a significant portion of returned data
// is likely unused. Large JSON payloads waste bandwidth and parse time.
//
// Detection: Flag endpoints where response size > threshold AND
// JSON field count is high, suggesting excessive data returned.
//
// Severity: Warning | Weight: 8/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface E4Config {
  /** Minimum response size to analyze (bytes). Default: 10KB */
  minResponseSize: number;
  /** Minimum JSON field count to flag. Default: 20 */
  minFieldCount: number;
  /** Flag if response is this many times larger than median. Default: 3 */
  sizeRatioThreshold: number;
}

const DEFAULT_E4_CONFIG: E4Config = {
  minResponseSize: 10240,
  minFieldCount: 20,
  sizeRatioThreshold: 3,
};

// ─── Over-fetched Endpoint ──────────────────────────────────────

interface OverfetchedEndpoint {
  pattern: string;
  method: string;
  requests: FluxRequestRecord[];
  avgResponseSize: number;
  maxResponseSize: number;
  avgFieldCount: number;
  estimatedWaste: number;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectOverfetching(
  requests: FluxRequestRecord[],
  config: E4Config,
): OverfetchedEndpoint[] {
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    r.method === 'GET' &&
    (r.type === 'api-rest' || r.type === 'api-graphql')
  );

  if (apiRequests.length === 0) return [];

  // Median response size for comparison
  const sizes = apiRequests.map(r => r.response!.bodySize).filter(s => s > 0).sort((a, b) => a - b);
  const medianSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 0;

  // Group by endpoint
  const groups = new Map<string, FluxRequestRecord[]>();
  for (const r of apiRequests) {
    const key = `${r.method}|${r.urlParts.pathPattern}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const results: OverfetchedEndpoint[] = [];

  for (const [key, reqs] of groups) {
    const withResp = reqs.filter(r => r.response && r.response.bodySize > 0);
    if (withResp.length === 0) continue;

    const avgSize = withResp.reduce((s, r) => s + r.response!.bodySize, 0) / withResp.length;
    const maxSize = Math.max(...withResp.map(r => r.response!.bodySize));

    if (avgSize < config.minResponseSize) continue;

    const fieldCounts = withResp
      .filter(r => r.response!.jsonFieldCount !== null)
      .map(r => r.response!.jsonFieldCount!);
    const avgFields = fieldCounts.length > 0
      ? fieldCounts.reduce((s, c) => s + c, 0) / fieldCounts.length : 0;

    const isLargePayload = avgSize >= config.minResponseSize && avgFields >= config.minFieldCount;
    const isOversized = medianSize > 0 && avgSize >= medianSize * config.sizeRatioThreshold;

    if (isLargePayload || isOversized) {
      const estimatedWaste = Math.round(avgSize * 0.6) * withResp.length;
      const [method, pattern] = key.split('|');

      results.push({
        pattern, method, requests: withResp,
        avgResponseSize: Math.round(avgSize), maxResponseSize: maxSize,
        avgFieldCount: Math.round(avgFields), estimatedWaste,
      });
    }
  }

  return results.sort((a, b) => b.estimatedWaste - a.estimatedWaste);
}

// ─── Violation Builder ──────────────────────────────────────────

function endpointToViolation(ep: OverfetchedEndpoint): RuleViolation {
  const components = [...new Set(
    ep.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];

  return {
    ruleId: 'E4',
    title: `Over-fetching: ${ep.method} ${ep.pattern} (${Math.round(ep.avgResponseSize / 1024)}KB, ~${ep.avgFieldCount} fields)`,
    description:
      `"${ep.method} ${ep.pattern}" returns ~${Math.round(ep.avgResponseSize / 1024)}KB with ~${ep.avgFieldCount} JSON fields. ` +
      `Use sparse fieldsets (?fields=id,name), GraphQL, or a BFF layer to return only needed data. ` +
      `Estimated ~${Math.round(ep.estimatedWaste / 1024)}KB wasted across ${ep.requests.length} requests.`,
    severity: 'warning',
    affectedRequests: ep.requests,
    affectedEndpoints: [ep.pattern],
    affectedComponents: components,
    impact: {
      timeSavedMs: Math.round(ep.estimatedWaste / 50),
      requestsEliminated: 0,
      bandwidthSavedBytes: ep.estimatedWaste,
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: ep.pattern, avgResponseSize: ep.avgResponseSize,
      maxResponseSize: ep.maxResponseSize, avgFieldCount: ep.avgFieldCount,
      estimatedWaste: ep.estimatedWaste, requestCount: ep.requests.length,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createE4Rule(config?: Partial<E4Config>): AuditRule {
  const cfg = { ...DEFAULT_E4_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.E4;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();
      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql'
      );

      const overfetched = detectOverfetching(session.requests, cfg);
      const violations = overfetched.map(endpointToViolation);

      const affectedIds = new Set<string>();
      for (const ep of overfetched) {
        for (const r of ep.requests) affectedIds.add(r.id);
      }

      const ratio = apiRequests.length > 0 ? affectedIds.size / apiRequests.length : 0;
      const score = definition.maxWeight * (1 - 0.7 * Math.min(ratio, 1));

      return {
        rule: definition,
        score: Math.max(0, Math.round(score * 10) / 10),
        violations, totalRelevantRequests: apiRequests.length,
        affectedRequestCount: affectedIds.size, passed: violations.length === 0,
        analysisTimeMs: performance.now() - start,
      };
    },
  };
}
