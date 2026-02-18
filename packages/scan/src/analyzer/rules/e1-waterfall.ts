// ═══════════════════════════════════════════════════════════════════
// Rule E1: Request Waterfall Detection
// Detects sequential API calls that have no data dependency between
// them and could execute in parallel.
//
// A waterfall is: Request B starts AFTER Request A finishes, but
// B does not use any data from A's response.
//
// Severity: Critical | Weight: 15/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation, ViolationImpact } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface E1Config {
  /** Max gap between requests to consider them sequential (ms). Default: 50 */
  maxGapMs: number;
  /** Minimum waterfall chain length to report. Default: 2 */
  minChainLength: number;
  /** Minimum total wasted time to report (ms). Default: 100 */
  minWastedTimeMs: number;
}

const DEFAULT_E1_CONFIG: E1Config = {
  maxGapMs: 50,
  minChainLength: 2,
  minWastedTimeMs: 100,
};

// ─── Waterfall Chain ────────────────────────────────────────────

export interface WaterfallChain {
  /** Requests in sequential order */
  requests: FluxRequestRecord[];
  /** Route where this waterfall occurs */
  route: string;
  /** Total sequential time (sum of all durations) */
  totalSequentialTime: number;
  /** Parallel time (duration of longest request = parallel minimum) */
  parallelTime: number;
  /** Time wasted by not parallelizing */
  wastedTime: number;
}

// ─── Detection Logic ────────────────────────────────────────────

/**
 * Find waterfall chains: groups of requests that fire sequentially
 * on the same route, where each request starts after the previous ends.
 */
function detectWaterfalls(
  requests: FluxRequestRecord[],
  config: E1Config,
): WaterfallChain[] {
  // Only analyze completed API requests
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    r.endTime !== null &&
    r.duration !== null &&
    (r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc')
  );

  if (apiRequests.length < 2) return [];

  // Group by route
  const byRoute = new Map<string, FluxRequestRecord[]>();
  for (const req of apiRequests) {
    const route = req.navigationContext.currentRoute;
    const group = byRoute.get(route) || [];
    group.push(req);
    byRoute.set(route, group);
  }

  const chains: WaterfallChain[] = [];

  for (const [route, routeRequests] of byRoute) {
    // Sort by start time
    const sorted = [...routeRequests].sort((a, b) => a.startTime - b.startTime);

    // Find sequential chains
    let currentChain: FluxRequestRecord[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = currentChain[currentChain.length - 1];
      const curr = sorted[i];

      // Is this request sequential? (starts after previous ends, within gap threshold)
      const prevEnd = prev.endTime!;
      const gap = curr.startTime - prevEnd;

      if (gap >= 0 && gap <= config.maxGapMs) {
        // Sequential - extends the chain
        currentChain.push(curr);
      } else if (curr.startTime > prevEnd) {
        // Too large a gap - flush current chain, start new one
        if (currentChain.length >= config.minChainLength) {
          const chain = buildChain(currentChain, route);
          if (chain.wastedTime >= config.minWastedTimeMs) {
            chains.push(chain);
          }
        }
        currentChain = [curr];
      } else {
        // curr starts BEFORE prev ends — they overlap (parallel), skip
        // But the chain continues — don't break it, just don't add this request
      }
    }

    // Flush remaining chain
    if (currentChain.length >= config.minChainLength) {
      const chain = buildChain(currentChain, route);
      if (chain.wastedTime >= config.minWastedTimeMs) {
        chains.push(chain);
      }
    }
  }

  // Sort by wasted time (most impactful first)
  return chains.sort((a, b) => b.wastedTime - a.wastedTime);
}

function buildChain(requests: FluxRequestRecord[], route: string): WaterfallChain {
  const totalSequentialTime = requests.reduce((sum, r) => sum + (r.duration || 0), 0);
  const parallelTime = Math.max(...requests.map(r => r.duration || 0));
  const wastedTime = totalSequentialTime - parallelTime;

  return {
    requests,
    route,
    totalSequentialTime,
    parallelTime,
    wastedTime,
  };
}

// ─── Violation Builder ──────────────────────────────────────────

function chainToViolation(chain: WaterfallChain): RuleViolation {
  const endpoints = [...new Set(chain.requests.map(r => r.urlParts.pathPattern))];
  const components = [...new Set(
    chain.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];

  return {
    ruleId: 'E1',
    title: `${chain.requests.length} sequential requests on ${chain.route}`,
    description:
      `Found ${chain.requests.length} API calls firing one after another on "${chain.route}" ` +
      `that could run in parallel. Sequential time: ${Math.round(chain.totalSequentialTime)}ms → ` +
      `Parallel time: ${Math.round(chain.parallelTime)}ms. ` +
      `Wasting ${Math.round(chain.wastedTime)}ms per page load.`,
    severity: 'critical',
    affectedRequests: chain.requests,
    affectedEndpoints: endpoints,
    affectedComponents: components,
    impact: {
      timeSavedMs: chain.wastedTime,
      requestsEliminated: 0, // Waterfall doesn't eliminate requests, just parallelizes
      bandwidthSavedBytes: 0,
      monthlyCostSavings: 0,
    },
    metadata: {
      chainLength: chain.requests.length,
      route: chain.route,
      totalSequentialTime: chain.totalSequentialTime,
      parallelTime: chain.parallelTime,
      wastedTime: chain.wastedTime,
      requestTimeline: chain.requests.map(r => ({
        url: r.urlParts.pathPattern,
        method: r.method,
        start: r.startTime,
        end: r.endTime,
        duration: r.duration,
        component: r.initiator.componentName,
      })),
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createE1Rule(config?: Partial<E1Config>): AuditRule {
  const cfg = { ...DEFAULT_E1_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.E1;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const chains = detectWaterfalls(session.requests, cfg);
      const violations = chains.map(chainToViolation);

      // Count affected requests (unique across all chains)
      const affectedIds = new Set<string>();
      for (const chain of chains) {
        for (const req of chain.requests) {
          affectedIds.add(req.id);
        }
      }

      // Calculate score
      const violationRatio = apiRequests.length > 0
        ? affectedIds.size / apiRequests.length
        : 0;
      const severityFactor = 1.0; // critical
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
