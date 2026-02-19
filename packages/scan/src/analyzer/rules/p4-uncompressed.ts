// ═══════════════════════════════════════════════════════════════════
// Rule P4: Uncompressed Responses
// Detects API responses that are not using gzip or brotli compression.
// Compares Content-Length with estimated compressed size to calculate
// wasted bandwidth.
//
// Severity: Info | Weight: 3/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface P4Config {
  /** Minimum response size (bytes) to check. Tiny responses don't benefit much. Default: 1024 */
  minResponseSize: number;
  /** Estimated compression ratio for JSON (typical gzip). Default: 0.3 */
  estimatedCompressionRatio: number;
  /** Only check API responses. Default: true */
  apiOnly: boolean;
}

const DEFAULT_P4_CONFIG: P4Config = {
  minResponseSize: 1024,
  estimatedCompressionRatio: 0.3,
  apiOnly: true,
};

// ─── Uncompressed Endpoint ──────────────────────────────────────

interface UncompressedEndpoint {
  pattern: string;
  method: string;
  requests: FluxRequestRecord[];
  avgResponseSize: number;
  estimatedCompressedSize: number;
  wastedBytes: number;
  contentType: string;
}

// ─── Detection Logic ────────────────────────────────────────────

function detectUncompressed(
  requests: FluxRequestRecord[],
  config: P4Config,
): UncompressedEndpoint[] {
  const candidates = requests.filter(r => {
    if (!r.response) return false;
    if (config.apiOnly && r.type !== 'api-rest' && r.type !== 'api-graphql' && r.type !== 'api-grpc') return false;
    if (r.response.bodySize < config.minResponseSize) return false;
    return true;
  });

  // Group by endpoint pattern
  const groups = new Map<string, FluxRequestRecord[]>();
  for (const req of candidates) {
    const key = `${req.method}||${req.urlParts.pathPattern}`;
    const group = groups.get(key) || [];
    group.push(req);
    groups.set(key, group);
  }

  const results: UncompressedEndpoint[] = [];

  for (const [key, group] of groups) {
    const [method, pattern] = key.split('||');

    // Check if ANY response in the group has compression
    const hasCompression = group.some(r => {
      const enc = r.response!.cacheHeaders.contentEncoding;
      return enc && (enc.includes('gzip') || enc.includes('br') || enc.includes('deflate'));
    });

    if (hasCompression) continue; // Already compressed

    const avgSize = group.reduce((s, r) => s + (r.response?.bodySize || 0), 0) / group.length;
    const estimatedCompressed = Math.round(avgSize * config.estimatedCompressionRatio);
    const wastedPerReq = Math.round(avgSize - estimatedCompressed);
    const contentType = group[0].response?.contentType || 'application/json';

    if (wastedPerReq < 512) continue; // Not worth flagging

    results.push({
      pattern,
      method,
      requests: group,
      avgResponseSize: Math.round(avgSize),
      estimatedCompressedSize: estimatedCompressed,
      wastedBytes: wastedPerReq * group.length,
      contentType,
    });
  }

  return results.sort((a, b) => b.wastedBytes - a.wastedBytes);
}

// ─── Violation Builder ──────────────────────────────────────────

function toViolation(ep: UncompressedEndpoint): RuleViolation {
  const components = [...new Set(
    ep.requests.map(r => r.initiator.componentName).filter(Boolean) as string[]
  )];
  const savedKB = Math.round(ep.wastedBytes / 1024);
  const pct = Math.round((1 - ep.estimatedCompressedSize / ep.avgResponseSize) * 100);

  return {
    ruleId: 'P4',
    title: `Uncompressed: ${ep.method} ${ep.pattern} (~${pct}% smaller with gzip)`,
    description:
      `"${ep.method} ${ep.pattern}" returns ~${Math.round(ep.avgResponseSize / 1024)}KB uncompressed. ` +
      `With gzip, estimated ~${Math.round(ep.estimatedCompressedSize / 1024)}KB (${pct}% reduction). ` +
      `Over ${ep.requests.length} requests, ~${savedKB}KB wasted bandwidth. ` +
      `Enable gzip/brotli compression on your server.`,
    severity: 'info',
    affectedRequests: ep.requests,
    affectedEndpoints: [ep.pattern],
    affectedComponents: components,
    impact: {
      timeSavedMs: Math.round(ep.wastedBytes / 50000 * ep.requests.length), // Rough: 50KB/s slower transfer
      requestsEliminated: 0,
      bandwidthSavedBytes: ep.wastedBytes,
      monthlyCostSavings: 0,
    },
    metadata: {
      pattern: ep.pattern,
      method: ep.method,
      avgResponseSize: ep.avgResponseSize,
      estimatedCompressedSize: ep.estimatedCompressedSize,
      compressionRatio: ep.estimatedCompressedSize / ep.avgResponseSize,
      contentType: ep.contentType,
    },
  };
}

// ─── Rule Implementation ────────────────────────────────────────

export function createP4Rule(config?: Partial<P4Config>): AuditRule {
  const cfg = { ...DEFAULT_P4_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.P4;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();

      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
      );

      const uncompressed = detectUncompressed(session.requests, cfg);
      const violations = uncompressed.map(toViolation);

      const affectedIds = new Set<string>();
      for (const ep of uncompressed) {
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
