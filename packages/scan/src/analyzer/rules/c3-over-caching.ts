// ═══════════════════════════════════════════════════════════════════
// Rule C3: Over-Caching
// Detects data with cache TTLs longer than the actual change frequency.
// Risky because users may see outdated information. Identified when
// content changes are observed within a cache window.
//
// Severity: Warning | Weight: 5/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface C3Config {
  /** Minimum requests to endpoint to analyze. Default: 3 */
  minRequestsPerEndpoint: number;
  /** Flag when cache TTL exceeds change interval by this factor. Default: 3 */
  overCacheFactor: number;
}

const DEFAULT_C3_CONFIG: C3Config = {
  minRequestsPerEndpoint: 3,
  overCacheFactor: 3,
};

// ─── Over-Cached Endpoint ───────────────────────────────────────

interface OverCachedEndpoint {
  pattern: string;
  method: string;
  requests: FluxRequestRecord[];
  cacheTtlMs: number;
  observedChangeIntervalMs: number;
  changeCount: number;
  staleDataRisk: number; // 0-1 probability user sees stale data
}

// ─── Detection Logic ────────────────────────────────────────────

function detectOverCaching(
  requests: FluxRequestRecord[],
  config: C3Config,
): OverCachedEndpoint[] {
  const candidates = requests.filter(r =>
    r.response !== null &&
    r.method === 'GET' &&
    (r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc')
  );

  const groups = new Map<string, FluxRequestRecord[]>();
  for (const req of candidates) {
    const key = `${req.method}||${req.urlParts.pathPattern}`;
    const group = groups.get(key) || [];
    group.push(req);
    groups.set(key, group);
  }

  const results: OverCachedEndpoint[] = [];

  for (const [key, group] of groups) {
    if (group.length < config.minRequestsPerEndpoint) continue;
    const [method, pattern] = key.split('||');

    // Parse cache TTL
    const cacheTtlMs = parseCacheTtl(group[0]);
    if (cacheTtlMs === 0) continue; // No cache = not over-cached (that's C1's job)

    // Count content changes
    const sorted = [...group].sort((a, b) => a.startTime - b.startTime);
    let changeCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].response!.bodyHash !== sorted[i - 1].response!.bodyHash) {
        changeCount++;
      }
    }

    if (changeCount === 0) continue; // Data is stable, cache is fine

    const timeSpan = sorted[sorted.length - 1].startTime - sorted[0].startTime;
    if (timeSpan === 0) continue;

    const changeIntervalMs = timeSpan / changeCount;

    // Over-cached if cache TTL is much longer than change interval
    if (cacheTtlMs > changeIntervalMs * config.overCacheFactor) {
      const staleDataRisk = Math.min(1, cacheTtlMs / changeIntervalMs / 10);

      results.push({
        pattern,
        method,
        requests: group,
        cacheTtlMs,
        observedChangeIntervalMs: Math.round(changeIntervalMs),
        changeCount,
        staleDataRisk,
      });
    }
  }

  return results.sort((a, b) => b.staleDataRisk - a.staleDataRisk);
}

function parseCacheTtl(req: FluxRequestRecord): number {
  const cc = req.response?.cacheHeaders.cacheControl;
  if (!cc) return 0;
  const m = cc.match(/max-age=(\d+)/);
  if (m) return parseInt(m[1], 10) * 1000;
  if (cc.includes('no-store') || cc.includes('no-cache')) return 0;
  return 0;
}

// ─── Violation Builder ──────────────────────────────────────────

function toViolation(ep: OverCachedEndpoint): RuleViolation {
  const components = [...new Set(
    ep.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];

  const cacheSecs = Math.round(ep.cacheTtlMs / 1000);
  const changeSecs = Math.round(ep.observedChangeIntervalMs / 1000);
  const riskPct = Math.round(ep.staleDataRisk * 100);
  const recommendedTtl = Math.max(Math.round(ep.observedChangeIntervalMs * 0.5 / 1000), 5);

  return {
    ruleId: 'C3',
    title: `Over-cached: ${ep.method} ${ep.pattern} — cache ${cacheSecs}s but data changes every ${changeSecs}s`,
    description:
      `"${ep.method} ${ep.pattern}" has a cache TTL of ${cacheSecs}s, but the data was observed ` +
      `changing every ~${changeSecs}s (${ep.changeCount} changes during scan). ` +
      `Users have a ~${riskPct}% chance of seeing stale data. ` +
      `Recommended: reduce max-age to ${recommendedTtl}s or use stale-while-revalidate.`,
    severity: 'warning',
    affectedRequests: ep.requests,
    affectedEndpoints: [ep.pattern],
    affectedComponents: components,
    impact: {
      timeSavedMs: 0, // Over-caching is a correctness issue, not speed
      requestsEliminated: 0,
      bandwidthSavedBytes: 0,
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: ep.pattern,
      method: ep.method,
      cacheTtlMs: ep.cacheTtlMs,
      observedChangeIntervalMs: ep.observedChangeIntervalMs,
      changeCount: ep.changeCount,
      staleDataRisk: ep.staleDataRisk,
      recommendedTtlMs: recommendedTtl * 1000,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createC3Rule(config?: Partial<C3Config>): AuditRule {
  const cfg = { ...DEFAULT_C3_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.C3;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const overCached = detectOverCaching(session.requests, cfg);
      const violations = overCached.map(toViolation);

      const affectedIds = new Set<string>();
      for (const ep of overCached) {
        for (const req of ep.requests) affectedIds.add(req.id);
      }

      const violationRatio = apiRequests.length > 0 ? affectedIds.size / apiRequests.length : 0;
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
