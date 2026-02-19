// ═══════════════════════════════════════════════════════════════════
// Rule P3: Missing Error Recovery
// Detects API calls that fail with no evidence of retry logic,
// fallback behavior, or circuit breaking. When these requests fail,
// users see errors with no recovery path.
//
// Detection: Look for failed requests (4xx/5xx/network error) where
// there is no subsequent retry to the same endpoint within a window.
//
// Severity: Info | Weight: 3/100
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession } from '../../types';
import type { AuditRule, AuditResult, RuleViolation } from '../types';
import { RULE_DEFINITIONS } from '../types';

// ─── Configuration ──────────────────────────────────────────────

interface P3Config {
  /** Time window to look for retries after a failure (ms). Default: 10000 */
  retryWindowMs: number;
  /** HTTP status codes considered as failures. Default: 408, 429, 500-599 */
  failureStatuses: (number | [number, number])[];
  /** Also flag network errors (no response). Default: true */
  flagNetworkErrors: boolean;
}

const DEFAULT_P3_CONFIG: P3Config = {
  retryWindowMs: 10000,
  failureStatuses: [408, 429, [500, 599]],
  flagNetworkErrors: true,
};

// ─── Unrecovered Failure ────────────────────────────────────────

interface UnrecoveredFailure {
  request: FluxRequestRecord;
  pattern: string;
  statusCode: number | null; // null = network error
  errorType: 'server_error' | 'client_error' | 'network_error' | 'timeout';
  hasRetry: boolean;
}

// ─── Detection Logic ────────────────────────────────────────────

function isFailureStatus(status: number, config: P3Config): boolean {
  for (const entry of config.failureStatuses) {
    if (typeof entry === 'number') {
      if (status === entry) return true;
    } else {
      if (status >= entry[0] && status <= entry[1]) return true;
    }
  }
  return false;
}

function detectMissingRecovery(
  requests: FluxRequestRecord[],
  config: P3Config,
): UnrecoveredFailure[] {
  const apiRequests = requests.filter(r =>
    r.type === 'api-rest' || r.type === 'api-graphql'
  );

  const sorted = apiRequests.slice().sort((a, b) => a.startTime - b.startTime);
  const results: UnrecoveredFailure[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const req = sorted[i];
    let isFailed = false;
    let statusCode: number | null = null;
    let errorType: UnrecoveredFailure['errorType'] = 'server_error';

    // Check for network error
    if (req.error !== null || req.response === null) {
      if (!config.flagNetworkErrors) continue;
      isFailed = true;
      errorType = 'network_error';
    }
    // Check for failure status
    else if (isFailureStatus(req.response.status, config)) {
      isFailed = true;
      statusCode = req.response.status;
      if (statusCode === 408) errorType = 'timeout';
      else if (statusCode >= 500) errorType = 'server_error';
      else errorType = 'client_error';
    }

    if (!isFailed) continue;

    // Look for a retry to the same endpoint within window
    const pattern = `${req.method}|${req.urlParts.pathPattern}`;
    let hasRetry = false;

    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].startTime > req.startTime + config.retryWindowMs) break;
      const retryPattern = `${sorted[j].method}|${sorted[j].urlParts.pathPattern}`;
      if (retryPattern === pattern) {
        hasRetry = true;
        break;
      }
    }

    if (!hasRetry) {
      results.push({
        request: req,
        pattern: req.urlParts.pathPattern,
        statusCode, errorType, hasRetry,
      });
    }
  }

  return results;
}

// ─── Violation Builder ──────────────────────────────────────────

function failureToViolation(failures: UnrecoveredFailure[]): RuleViolation[] {
  // Group by pattern
  const groups = new Map<string, UnrecoveredFailure[]>();
  for (const f of failures) {
    const key = `${f.request.method}|${f.pattern}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  return Array.from(groups.entries()).map(([key, grp]) => {
    const [method, pattern] = key.split('|');
    const components = [...new Set(
      grp.map(f => f.request.initiator.componentName).filter(Boolean) as string[]
    )];
    const errorTypes = [...new Set(grp.map(f => f.errorType))];

    return {
      ruleId: 'P3' as const,
      title: `No retry: ${method} ${pattern} (${grp.length} unrecovered failure${grp.length > 1 ? 's' : ''})`,
      description:
        `"${method} ${pattern}" failed ${grp.length} time(s) (${errorTypes.join(', ')}) ` +
        `with no retry attempt detected. Add retry logic with exponential backoff ` +
        `(e.g., TanStack Query retry: 3) to handle transient failures gracefully.`,
      severity: 'info' as const,
      affectedRequests: grp.map(f => f.request),
      affectedEndpoints: [pattern],
      affectedComponents: components,
      impact: {
        timeSavedMs: 0,
        requestsEliminated: 0,
        bandwidthSavedBytes: 0,
        monthlyCostSavings: 0,
      },
      metadata: {
        pattern, method,
        failureCount: grp.length,
        errorTypes,
        statusCodes: grp.map(f => f.statusCode).filter(Boolean),
      },
    };
  });
}

// ─── Rule Implementation ────────────────────────────────────────

export function createP3Rule(config?: Partial<P3Config>): AuditRule {
  const cfg = { ...DEFAULT_P3_CONFIG, ...config };
  const definition = RULE_DEFINITIONS.P3;

  return {
    definition,
    analyze(session: FluxScanSession): AuditResult {
      const start = performance.now();
      const apiRequests = session.requests.filter(r =>
        r.type === 'api-rest' || r.type === 'api-graphql'
      );

      const failures = detectMissingRecovery(session.requests, cfg);
      const violations = failureToViolation(failures);

      const affectedIds = new Set(failures.map(f => f.request.id));
      const ratio = apiRequests.length > 0 ? affectedIds.size / apiRequests.length : 0;
      const score = definition.maxWeight * (1 - 0.4 * Math.min(ratio, 1)); // info severity

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
