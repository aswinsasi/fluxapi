// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Scoring Algorithm
// Calculates overall API Health Score (0-100), category breakdowns,
// network-adjusted scores, and cost projections.
//
// Score formula per rule:
//   rule_score = maxWeight * (1 - severityFactor * violationRatio)
//
// Where:
//   severityFactor: critical=1.0, warning=0.7, info=0.4
//   violationRatio: affected_requests / total_relevant_requests
//
// Overall score = sum of all rule scores (bounded 0-100)
// ═══════════════════════════════════════════════════════════════════

import type { NetworkProfile } from '../types';
import { NETWORK_PROFILES } from '../types';
import type {
  AuditResult,
  FluxScore,
  CategoryScore,
  RuleCategory,
  ViolationImpact,
  AnalyzerConfig,
} from './types';

// ─── Severity Factors ───────────────────────────────────────────

const SEVERITY_FACTORS = {
  critical: 1.0,
  warning: 0.7,
  info: 0.4,
} as const;

// ─── Category Labels ────────────────────────────────────────────

const CATEGORY_LABELS: Record<RuleCategory, string> = {
  efficiency: 'Efficiency',
  caching: 'Caching',
  patterns: 'Patterns',
};

// ─── Score Calculator ───────────────────────────────────────────

/**
 * Calculate the full FluxScore from audit results.
 */
export function calculateScore(
  audits: AuditResult[],
  config: AnalyzerConfig,
): FluxScore {
  // Raw score = sum of all rule scores
  const rawScore = audits.reduce((sum, a) => sum + a.score, 0);
  // Max achievable = sum of all maxWeights for enabled rules
  const maxAchievable = audits.reduce((sum, a) => sum + a.rule.maxWeight, 0);
  // Normalize to 0-100
  const overall = maxAchievable > 0 ? (rawScore / maxAchievable) * 100 : 100;

  // Category scores
  const categories = calculateCategoryScores(audits);

  // Grade
  const grade = scoreToGrade(overall);

  // Network-adjusted score
  const maxAchievable2 = maxAchievable; // For closure
  const networkAdjustedScore = config.network !== 'wifi'
    ? calculateNetworkAdjustedScore(audits, config.network, maxAchievable2)
    : null;

  return {
    overall: Math.round(overall * 10) / 10,
    categories,
    audits,
    grade,
    network: config.network,
    networkAdjustedScore,
  };
}

// ─── Category Scores ────────────────────────────────────────────

function calculateCategoryScores(audits: AuditResult[]): CategoryScore[] {
  const categories: RuleCategory[] = ['efficiency', 'caching', 'patterns'];

  return categories.map(category => {
    const categoryAudits = audits.filter(a => a.rule.category === category);
    const maxScore = categoryAudits.reduce((sum, a) => sum + a.rule.maxWeight, 0);
    const rawScore = categoryAudits.reduce((sum, a) => sum + a.score, 0);

    // Normalize to 0-100 for display
    const normalized = maxScore > 0 ? (rawScore / maxScore) * 100 : 100;

    return {
      category,
      label: CATEGORY_LABELS[category],
      score: Math.round(normalized * 10) / 10,
      maxScore,
      rawScore: Math.round(rawScore * 10) / 10,
    };
  });
}

// ─── Grade Calculation ──────────────────────────────────────────

function scoreToGrade(score: number): FluxScore['grade'] {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'needs-work';
  return 'poor';
}

// ─── Network-Adjusted Scoring ───────────────────────────────────

/**
 * Adjust the score based on network conditions.
 * Waterfalls and large payloads hurt more on slow networks.
 *
 * Adjustment logic:
 * - Efficiency rules (waterfalls, duplicates): multiply time impact by latency multiplier
 * - Caching rules (bandwidth): multiply bandwidth impact by bandwidth multiplier
 * - Pattern rules: moderate adjustment
 */
