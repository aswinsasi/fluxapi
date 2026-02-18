// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Analysis Types
// Data model for audit rules, violations, scoring, and reports
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, FluxScanSession, NetworkProfile } from '../types';

// ─── Rule Definition ────────────────────────────────────────────

export type RuleId =
  | 'E1' | 'E2' | 'E3' | 'E4' | 'E5'   // Efficiency
  | 'C1' | 'C2' | 'C3' | 'C4'           // Caching
  | 'P1' | 'P2' | 'P3' | 'P4';          // Patterns

export type RuleCategory = 'efficiency' | 'caching' | 'patterns';
export type RuleSeverity = 'critical' | 'warning' | 'info';

export interface RuleDefinition {
  id: RuleId;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  /** Maximum weight contribution to overall score (0-100) */
  maxWeight: number;
  /** Whether Flux Fix can generate code to fix this */
  autoFixable: boolean | 'partial';
}

/** All 13 audit rules with their definitions */
export const RULE_DEFINITIONS: Record<RuleId, RuleDefinition> = {
  E1: { id: 'E1', name: 'Request Waterfall', description: 'Sequential requests that could run in parallel', category: 'efficiency', severity: 'critical', maxWeight: 15, autoFixable: true },
  E2: { id: 'E2', name: 'Duplicate Requests', description: 'Same data fetched multiple times simultaneously', category: 'efficiency', severity: 'critical', maxWeight: 15, autoFixable: true },
  E3: { id: 'E3', name: 'N+1 Query Pattern', description: 'Individual requests per list item instead of batch', category: 'efficiency', severity: 'critical', maxWeight: 12, autoFixable: true },
  E4: { id: 'E4', name: 'Payload Over-fetching', description: 'Response fields that are never accessed', category: 'efficiency', severity: 'warning', maxWeight: 8, autoFixable: 'partial' },
  E5: { id: 'E5', name: 'Batchable Requests', description: 'Requests to same service that could be combined', category: 'efficiency', severity: 'warning', maxWeight: 5, autoFixable: true },
  C1: { id: 'C1', name: 'No Cache Strategy', description: 'Endpoints with zero caching configuration', category: 'caching', severity: 'critical', maxWeight: 12, autoFixable: true },
  C2: { id: 'C2', name: 'Under-Caching', description: 'Data refreshed far more often than it changes', category: 'caching', severity: 'warning', maxWeight: 8, autoFixable: true },
  C3: { id: 'C3', name: 'Over-Caching', description: 'Cache TTL longer than data change frequency', category: 'caching', severity: 'warning', maxWeight: 5, autoFixable: true },
  C4: { id: 'C4', name: 'Missing Revalidation', description: 'Full refetch when conditional request would work', category: 'caching', severity: 'info', maxWeight: 3, autoFixable: 'partial' },
  P1: { id: 'P1', name: 'Missing Prefetch', description: 'Predictable navigations with no data prefetching', category: 'patterns', severity: 'warning', maxWeight: 8, autoFixable: true },
  P2: { id: 'P2', name: 'Unnecessary Polling', description: 'Polling frequency far exceeds data change rate', category: 'patterns', severity: 'warning', maxWeight: 5, autoFixable: 'partial' },
  P3: { id: 'P3', name: 'Missing Error Recovery', description: 'No retry or fallback on request failures', category: 'patterns', severity: 'info', maxWeight: 3, autoFixable: true },
  P4: { id: 'P4', name: 'Uncompressed Responses', description: 'Responses not using gzip/brotli compression', category: 'patterns', severity: 'info', maxWeight: 3, autoFixable: 'partial' },
};

// ─── Rule Violation ─────────────────────────────────────────────

export interface RuleViolation {
  /** Which rule this violates */
  ruleId: RuleId;
  /** Human-readable title for this specific violation */
  title: string;
  /** Detailed explanation */
  description: string;
  /** Severity inherited from rule, can be overridden */
  severity: RuleSeverity;
  /** Requests involved in this violation */
  affectedRequests: FluxRequestRecord[];
  /** Endpoint patterns involved */
  affectedEndpoints: string[];
  /** Components that triggered these requests */
  affectedComponents: string[];
  /** Estimated impact if fixed */
  impact: ViolationImpact;
  /** Metadata specific to each rule type */
  metadata: Record<string, any>;
}

