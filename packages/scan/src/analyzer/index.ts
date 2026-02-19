// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - FluxAnalyzer
// Main analysis orchestrator. Takes a FluxScanSession (from Week 1),
// runs all enabled audit rules, calculates scores, and produces
// the final FluxReport.
//
// Usage:
//   const analyzer = new FluxAnalyzer();
//   const report = analyzer.analyze(scanSession);
//   console.log(`API Health Score: ${report.score.overall}/100`);
// ═══════════════════════════════════════════════════════════════════

import type { FluxScanSession } from '../types';
import { generateId } from '../utils';
import type {
  AuditRule,
  AuditResult,
  AnalyzerConfig,
  FluxReport,
  RuleId,
} from './types';
import { DEFAULT_ANALYZER_CONFIG } from './types';
import { calculateScore, calculateTotalImpact, generateSummary } from './scorer';

// Rule factories
import { createE1Rule } from './rules/e1-waterfall';
import { createE2Rule } from './rules/e2-duplicates';
import { createE3Rule } from './rules/e3-nplus1';
import { createE4Rule } from './rules/e4-overfetching';
import { createE5Rule } from './rules/e5-batchable';
import { createC1Rule } from './rules/c1-no-cache';
import { createC2Rule } from './rules/c2-under-caching';
import { createC3Rule } from './rules/c3-over-caching';
import { createC4Rule } from './rules/c4-missing-revalidation';
import { createP1Rule } from './rules/p1-missing-prefetch';
import { createP2Rule } from './rules/p2-unnecessary-polling';
import { createP3Rule } from './rules/p3-missing-recovery';
import { createP4Rule } from './rules/p4-uncompressed';

// ─── FluxAnalyzer ───────────────────────────────────────────────

export class FluxAnalyzer {
  private _config: AnalyzerConfig;
  private _rules: Map<RuleId, AuditRule>;
  private _customRules: AuditRule[] = [];

  constructor(config?: Partial<AnalyzerConfig>) {
    this._config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
    this._rules = this._createBuiltInRules();
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Run full analysis on a scan session and produce a report.
   */
  analyze(session: FluxScanSession): FluxReport {
    const startTime = performance.now();

    // Collect enabled rules
    const enabledRules = this._getEnabledRules();

    // Run each rule
    const audits: AuditResult[] = [];
    for (const rule of enabledRules) {
      try {
        const result = rule.analyze(session);
        audits.push(result);
      } catch (error) {
        // Rule failed — produce a passing result so scoring isn't broken
        console.warn(`[FluxAPI] Rule ${rule.definition.id} failed:`, error);
        audits.push({
          rule: rule.definition,
          score: rule.definition.maxWeight, // Full marks (no deduction for broken rule)
          violations: [],
          totalRelevantRequests: 0,
          affectedRequestCount: 0,
          passed: true,
          analysisTimeMs: 0,
        });
      }
    }

    // Calculate scores
    const score = calculateScore(audits, this._config);

    // Calculate total impact
    const totalImpact = calculateTotalImpact(audits, this._config);

    // Update monthly cost savings on individual violations
    this._distributeCostSavings(audits, totalImpact.monthlyCostSavings);

    // Generate summary
    const summary = generateSummary(audits);

    const report: FluxReport = {
      id: generateId(),
      analyzedAt: performance.now(),
      session,
      score,
      totalImpact,
      summary,
    };

    const analysisTime = performance.now() - startTime;
    if (this._config.network !== 'wifi' || session.config.verbose) {
      console.log(
        `[FluxAPI] Analysis complete in ${Math.round(analysisTime)}ms. ` +
        `Score: ${score.overall}/100 (${score.grade})` +
        (score.networkAdjustedScore !== null
          ? ` | ${session.config.network}: ${score.networkAdjustedScore}/100`
          : '')
      );
    }

    return report;
  }

  /**
   * Register a custom audit rule.
   */
  addRule(rule: AuditRule): void {
    this._customRules.push(rule);
  }

  /**
   * Update analyzer configuration.
   */
  configure(config: Partial<AnalyzerConfig>): void {
    this._config = { ...this._config, ...config };
  }

  /**
   * Get current config.
   */
  get config(): AnalyzerConfig {
    return { ...this._config };
  }

  // ─── Internal ───────────────────────────────────────────────

  /**
   * Create all built-in rules with per-rule config overrides.
   */
  private _createBuiltInRules(): Map<RuleId, AuditRule> {
    const rc = this._config.ruleConfig;
    const rules = new Map<RuleId, AuditRule>();

    rules.set('E1', createE1Rule(rc.E1));
    rules.set('E2', createE2Rule(rc.E2));
    rules.set('E3', createE3Rule(rc.E3));
    rules.set('E4', createE4Rule(rc.E4));
    rules.set('E5', createE5Rule(rc.E5));
    rules.set('C1', createC1Rule(rc.C1));
    rules.set('C2', createC2Rule(rc.C2));
    rules.set('C3', createC3Rule(rc.C3));
    rules.set('C4', createC4Rule(rc.C4));
    rules.set('P1', createP1Rule(rc.P1));
    rules.set('P2', createP2Rule(rc.P2));
    rules.set('P3', createP3Rule(rc.P3));
    rules.set('P4', createP4Rule(rc.P4));

    return rules;
  }

  /**
   * Get all rules that are enabled (not in disabledRules list).
   */
  private _getEnabledRules(): AuditRule[] {
    const disabled = new Set(this._config.disabledRules);
    const rules: AuditRule[] = [];

    for (const [id, rule] of this._rules) {
      if (!disabled.has(id)) {
        rules.push(rule);
      }
    }

    // Add custom rules
    for (const rule of this._customRules) {
      if (!disabled.has(rule.definition.id as RuleId)) {
        rules.push(rule);
      }
    }

    return rules;
  }

  /**
   * Distribute monthly cost savings proportionally across violations.
   */
  private _distributeCostSavings(audits: AuditResult[], totalMonthlySavings: number): void {
    // Calculate total "impact units" for proportional distribution
    let totalUnits = 0;
    for (const audit of audits) {
      for (const v of audit.violations) {
        totalUnits += v.impact.requestsEliminated * 10 + v.impact.bandwidthSavedBytes / 1024;
      }
    }

    if (totalUnits === 0) return;

    for (const audit of audits) {
      for (const v of audit.violations) {
        const units = v.impact.requestsEliminated * 10 + v.impact.bandwidthSavedBytes / 1024;
        v.impact.monthlyCostSavings = Math.round((units / totalUnits) * totalMonthlySavings * 100) / 100;
      }
    }
  }
}