function calculateNetworkAdjustedScore(
  audits: AuditResult[],
  network: NetworkProfile,
  maxAchievable: number,
): number {
  const profile = NETWORK_PROFILES[network];
  if (!profile) return audits.reduce((sum, a) => sum + a.score, 0);

  let adjustedTotal = 0;

  for (const audit of audits) {
    const { category } = audit.rule;
    let adjustedScore = audit.score;

    if (audit.violations.length > 0) {
      // Calculate how much worse this violation is on the target network
      let penalty = 0;

      if (category === 'efficiency') {
        // Waterfalls/duplicates: latency compounds on slow networks
        // Each sequential request adds more delay
        penalty = (audit.rule.maxWeight - audit.score) * (profile.latencyMultiplier - 1) * 0.5;
      } else if (category === 'caching') {
        // Missing cache: more painful on limited bandwidth
        penalty = (audit.rule.maxWeight - audit.score) * (profile.bandwidthMultiplier - 1) * 0.4;
      } else {
        // Patterns: moderate impact
        penalty = (audit.rule.maxWeight - audit.score) * (profile.latencyMultiplier - 1) * 0.3;
      }

      adjustedScore = Math.max(0, audit.score - penalty);
    }

    adjustedTotal += adjustedScore;
  }

  return Math.round(Math.max(0, Math.min(100, (adjustedTotal / maxAchievable) * 100)) * 10) / 10;
}

// ─── Impact Aggregation ─────────────────────────────────────────

/**
 * Calculate total impact across all violations.
 */
export function calculateTotalImpact(
  audits: AuditResult[],
  config: AnalyzerConfig,
): ViolationImpact {
  let timeSavedMs = 0;
  let requestsEliminated = 0;
  let bandwidthSavedBytes = 0;

  for (const audit of audits) {
    for (const violation of audit.violations) {
      timeSavedMs += violation.impact.timeSavedMs;
      requestsEliminated += violation.impact.requestsEliminated;
      bandwidthSavedBytes += violation.impact.bandwidthSavedBytes;
    }
  }

  // Project monthly cost savings
  // Formula: (requests_eliminated_per_pageload / avg_requests_per_day) * MAU * days * cost_per_10k
  const eliminationRate = config.avgRequestsPerUserPerDay > 0
    ? requestsEliminated / config.avgRequestsPerUserPerDay
    : 0;
  const monthlyRequestsSaved = eliminationRate *
    config.avgRequestsPerUserPerDay *
    config.monthlyActiveUsers *
    30;
  const monthlyCostSavings = (monthlyRequestsSaved / 10000) * config.costPer10kRequests;

  return {
    timeSavedMs: Math.round(timeSavedMs),
    requestsEliminated,
    bandwidthSavedBytes: Math.round(bandwidthSavedBytes),
    monthlyCostSavings: Math.round(monthlyCostSavings * 100) / 100,
  };
}

// ─── Summary Generation ─────────────────────────────────────────

/**
 * Generate the report summary with top fixes ranked by impact.
 */
export function generateSummary(audits: AuditResult[]) {
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let totalViolations = 0;
  let autoFixableCount = 0;

  const allViolations: Array<{
    ruleId: string;
    title: string;
    impact: ViolationImpact;
  }> = [];

  for (const audit of audits) {
    for (const v of audit.violations) {
      totalViolations++;
      if (v.severity === 'critical') criticalCount++;
      else if (v.severity === 'warning') warningCount++;
      else infoCount++;

      if (audit.rule.autoFixable === true) autoFixableCount++;

      allViolations.push({
        ruleId: v.ruleId,
        title: v.title,
        impact: v.impact,
      });
    }
  }

  // Rank by total impact (time + requests + bandwidth combined)
  const ranked = allViolations.sort((a, b) => {
    const aScore = a.impact.timeSavedMs + a.impact.requestsEliminated * 50 + a.impact.bandwidthSavedBytes / 1024;
    const bScore = b.impact.timeSavedMs + b.impact.requestsEliminated * 50 + b.impact.bandwidthSavedBytes / 1024;
    return bScore - aScore;
  });

  return {
    criticalCount,
    warningCount,
    infoCount,
    totalViolations,
    autoFixableCount,
    topFixes: ranked.slice(0, 3).map(v => ({
      ruleId: v.ruleId as any,
      title: v.title,
      impact: v.impact,
    })),
  };
}
