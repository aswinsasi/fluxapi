// ═══════════════════════════════════════════════════════════════════
// Rule E2: Duplicate Request Detection
// Detects identical requests (same URL, method, params) fired by
// multiple components within a short time window. This happens when
// components each independently fetch the same data without shared state.
//
// Severity: Critical | Weight: 15/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';
import { requestSignature } from '../../utils';

// ─── Configuration ──────────────────────────────────────────────

interface E2Config {
  /** Time window for duplicate detection (ms). Default: 2000 */
  windowMs: number;
  /** Minimum duplicates to report. Default: 2 */
  minDuplicates: number;
}

const DEFAULT_E2_CONFIG: E2Config = {
  windowMs: 2000,
  minDuplicates: 2,
};

// ─── Duplicate Group ────────────────────────────────────────────

export interface DuplicateGroup {
  /** Request signature (URL pattern + method) */
  signature: string;
  /** All requests in this duplicate group */
  requests: FluxRequestRecord[];
  /** Number of extra (wasted) requests */
  wastedCount: number;
  /** Total wasted bytes (response size * wasted count) */
  wastedBytes: number;
  /** Total wasted time */
  wastedTimeMs: number;
  /** Unique components that triggered these */
  components: string[];
  /** Route where duplicates occur */
  route: string;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectDuplicates(
  requests: FluxRequestRecord[],
  config: E2Config,
): DuplicateGroup[] {
  const apiRequests = requests.filter(r =>
    r.response !== null &&
    (r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc')
  );

  if (apiRequests.length < 2) return [];

  // Group by signature
  const signatureGroups = new Map<string, FluxRequestRecord[]>();
  for (const req of apiRequests) {
    const sig = requestSignature(req.url, req.method);
    const group = signatureGroups.get(sig) || [];
    group.push(req);
    signatureGroups.set(sig, group);
  }

  const duplicateGroups: DuplicateGroup[] = [];

  for (const [sig, group] of signatureGroups) {
    if (group.length < config.minDuplicates) continue;

    // Within each signature group, find temporal clusters (within windowMs)
    const sorted = [...group].sort((a, b) => a.startTime - b.startTime);
    const clusters: FluxRequestRecord[][] = [];
    let currentCluster: FluxRequestRecord[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const timeDiff = sorted[i].startTime - currentCluster[0].startTime;
      if (timeDiff <= config.windowMs) {
        currentCluster.push(sorted[i]);
      } else {
        if (currentCluster.length >= config.minDuplicates) {
          clusters.push(currentCluster);
        }
        currentCluster = [sorted[i]];
      }
    }
    if (currentCluster.length >= config.minDuplicates) {
      clusters.push(currentCluster);
    }

    // Build duplicate groups from clusters
    for (const cluster of clusters) {
      const wastedCount = cluster.length - 1; // First request is needed, rest are waste
      const avgResponseSize = cluster.reduce((sum, r) => sum + (r.response?.bodySize || 0), 0) / cluster.length;
      const avgDuration = cluster.reduce((sum, r) => sum + (r.duration || 0), 0) / cluster.length;

      const components = [...new Set(
        cluster.map(r => r.initiator.componentName).filter(Boolean) as string[]
      )];

      duplicateGroups.push({
        signature: sig,
        requests: cluster,
        wastedCount,
        wastedBytes: Math.round(avgResponseSize * wastedCount),
        wastedTimeMs: avgDuration * wastedCount,
        components,
        route: cluster[0].navigationContext.currentRoute,
      });
    }
  }

  // Sort by wasted count (most duplicates first)
  return duplicateGroups.sort((a, b) => b.wastedCount - a.wastedCount);
}

// ─── Violation Builder ──────────────────────────────────────────

function groupToViolation(group: DuplicateGroup): RuleViolation {
  const sampleUrl = group.requests[0].urlParts.pathPattern;
  const method = group.requests[0].method;

  return {
    ruleId: 'E2',
    title: `${method} ${sampleUrl} called ${group.requests.length}x in ${Math.round(group.requests[group.requests.length - 1].startTime - group.requests[0].startTime)}ms`,
    description:
      `"${method} ${sampleUrl}" was called ${group.requests.length} times within ` +
      `${Math.round(group.requests[group.requests.length - 1].startTime - group.requests[0].startTime)}ms ` +
      `on route "${group.route}". ` +
      (group.components.length > 1
        ? `Triggered by ${group.components.length} different components: ${group.components.join(', ')}. `
        : '') +
      `${group.wastedCount} requests are redundant, wasting ` +
      `${Math.round(group.wastedBytes / 1024)}KB of bandwidth.`,
    severity: 'critical',
    affectedRequests: group.requests,
    affectedEndpoints: [sampleUrl],
    affectedComponents: group.components,
    impact: {
      timeSavedMs: group.wastedTimeMs,
      requestsEliminated: group.wastedCount,
      bandwidthSavedBytes: group.wastedBytes,
      monthlyCostSavings: 0, // Calculated by scorer
    },
    metadata: {
      signature: group.signature,
      duplicateCount: group.requests.length,
      wastedCount: group.wastedCount,
      wastedBytes: group.wastedBytes,
      route: group.route,
      components: group.components,
      timeline: group.requests.map(r => ({
        id: r.id,
        startTime: r.startTime,
        duration: r.duration,
        component: r.initiator.componentName,
        componentFile: r.initiator.componentFile,
      })),
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createE2Rule(config?: Partial<E2Config>): AuditRule {
  const cfg = { ...DEFAULT_E2_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.E2;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const groups = detectDuplicates(session.requests, cfg);
      const violations = groups.map(groupToViolation);

      const affectedIds = new Set<string>();
      for (const group of groups) {
        for (const req of group.requests) {
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
