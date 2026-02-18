// ═══════════════════════════════════════════════════════════════════
// Rule E3: N+1 Query Pattern Detection
// Detects list pages that fire individual detail requests per item
// instead of a single batch request. Classic example: product listing
// page fires GET /api/products/1, GET /api/products/2, ... /25
//
// Severity: Critical | Weight: 12/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface E3Config {
  /** Minimum number of same-pattern requests to consider N+1. Default: 5 */
  threshold: number;
  /** Max time window for N+1 burst (ms). Default: 5000 */
  windowMs: number;
}

const DEFAULT_E3_CONFIG: E3Config = {
  threshold: 5,
  windowMs: 5000,
};

// ─── N+1 Pattern ────────────────────────────────────────────────

export interface NPlus1Pattern {
  /** URL pattern (e.g., /api/products/:id) */
  pattern: string;
  /** HTTP method */
  method: string;
  /** All requests matching this pattern in the burst */
  requests: FluxRequestRecord[];
  /** Distinct IDs fetched */
  distinctIds: string[];
  /** Route where this occurs */
  route: string;
  /** Component that triggered these */
  component: string | null;
  /** Total time for all individual requests */
  totalTimeMs: number;
  /** Estimated batch request time (max single request duration) */
  estimatedBatchTimeMs: number;
}

// ─── Detection Logic ────────────────────────────────────────────

/**
 * Detect N+1 patterns by finding URL patterns with dynamic segments
 * that have many requests in a short time window.
 *
 * How it works:
 * 1. Group requests by their URL pattern (e.g., /api/products/:id)
 * 2. Within each group, find bursts (requests clustered in time)
 * 3. If a burst has >= threshold requests, it's an N+1 pattern
 */
function detectNPlus1(
  requests: FluxRequestRecord[],
  config: E3Config,
): NPlus1Pattern[] {
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    r.duration !== null &&
    (r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc')
  );

  if (apiRequests.length < config.threshold) return [];

  // Group by path pattern + method (e.g., "GET:/api/products/:id")
  const patternGroups = new Map<string, FluxRequestRecord[]>();
  for (const req of apiRequests) {
    // Only consider patterns with dynamic segments
    if (!req.urlParts.pathPattern.includes(':')) continue;

    const key = `${req.method}||${req.urlParts.pathPattern}`;
    const group = patternGroups.get(key) || [];
    group.push(req);
    patternGroups.set(key, group);
  }

  const patterns: NPlus1Pattern[] = [];

  for (const [key, group] of patternGroups) {
    if (group.length < config.threshold) continue;

    // Find temporal bursts within the group
    const sorted = [...group].sort((a, b) => a.startTime - b.startTime);
    const bursts = findBursts(sorted, config.windowMs);

    for (const burst of bursts) {
      if (burst.length < config.threshold) continue;

      const [method, pattern] = key.split('||');

      // Extract the dynamic IDs from actual URLs
      const distinctIds = extractDynamicIds(burst, pattern);

      const totalTimeMs = burst.reduce((sum, r) => sum + (r.duration || 0), 0);
      const maxDuration = Math.max(...burst.map(r => r.duration || 0));

      // Find the most common component
      const componentCounts = new Map<string, number>();
      for (const req of burst) {
        const comp = req.initiator.componentName || '<unknown>';
        componentCounts.set(comp, (componentCounts.get(comp) || 0) + 1);
      }
      const topComponent = [...componentCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      patterns.push({
        pattern,
        method,
        requests: burst,
        distinctIds,
        route: burst[0].navigationContext.currentRoute,
        component: topComponent === '<unknown>' ? null : topComponent,
        totalTimeMs,
        estimatedBatchTimeMs: maxDuration * 1.2, // Batch is ~20% slower than single due to payload
      });
    }
  }

  return patterns.sort((a, b) => b.requests.length - a.requests.length);
}

/**
 * Find temporal bursts: groups of requests clustered within windowMs.
 */
function findBursts(
  sorted: FluxRequestRecord[],
  windowMs: number,
): FluxRequestRecord[][] {
  const bursts: FluxRequestRecord[][] = [];
  let currentBurst: FluxRequestRecord[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const timeSinceStart = sorted[i].startTime - currentBurst[0].startTime;
    if (timeSinceStart <= windowMs) {
      currentBurst.push(sorted[i]);
    } else {
      bursts.push(currentBurst);
      currentBurst = [sorted[i]];
    }
  }
  bursts.push(currentBurst);

  return bursts;
}

/**
 * Extract dynamic segment values from actual URLs based on the pattern.
 * Pattern: /api/products/:id  URL: /api/products/42  → extracts "42"
 */
function extractDynamicIds(
  requests: FluxRequestRecord[],
  pattern: string,
): string[] {
  const patternSegments = pattern.split('/').filter(Boolean);
  const dynamicIndexes = patternSegments
    .map((seg, i) => seg.startsWith(':') ? i : -1)
    .filter(i => i !== -1);

  const ids = new Set<string>();
  for (const req of requests) {
    for (const idx of dynamicIndexes) {
      const segment = req.urlParts.pathSegments[idx];
      if (segment) ids.add(segment);
    }
  }

  return [...ids];
}

// ─── Violation Builder ──────────────────────────────────────────

function patternToViolation(pattern: NPlus1Pattern): RuleViolation {
  const timeSaved = pattern.totalTimeMs - pattern.estimatedBatchTimeMs;

  return {
    ruleId: 'E3',
    title: `N+1: ${pattern.requests.length} individual ${pattern.method} ${pattern.pattern} requests`,
    description:
      `Found ${pattern.requests.length} individual requests to "${pattern.method} ${pattern.pattern}" ` +
      `on route "${pattern.route}" that could be a single batch request. ` +
      `Fetching ${pattern.distinctIds.length} distinct IDs individually ` +
      `takes ${Math.round(pattern.totalTimeMs)}ms total. ` +
      `A batch request would take ~${Math.round(pattern.estimatedBatchTimeMs)}ms. ` +
      (pattern.component ? `Triggered by component: ${pattern.component}.` : ''),
    severity: 'critical',
    affectedRequests: pattern.requests,
    affectedEndpoints: [pattern.pattern],
    affectedComponents: pattern.component ? [pattern.component] : [],
    impact: {
      timeSavedMs: Math.max(0, timeSaved),
      requestsEliminated: pattern.requests.length - 1,
      bandwidthSavedBytes: 0, // Batch may return similar total data
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: pattern.pattern,
      method: pattern.method,
      requestCount: pattern.requests.length,
      distinctIds: pattern.distinctIds,
      route: pattern.route,
      component: pattern.component,
      totalTimeMs: pattern.totalTimeMs,
      estimatedBatchTimeMs: pattern.estimatedBatchTimeMs,
      sampleUrls: pattern.requests.slice(0, 5).map(r => r.url),
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createE3Rule(config?: Partial<E3Config>): AuditRule {
  const cfg = { ...DEFAULT_E3_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.E3;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const patterns = detectNPlus1(session.requests, cfg);
      const violations = patterns.map(patternToViolation);

      const affectedIds = new Set<string>();
      for (const p of patterns) {
        for (const req of p.requests) {
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
