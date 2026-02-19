// ═══════════════════════════════════════════════════════════════════
// Rule P1: Missing Prefetch Opportunities
// Detects predictable navigation patterns where the next page's data
// could be prefetched. Builds a transition probability matrix from
// observed navigations and flags high-probability transitions where
// the destination page makes API calls that could be prefetched.
//
// Severity: Warning | Weight: 8/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession, NavigationEvent } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface P1Config {
  /** Minimum transition probability to flag (0-1). Default: 0.7 */
  minTransitionProbability: number;
  /** Minimum transitions observed. Default: 2 */
  minTransitions: number;
  /** Minimum data load time on target page to make prefetch worthwhile (ms). Default: 200 */
  minTargetLoadMs: number;
}

const DEFAULT_P1_CONFIG: P1Config = {
  minTransitionProbability: 0.7,
  minTransitions: 2,
  minTargetLoadMs: 200,
};

// ─── Prefetch Opportunity ───────────────────────────────────────

interface PrefetchOpportunity {
  fromRoute: string;
  toRoute: string;
  probability: number;
  transitionCount: number;
  totalTransitionsFromSource: number;
  targetRequests: FluxRequestRecord[];
  targetLoadTimeMs: number;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectMissingPrefetch(
  session: FluxScanSession,
  config: P1Config,
): PrefetchOpportunity[] {
  const { navigations, requests } = session;

  if (navigations.length < config.minTransitions) return [];

  // Build transition matrix: from → to → count
  const transitions = new Map<string, Map<string, number>>();
  const fromCounts = new Map<string, number>();

  for (const nav of navigations) {
    if (!nav.fromRoute || nav.fromRoute === nav.toRoute) continue;

    const from = normalizeRoute(nav.fromRoute);
    const to = normalizeRoute(nav.toRoute);

    if (!transitions.has(from)) transitions.set(from, new Map());
    const toMap = transitions.get(from)!;
    toMap.set(to, (toMap.get(to) || 0) + 1);
    fromCounts.set(from, (fromCounts.get(from) || 0) + 1);
  }

  // Find requests made right after each navigation (within 2s)
  const routeRequests = new Map<string, FluxRequestRecord[]>();
  for (const nav of navigations) {
    const route = normalizeRoute(nav.toRoute);
    const afterNav = requests.filter(r =>
      (r.type === 'api-rest' || r.type === 'api-graphql') &&
      r.response !== null &&
      r.startTime >= nav.timestamp &&
      r.startTime <= nav.timestamp + 2000
    );
    if (afterNav.length > 0) {
      if (!routeRequests.has(route)) routeRequests.set(route, []);
      routeRequests.get(route)!.push(...afterNav);
    }
  }

  // Find high-probability transitions with significant target load
  const results: PrefetchOpportunity[] = [];

  for (const [from, toMap] of transitions) {
    const totalFromCount = fromCounts.get(from) || 0;

    for (const [to, count] of toMap) {
      const probability = count / totalFromCount;
      if (probability < config.minTransitionProbability) continue;
      if (count < config.minTransitions) continue;

      const targetReqs = routeRequests.get(to) || [];
      if (targetReqs.length === 0) continue;

      // Deduplicate by endpoint
      const uniqueReqs = deduplicateByEndpoint(targetReqs);
      const totalLoadTime = uniqueReqs.reduce((s, r) => s + (r.duration || 0), 0);

      if (totalLoadTime < config.minTargetLoadMs) continue;

      results.push({
        fromRoute: from,
        toRoute: to,
        probability,
        transitionCount: count,
        totalTransitionsFromSource: totalFromCount,
        targetRequests: uniqueReqs,
        targetLoadTimeMs: totalLoadTime,
      });
    }
  }

  return results.sort((a, b) => b.targetLoadTimeMs - a.targetLoadTimeMs);
}

function normalizeRoute(route: string): string {
  try {
    const url = new URL(route, 'http://x');
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return route.replace(/\/+$/, '') || '/';
  }
}

function deduplicateByEndpoint(requests: FluxRequestRecord[]): FluxRequestRecord[] {
  const seen = new Set<string>();
  return requests.filter(r => {
    const key = `${r.method}|${r.urlParts.pathPattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Violation Builder ──────────────────────────────────────────

function opportunityToViolation(op: PrefetchOpportunity): RuleViolation {
  return {
    ruleId: 'P1',
    title: `Prefetch: ${op.fromRoute} → ${op.toRoute} (${Math.round(op.probability * 100)}% probability, ${Math.round(op.targetLoadTimeMs)}ms)`,
    description:
      `${Math.round(op.probability * 100)}% of users navigate from "${op.fromRoute}" to "${op.toRoute}" ` +
      `(observed ${op.transitionCount}/${op.totalTransitionsFromSource} times). ` +
      `The target page loads ${op.targetRequests.length} API calls taking ~${Math.round(op.targetLoadTimeMs)}ms. ` +
      `Prefetching this data on hover/intent would eliminate the loading delay.`,
    severity: 'warning',
    affectedRequests: op.targetRequests,
    affectedEndpoints: [...new Set(op.targetRequests.map(r => r.urlParts.pathPattern))],
    affectedComponents: [],
    impact: {
      timeSavedMs: op.targetLoadTimeMs,
      requestsEliminated: 0, // Requests still happen, just earlier
      bandwidthSavedBytes: 0,
      monthlyCostSavings: 0,
    },
    metadata: {
      fromRoute: op.fromRoute,
      toRoute: op.toRoute,
      probability: op.probability,
      transitionCount: op.transitionCount,
      targetEndpoints: op.targetRequests.map(r => `${r.method} ${r.urlParts.pathname}`),
      targetLoadTimeMs: op.targetLoadTimeMs,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createP1Rule(config?: Partial<P1Config>): AuditRule {
  const cfg = { ...DEFAULT_P1_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.P1;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const opportunities = detectMissingPrefetch(session, cfg);
      const violations = opportunities.map(opportunityToViolation);

      const affectedIds = new Set<string>();
      for (const op of opportunities) {
        for (const r of op.targetRequests) affectedIds.add(r.id);
      }

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql'
      );
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