export interface ViolationImpact {
  /** Estimated time savings per page load (ms) */
  timeSavedMs: number;
  /** Estimated requests eliminated per page load */
  requestsEliminated: number;
  /** Estimated bandwidth saved per page load (bytes) */
  bandwidthSavedBytes: number;
  /** Estimated monthly cost savings (USD, rough) */
  monthlyCostSavings: number;
}

// ─── Audit Result (per rule) ────────────────────────────────────

export interface AuditResult {
  /** Rule definition */
  rule: RuleDefinition;
  /** Score for this rule (0 to rule.maxWeight) */
  score: number;
  /** All violations found */
  violations: RuleViolation[];
  /** Total requests analyzed for this rule */
  totalRelevantRequests: number;
  /** Total requests with violations */
  affectedRequestCount: number;
  /** Whether this rule passed (no critical violations) */
  passed: boolean;
  /** Execution time for this rule (ms) */
  analysisTimeMs: number;
}

// ─── Rule Interface ─────────────────────────────────────────────

export interface AuditRule {
  /** Rule definition */
  definition: RuleDefinition;
  /** Run the analysis on a scan session */
  analyze(session: FluxScanSession): AuditResult;
}

// ─── Scoring ────────────────────────────────────────────────────

export interface CategoryScore {
  category: RuleCategory;
  label: string;
  score: number;       // 0-100 normalized
  maxScore: number;    // Sum of maxWeights for rules in this category
  rawScore: number;    // Sum of actual rule scores
}

export interface FluxScore {
  /** Overall API Health Score (0-100) */
  overall: number;
  /** Per-category scores */
  categories: CategoryScore[];
  /** Per-rule audit results */
  audits: AuditResult[];
  /** Grade based on score */
  grade: 'excellent' | 'good' | 'needs-work' | 'poor';
  /** Network profile used for scoring */
  network: NetworkProfile;
  /** Network-adjusted score (if different from wifi) */
  networkAdjustedScore: number | null;
}

// ─── Full Report ────────────────────────────────────────────────

export interface FluxReport {
  /** Report unique ID */
  id: string;
  /** When analysis was performed */
  analyzedAt: number;
  /** The scan session this report is based on */
  session: FluxScanSession;
  /** Scoring results */
  score: FluxScore;
  /** Total estimated impact if all issues fixed */
  totalImpact: ViolationImpact;
  /** Summary statistics */
  summary: ReportSummary;
}

export interface ReportSummary {
  /** Number of critical issues */
  criticalCount: number;
  /** Number of warnings */
  warningCount: number;
  /** Number of info items */
  infoCount: number;
  /** Total violations across all rules */
  totalViolations: number;
  /** Number of auto-fixable violations */
  autoFixableCount: number;
  /** Top 3 most impactful fixes */
  topFixes: Array<{
    ruleId: RuleId;
    title: string;
    impact: ViolationImpact;
  }>;
}

// ─── Analyzer Configuration ─────────────────────────────────────

export interface AnalyzerConfig {
  /** Rules to skip */
  disabledRules: RuleId[];
  /** Per-rule config overrides */
  ruleConfig: Partial<Record<RuleId, Record<string, any>>>;
  /** Network profile for score adjustment */
  network: NetworkProfile;
  /** Cost per 10,000 API requests (USD) for savings calculation */
  costPer10kRequests: number;
  /** Average requests per user per day (for monthly projection) */
  avgRequestsPerUserPerDay: number;
  /** Monthly active users (for cost projection) */
  monthlyActiveUsers: number;
}

export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  disabledRules: [],
  ruleConfig: {},
  network: 'wifi',
  costPer10kRequests: 0.10,
  avgRequestsPerUserPerDay: 200,
  monthlyActiveUsers: 1000,
};
