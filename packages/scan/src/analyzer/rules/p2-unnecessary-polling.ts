// ═══════════════════════════════════════════════════════════════════
// Rule P2: Unnecessary Polling
// Detects refetchInterval or setInterval-based polling where the
// polling frequency significantly exceeds the data change rate.
// If an endpoint is polled every 2s but data changes every 5 minutes,
// 99% of polls are wasted.
//
// Severity: Warning | Weight: 5/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface P2Config {
  /** Minimum repetitions to consider as polling. Default: 5 */
  minRepetitions: number;
  /** Max coefficient of variation for intervals to be "regular". Default: 0.3 */
  maxIntervalCV: number;
  /** Minimum waste ratio to flag (wasted polls / total polls). Default: 0.7 */
  minWasteRatio: number;
}

const DEFAULT_P2_CONFIG: P2Config = {
  minRepetitions: 5,
  maxIntervalCV: 0.3,
  minWasteRatio: 0.7,
};

// ─── Polling Endpoint ───────────────────────────────────────────

interface PollingEndpoint {
  pattern: string;
  method: string;
  requests: FluxRequestRecord[];
  pollIntervalMs: number;
  changeCount: number;
  wasteRatio: number;
  recommendedIntervalMs: number;
  wastedRequests: number;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectUnnecessaryPolling(
  requests: FluxRequestRecord[],
  config: P2Config,
): PollingEndpoint[] {
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    r.method === 'GET' &&
    (r.type === 'api-rest' || r.type === 'api-graphql')
  );

  // Group by endpoint pattern
  const groups = new Map<string, FluxRequestRecord[]>();
  for (const r of apiRequests) {
    const key = `${r.method}|${r.urlParts.pathPattern}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const results: PollingEndpoint[] = [];

  for (const [key, reqs] of groups) {
    if (reqs.length < config.minRepetitions) continue;

    const sorted = reqs.slice().sort((a, b) => a.startTime - b.startTime);

    // Calculate intervals between consecutive requests
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i].startTime - sorted[i - 1].startTime);
    }

    if (intervals.length < config.minRepetitions - 1) continue;

    // Check if intervals are regular (low coefficient of variation)
    const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;
    const variance = intervals.reduce((s, i) => s + (i - avgInterval) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = avgInterval > 0 ? stdDev / avgInterval : Infinity;

    if (cv > config.maxIntervalCV) continue; // Not regular enough to be polling

    // Count how many responses actually changed
    let changeCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].response?.bodyHash !== sorted[i - 1].response?.bodyHash) {
        changeCount++;
      }
    }

    const totalPolls = sorted.length - 1;
    const wastedPolls = totalPolls - changeCount;
    const wasteRatio = totalPolls > 0 ? wastedPolls / totalPolls : 0;

    if (wasteRatio < config.minWasteRatio) continue;

    // Calculate recommended interval
    const totalDuration = sorted[sorted.length - 1].startTime - sorted[0].startTime;
    const recommendedInterval = changeCount > 0
      ? Math.round(totalDuration / changeCount)
      : Math.round(totalDuration); // If no changes, suggest very long interval

    const [method, pattern] = key.split('|');

    results.push({
      pattern, method, requests: sorted,
      pollIntervalMs: Math.round(avgInterval),
      changeCount, wasteRatio,
      recommendedIntervalMs: Math.min(recommendedInterval, 300000), // cap at 5min
      wastedRequests: wastedPolls,
    });
  }

  return results.sort((a, b) => b.wastedRequests - a.wastedRequests);
}

// ─── Violation Builder ──────────────────────────────────────────

function endpointToViolation(ep: PollingEndpoint): RuleViolation {
  const components = [...new Set(
    ep.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];

  const pollSec = (ep.pollIntervalMs / 1000).toFixed(1);
  const recSec = (ep.recommendedIntervalMs / 1000).toFixed(0);
  const wastedBw = ep.wastedRequests * (ep.requests[0]?.response?.bodySize || 0);

  return {
    ruleId: 'P2',
    title: `Excessive polling: ${ep.pattern} every ${pollSec}s (${Math.round(ep.wasteRatio * 100)}% wasted)`,
    description:
      `"${ep.method} ${ep.pattern}" is polled every ~${pollSec}s, ` +
      `but data only changed ${ep.changeCount} times across ${ep.requests.length} polls ` +
      `(${Math.round(ep.wasteRatio * 100)}% of polls returned identical data). ` +
      `Recommend increasing interval to ~${recSec}s or using WebSocket/SSE for real-time updates.`,
    severity: 'warning',
    affectedRequests: ep.requests,
    affectedEndpoints: [ep.pattern],
    affectedComponents: components,
    impact: {
      timeSavedMs: 0, // Polling doesn't directly block UI
      requestsEliminated: ep.wastedRequests,
      bandwidthSavedBytes: wastedBw,
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: ep.pattern, pollIntervalMs: ep.pollIntervalMs,
      changeCount: ep.changeCount, wasteRatio: ep.wasteRatio,
      recommendedIntervalMs: ep.recommendedIntervalMs,
      wastedRequests: ep.wastedRequests, totalPolls: ep.requests.length,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createP2Rule(config?: Partial<P2Config>): AuditRule {
  const cfg = { ...DEFAULT_P2_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.P2;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();
      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql'
      );

      const polling = detectUnnecessaryPolling(session.requests, cfg);
      const violations = polling.map(endpointToViolation);

      const affectedIds = new Set<string>();
      for (const ep of polling) {
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
