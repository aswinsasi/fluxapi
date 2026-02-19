// ═══════════════════════════════════════════════════════════════════
// Rule E5: Batchable Requests
// Detects multiple requests to the same service/domain within a short
// window that could be combined into a single batch request.
// Different from E2 (same endpoint) and E3 (parameterized endpoint).
// E5 catches: GET /users, GET /orders, GET /settings → batch them.
//
// Severity: Warning | Weight: 5/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface E5Config {
  /** Time window to group batchable requests (ms). Default: 100 */
  windowMs: number;
  /** Minimum requests in window to flag. Default: 3 */
  minRequestsInWindow: number;
  /** Only batch GET requests. Default: true */
  onlyGet: boolean;
}

const DEFAULT_E5_CONFIG: E5Config = {
  windowMs: 100,
  minRequestsInWindow: 3,
  onlyGet: true,
};

// ─── Batchable Group ────────────────────────────────────────────

interface BatchableGroup {
  host: string;
  requests: FluxRequestRecord[];
  windowStart: number;
  windowEnd: number;
  totalDuration: number;
  maxDuration: number;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectBatchable(
  requests: FluxRequestRecord[],
  config: E5Config,
): BatchableGroup[] {
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    (r.type === 'api-rest' || r.type === 'api-graphql') &&
    (!config.onlyGet || r.method === 'GET')
  );

  if (apiRequests.length < config.minRequestsInWindow) return [];

  // Group by host
  const hostGroups = new Map<string, FluxRequestRecord[]>();
  for (const r of apiRequests) {
    const host = r.urlParts.host;
    if (!hostGroups.has(host)) hostGroups.set(host, []);
    hostGroups.get(host)!.push(r);
  }

  const results: BatchableGroup[] = [];

  for (const [host, reqs] of hostGroups) {
    if (reqs.length < config.minRequestsInWindow) continue;

    // Sort by start time
    const sorted = reqs.slice().sort((a, b) => a.startTime - b.startTime);

    // Sliding window to find clusters
    let windowStart = 0;
    for (let i = 0; i < sorted.length; i++) {
      // Move window start forward
      while (windowStart < i && sorted[i].startTime - sorted[windowStart].startTime > config.windowMs) {
        windowStart++;
      }

      const windowReqs = sorted.slice(windowStart, i + 1);
      if (windowReqs.length >= config.minRequestsInWindow) {
        // Check they're all to different endpoints (not E2 duplicates)
        const uniquePatterns = new Set(windowReqs.map(r => r.urlParts.pathPattern));
        if (uniquePatterns.size >= config.minRequestsInWindow) {
          const totalDur = windowReqs.reduce((s, r) => s + (r.duration || 0), 0);
          const maxDur = Math.max(...windowReqs.map(r => r.duration || 0));

          results.push({
            host,
            requests: windowReqs,
            windowStart: windowReqs[0].startTime,
            windowEnd: windowReqs[windowReqs.length - 1].startTime,
            totalDuration: totalDur,
            maxDuration: maxDur,
          });

          // Skip past this window
          windowStart = i + 1;
          i = windowStart - 1;
        }
      }
    }
  }

  return results.sort((a, b) => b.requests.length - a.requests.length);
}

// ─── Violation Builder ──────────────────────────────────────────

function groupToViolation(group: BatchableGroup): RuleViolation {
  const components = [...new Set(
    group.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];
  const endpoints = group.requests.map(r => `${r.method} ${r.urlParts.pathname}`);

  return {
    ruleId: 'E5',
    title: `${group.requests.length} requests to ${group.host} within ${Math.round(group.windowEnd - group.windowStart)}ms`,
    description:
      `${group.requests.length} separate API calls to "${group.host}" fired within a ${Math.round(group.windowEnd - group.windowStart)}ms window. ` +
      `These could be combined into a single batch request (e.g., POST /api/batch). ` +
      `Sequential execution takes ${Math.round(group.totalDuration)}ms; ` +
      `batching would take ~${Math.round(group.maxDuration)}ms.`,
    severity: 'warning',
    affectedRequests: group.requests,
    affectedEndpoints: [...new Set(group.requests.map(r => r.urlParts.pathPattern))],
    affectedComponents: components,
    impact: {
      timeSavedMs: group.totalDuration - group.maxDuration,
      requestsEliminated: group.requests.length - 1,
      bandwidthSavedBytes: (group.requests.length - 1) * 200, // ~200B per request overhead
      monthlyCostSavings: 0,
    },
    metadata: {
      host: group.host,
      requestCount: group.requests.length,
      endpoints,
      windowMs: group.windowEnd - group.windowStart,
      totalDuration: group.totalDuration,
      maxDuration: group.maxDuration,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createE5Rule(config?: Partial<E5Config>): AuditRule {
  const cfg = { ...DEFAULT_E5_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.E5;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql'
      );

      const batchable = detectBatchable(session.requests, cfg);
      const violations = batchable.map(groupToViolation);

      const affectedIds = new Set<string>();
      for (const g of batchable) {
        for (const r of g.requests) affectedIds.add(r.id);
      }

      const violationRatio = apiRequests.length > 0
        ? affectedIds.size / apiRequests.length : 0;
      const severityFactor = 0.7;
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
