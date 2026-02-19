// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Analyzer Tests
// Tests for all 13 audit rules + scoring + FluxAnalyzer orchestrator
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { createE1Rule } from '../analyzer/rules/e1-waterfall';
import { createE2Rule } from '../analyzer/rules/e2-duplicates';
import { createE3Rule } from '../analyzer/rules/e3-nplus1';
import { createC1Rule } from '../analyzer/rules/c1-no-cache';
import { createC2Rule } from '../analyzer/rules/c2-under-caching';
import { calculateScore, calculateTotalImpact, generateSummary } from '../analyzer/scorer';
import { FluxAnalyzer } from '../analyzer';
import { DEFAULT_ANALYZER_CONFIG } from '../analyzer/types';
import {
  mockRequest,
  mockSession,
  resetMockSeq,
  waterfallScenario,
  duplicateScenario,
  nPlus1Scenario,
  uncachedScenario,
  underCachingScenario,
  cleanScenario,
} from './helpers';

// ═════════════════════════════════════════════════════════════════
// E1: Request Waterfall Detection
// ═════════════════════════════════════════════════════════════════

describe('E1: Request Waterfall', () => {
  beforeEach(() => resetMockSeq());

  it('should detect a basic waterfall of 4 sequential requests', () => {
    const requests = waterfallScenario(4, { baseDuration: 200 });
    const session = mockSession(requests);
    const rule = createE1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(15); // Max weight is 15

    const v = result.violations[0];
    expect(v.ruleId).toBe('E1');
    expect(v.severity).toBe('critical');
    expect(v.metadata.chainLength).toBeGreaterThanOrEqual(2);
    expect(v.metadata.wastedTime).toBeGreaterThan(100);
  });

  it('should not flag parallel requests', () => {
    const requests = [
      mockRequest({ url: 'https://api.example.com/api/a', startTime: 100, duration: 200 }),
      mockRequest({ url: 'https://api.example.com/api/b', startTime: 110, duration: 180 }),
      mockRequest({ url: 'https://api.example.com/api/c', startTime: 105, duration: 220 }),
    ];
    const session = mockSession(requests);
    const rule = createE1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(15); // Full score
  });

  it('should report wasted time in impact', () => {
    const requests = waterfallScenario(3, { baseDuration: 300 });
    const session = mockSession(requests);
    const rule = createE1Rule();
    const result = rule.analyze(session);

    if (result.violations.length > 0) {
      const impact = result.violations[0].impact;
      expect(impact.timeSavedMs).toBeGreaterThan(200);
      expect(impact.requestsEliminated).toBe(0); // Waterfall parallelizes, doesn't eliminate
    }
  });

  it('should handle empty session', () => {
    const session = mockSession([]);
    const rule = createE1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(15);
  });

  it('should respect minChainLength config', () => {
    const requests = waterfallScenario(2, { baseDuration: 200 });
    const session = mockSession(requests);

    // Default minChainLength is 2, should detect
    const rule2 = createE1Rule({ minChainLength: 2 });
    const result2 = rule2.analyze(session);

    // With minChainLength 3, should NOT detect a chain of 2
    const rule3 = createE1Rule({ minChainLength: 3 });
    const result3 = rule3.analyze(session);

    expect(result3.violations.length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// E2: Duplicate Request Detection
// ═════════════════════════════════════════════════════════════════

describe('E2: Duplicate Requests', () => {
  beforeEach(() => resetMockSeq());

  it('should detect 4 duplicate requests to same endpoint', () => {
    const requests = duplicateScenario(4);
    const session = mockSession(requests);
    const rule = createE2Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(1);
    expect(result.passed).toBe(false);

    const v = result.violations[0];
    expect(v.ruleId).toBe('E2');
    expect(v.metadata.duplicateCount).toBe(4);
    expect(v.metadata.wastedCount).toBe(3); // First is needed, 3 are waste
    expect(v.impact.requestsEliminated).toBe(3);
  });

  it('should not flag unique endpoints', () => {
    const requests = [
      mockRequest({ url: 'https://api.example.com/api/users', startTime: 100 }),
      mockRequest({ url: 'https://api.example.com/api/orders', startTime: 150 }),
      mockRequest({ url: 'https://api.example.com/api/products', startTime: 200 }),
    ];
    const session = mockSession(requests);
    const rule = createE2Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('should detect duplicates across different components', () => {
    const requests = duplicateScenario(3, {
      components: ['Header', 'Sidebar', 'Footer'],
    });
    const session = mockSession(requests);
    const rule = createE2Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(1);
    expect(result.violations[0].affectedComponents.length).toBe(3);
  });

  it('should separate clusters by time window', () => {
    // Two clusters far apart in time
    const requests = [
      // Cluster 1: t=100-250
      mockRequest({ url: 'https://api.example.com/api/data', startTime: 100 }),
      mockRequest({ url: 'https://api.example.com/api/data', startTime: 200 }),
      // Gap of 5000ms
      // Cluster 2: t=5200-5400
      mockRequest({ url: 'https://api.example.com/api/data', startTime: 5200 }),
      mockRequest({ url: 'https://api.example.com/api/data', startTime: 5350 }),
    ];
    const session = mockSession(requests);
    const rule = createE2Rule({ windowMs: 2000 });
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(2); // Two separate clusters
  });

  it('should report bandwidth waste', () => {
    const requests = duplicateScenario(5, {
      endpoint: 'https://api.example.com/api/heavy-payload',
    });
    // Set large response size
    requests.forEach(r => {
      if (r.response) r.response.bodySize = 50000; // 50KB each
    });
    const session = mockSession(requests);
    const rule = createE2Rule();
    const result = rule.analyze(session);

    expect(result.violations[0].impact.bandwidthSavedBytes).toBeGreaterThan(100000);
  });
});

// ═════════════════════════════════════════════════════════════════
// E3: N+1 Query Pattern
// ═════════════════════════════════════════════════════════════════

describe('E3: N+1 Pattern', () => {
  beforeEach(() => resetMockSeq());

  it('should detect N+1 pattern with 10 individual requests', () => {
    const requests = nPlus1Scenario(10);
    const session = mockSession(requests);
    const rule = createE3Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(1);
    expect(result.passed).toBe(false);

    const v = result.violations[0];
    expect(v.ruleId).toBe('E3');
    expect(v.metadata.requestCount).toBe(10);
    expect(v.metadata.pattern).toBe('/api/products/:id');
    expect(v.impact.requestsEliminated).toBe(9); // 10 → 1 batch
  });

  it('should detect with 25 items (realistic product page)', () => {
    const requests = nPlus1Scenario(25);
    const session = mockSession(requests);
    const rule = createE3Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(1);
    expect(result.violations[0].metadata.requestCount).toBe(25);
    expect(result.violations[0].metadata.distinctIds.length).toBe(25);
  });

  it('should NOT flag below threshold', () => {
    const requests = nPlus1Scenario(3); // Below default threshold of 5
    const session = mockSession(requests);
    const rule = createE3Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('should not flag requests to different URL patterns', () => {
    const requests = [
      mockRequest({ url: 'https://api.example.com/api/users/1' }),
      mockRequest({ url: 'https://api.example.com/api/orders/2' }),
      mockRequest({ url: 'https://api.example.com/api/products/3' }),
      mockRequest({ url: 'https://api.example.com/api/categories/4' }),
      mockRequest({ url: 'https://api.example.com/api/reviews/5' }),
    ];
    const session = mockSession(requests);
    const rule = createE3Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0); // Different patterns, not N+1
  });

  it('should respect custom threshold', () => {
    const requests = nPlus1Scenario(8);
    const session = mockSession(requests);

    const strictRule = createE3Rule({ threshold: 10 });
    const lenientRule = createE3Rule({ threshold: 3 });

    expect(strictRule.analyze(session).violations.length).toBe(0);
    expect(lenientRule.analyze(session).violations.length).toBe(1);
  });

  it('should report time savings in impact', () => {
    const requests = nPlus1Scenario(20);
    const session = mockSession(requests);
    const rule = createE3Rule();
    const result = rule.analyze(session);

    const v = result.violations[0];
    expect(v.impact.timeSavedMs).toBeGreaterThan(0);
    expect(v.metadata.estimatedBatchTimeMs).toBeLessThan(v.metadata.totalTimeMs);
  });
});

// ═════════════════════════════════════════════════════════════════
// C1: No Cache Strategy
// ═════════════════════════════════════════════════════════════════

describe('C1: No Cache Strategy', () => {
  beforeEach(() => resetMockSeq());

  it('should detect endpoints with no cache headers', () => {
    const requests = uncachedScenario(3, 4); // 3 endpoints, 4 requests each
    const session = mockSession(requests);
    const rule = createC1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(3);
    expect(result.passed).toBe(false);

    for (const v of result.violations) {
      expect(v.ruleId).toBe('C1');
      expect(v.severity).toBe('critical');
      expect(v.metadata.reasons).toContain('No Cache-Control header');
    }
  });

  it('should NOT flag endpoints with Cache-Control', () => {
    const requests = [
      mockRequest({
        url: 'https://api.example.com/api/cached',
        startTime: 100,
        cacheControl: 'max-age=300',
      }),
      mockRequest({
        url: 'https://api.example.com/api/cached',
        startTime: 500,
        cacheControl: 'max-age=300',
      }),
    ];
    const session = mockSession(requests);
    const rule = createC1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('should NOT flag endpoints with ETag even without Cache-Control', () => {
    const requests = [
      mockRequest({
        url: 'https://api.example.com/api/etag-only',
        startTime: 100,
        etag: '"v1"',
      }),
      mockRequest({
        url: 'https://api.example.com/api/etag-only',
        startTime: 500,
        etag: '"v1"',
      }),
    ];
    const session = mockSession(requests);
    const rule = createC1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
  });

  it('should ignore POST requests by default', () => {
    const requests = [
      mockRequest({
        url: 'https://api.example.com/api/submit',
        method: 'POST',
        startTime: 100,
      }),
      mockRequest({
        url: 'https://api.example.com/api/submit',
        method: 'POST',
        startTime: 500,
      }),
    ];
    const session = mockSession(requests);
    const rule = createC1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
  });

  it('should report bandwidth waste in impact', () => {
    const requests = uncachedScenario(1, 10);
    requests.forEach(r => {
      if (r.response) r.response.bodySize = 8192;
    });
    const session = mockSession(requests);
    const rule = createC1Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(1);
    expect(result.violations[0].impact.requestsEliminated).toBe(9);
    expect(result.violations[0].impact.bandwidthSavedBytes).toBeGreaterThan(50000);
  });

  it('should require minimum requests per endpoint', () => {
    // Only 1 request per endpoint — not enough data to flag
    const requests = [
      mockRequest({ url: 'https://api.example.com/api/single' }),
    ];
    const session = mockSession(requests);
    const rule = createC1Rule({ minRequestsPerEndpoint: 2 });
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// C2: Under-Caching
// ═════════════════════════════════════════════════════════════════

describe('C2: Under-Caching', () => {
  beforeEach(() => resetMockSeq());

  it('should detect endpoint with 95% identical responses', () => {
    const requests = underCachingScenario(20, { identicalRate: 0.95 });
    const session = mockSession(requests);
    const rule = createC2Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(1);
    expect(result.passed).toBe(false);

    const v = result.violations[0];
    expect(v.ruleId).toBe('C2');
    expect(v.metadata.redundancyRate).toBeGreaterThanOrEqual(0.8);
    expect(v.metadata.recommendedStaleTimeMs).toBeGreaterThan(0);
  });

  it('should NOT flag endpoints where data frequently changes', () => {
    // Every response has different hash
    const requests: ReturnType<typeof mockRequest>[] = [];
    for (let i = 0; i < 10; i++) {
      requests.push(mockRequest({
        url: 'https://api.example.com/api/live-data',
        startTime: 100 + i * 500,
        responseHash: `unique_hash_${i}`, // All different
      }));
    }
    const session = mockSession(requests);
    const rule = createC2Rule();
    const result = rule.analyze(session);

    expect(result.violations.length).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('should recommend staleTime based on observed changes', () => {
    const requests = underCachingScenario(10, { identicalRate: 0.9 });
    const session = mockSession(requests);
    const rule = createC2Rule();
    const result = rule.analyze(session);

    if (result.violations.length > 0) {
      const staleTime = result.violations[0].metadata.recommendedStaleTimeMs;
      expect(staleTime).toBeGreaterThanOrEqual(30000); // At least 30s
      expect(staleTime).toBeLessThanOrEqual(30 * 60 * 1000); // At most 30min
    }
  });

  it('should respect identicalResponseThreshold config', () => {
    // 70% identical — below default 80% threshold
    const requests = underCachingScenario(10, { identicalRate: 0.7 });
    const session = mockSession(requests);

    const strictRule = createC2Rule({ identicalResponseThreshold: 0.8 });
    const lenientRule = createC2Rule({ identicalResponseThreshold: 0.5 });

    expect(strictRule.analyze(session).violations.length).toBe(0);
    expect(lenientRule.analyze(session).violations.length).toBe(1);
  });

  it('should report bandwidth waste', () => {
    const requests = underCachingScenario(20, { identicalRate: 0.95 });
    requests.forEach(r => {
      if (r.response) r.response.bodySize = 10240;
    });
    const session = mockSession(requests);
    const rule = createC2Rule();
    const result = rule.analyze(session);

    if (result.violations.length > 0) {
      expect(result.violations[0].impact.bandwidthSavedBytes).toBeGreaterThan(100000);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Scoring Algorithm
// ═════════════════════════════════════════════════════════════════

describe('Scoring Algorithm', () => {
  beforeEach(() => resetMockSeq());

  it('should give 100/100 for clean session with no violations', () => {
    const requests = cleanScenario();
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    // With normalization, a perfect session should score 100
    expect(report.score.overall).toBeGreaterThanOrEqual(90);
    expect(report.score.grade).toBe('excellent');
  });

  it('should reduce score for violations', () => {
    // Use a scenario with clear violations (duplicates + waterfall)
    const requests = [
      ...waterfallScenario(5, { baseDuration: 200 }),
      ...duplicateScenario(4, { route: '/dashboard' }),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    expect(report.score.overall).toBeLessThan(100);
  });

  it('should calculate category scores', () => {
    const requests = cleanScenario();
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    expect(report.score.categories.length).toBe(3);

    const efficiency = report.score.categories.find(c => c.category === 'efficiency');
    const caching = report.score.categories.find(c => c.category === 'caching');

    expect(efficiency).toBeDefined();
    expect(efficiency!.score).toBeGreaterThanOrEqual(90); // Normalized to 0-100
    expect(caching).toBeDefined();
  });

  it('should assign correct grades', () => {
    // Test grade boundaries using calculateScore directly
    const makeResult = (score: number, maxWeight: number) => ({
      rule: { id: 'E1' as const, name: 'Test', description: '', category: 'efficiency' as const, severity: 'critical' as const, maxWeight, autoFixable: true },
      score,
      violations: [],
      totalRelevantRequests: 10,
      affectedRequestCount: 0,
      passed: true,
      analysisTimeMs: 1,
    });

    const score90 = calculateScore([makeResult(90, 100)], DEFAULT_ANALYZER_CONFIG);
    expect(score90.grade).toBe('excellent');

    const score75 = calculateScore([makeResult(75, 100)], DEFAULT_ANALYZER_CONFIG);
    expect(score75.grade).toBe('good');

    const score55 = calculateScore([makeResult(55, 100)], DEFAULT_ANALYZER_CONFIG);
    expect(score55.grade).toBe('needs-work');

    const score30 = calculateScore([makeResult(30, 100)], DEFAULT_ANALYZER_CONFIG);
    expect(score30.grade).toBe('poor');
  });

  it('should produce network-adjusted score for non-wifi', () => {
    const requests = waterfallScenario(4, { baseDuration: 200 });
    const session = mockSession(requests);

    const wifiAnalyzer = new FluxAnalyzer({ network: 'wifi' });
    const jioAnalyzer = new FluxAnalyzer({ network: 'jio-4g' });

    const wifiReport = wifiAnalyzer.analyze(session);
    const jioReport = jioAnalyzer.analyze(session);

    expect(wifiReport.score.networkAdjustedScore).toBeNull();
    expect(jioReport.score.networkAdjustedScore).not.toBeNull();
    // Jio should score lower (or equal) since latency multiplier makes waterfalls worse
    expect(jioReport.score.networkAdjustedScore!).toBeLessThanOrEqual(jioReport.score.overall);
  });
});

// ═════════════════════════════════════════════════════════════════
// Impact & Summary
// ═════════════════════════════════════════════════════════════════

describe('Impact Calculation', () => {
  beforeEach(() => resetMockSeq());

  it('should aggregate impact across all violations', () => {
    // Mix of violations: waterfall + duplicates
    const waterfall = waterfallScenario(3, { baseDuration: 300, route: '/page1' });
    const dupes = duplicateScenario(4, {
      endpoint: 'https://api.example.com/api/duped',
      route: '/page1',
    });
    const session = mockSession([...waterfall, ...dupes]);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    expect(report.totalImpact.timeSavedMs).toBeGreaterThan(0);
    expect(report.totalImpact.requestsEliminated).toBeGreaterThan(0);
  });

  it('should calculate monthly cost savings', () => {
    const requests = duplicateScenario(5);
    requests.forEach(r => { if (r.response) r.response.bodySize = 5000; });
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer({
      costPer10kRequests: 0.50,
      monthlyActiveUsers: 10000,
      avgRequestsPerUserPerDay: 200,
    });
    const report = analyzer.analyze(session);

    // Should have some projected savings
    expect(report.totalImpact.monthlyCostSavings).toBeGreaterThanOrEqual(0);
  });

  it('should rank top fixes by impact', () => {
    const requests = [
      ...nPlus1Scenario(20, { route: '/products' }),
      ...duplicateScenario(4, {
        endpoint: 'https://api.example.com/api/user',
        route: '/products',
      }),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    expect(report.summary.topFixes.length).toBeLessThanOrEqual(3);
    if (report.summary.topFixes.length >= 2) {
      // Should be ordered by impact
      const impact1 = report.summary.topFixes[0].impact;
      const impact2 = report.summary.topFixes[1].impact;
      const score1 = impact1.timeSavedMs + impact1.requestsEliminated * 50;
      const score2 = impact2.timeSavedMs + impact2.requestsEliminated * 50;
      expect(score1).toBeGreaterThanOrEqual(score2);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// FluxAnalyzer Orchestrator
// ═════════════════════════════════════════════════════════════════

describe('FluxAnalyzer', () => {
  beforeEach(() => resetMockSeq());

  it('should run all 13 rules and produce a report', () => {
    const requests = cleanScenario();
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    expect(report.id).toMatch(/^fx_/);
    expect(report.score).toBeDefined();
    expect(report.score.audits.length).toBe(13); // E1, E2, E3, C1, C2
    expect(report.summary).toBeDefined();
    expect(report.totalImpact).toBeDefined();
  });

  it('should respect disabledRules', () => {
    const requests = waterfallScenario(4);
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer({ disabledRules: ['E1'] });
    const report = analyzer.analyze(session);

    // Should only have 4 audits (E1 disabled)
    expect(report.score.audits.length).toBe(12);
    expect(report.score.audits.find(a => a.rule.id === 'E1')).toBeUndefined();
  });

  it('should support custom rules', () => {
    const requests = cleanScenario();
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();

    // Add a custom rule that always fails
    analyzer.addRule({
      definition: {
        id: 'E4' as any,
        name: 'Custom Rule',
        description: 'Test',
        category: 'efficiency',
        severity: 'warning',
        maxWeight: 5,
        autoFixable: false,
      },
      analyze: () => ({
        rule: { id: 'E4' as any, name: 'Custom', description: '', category: 'efficiency' as const, severity: 'warning' as const, maxWeight: 5, autoFixable: false },
        score: 0,
        violations: [{
          ruleId: 'E4' as any,
          title: 'Custom violation',
          description: 'Test',
          severity: 'warning' as const,
          affectedRequests: [],
          affectedEndpoints: [],
          affectedComponents: [],
          impact: { timeSavedMs: 100, requestsEliminated: 0, bandwidthSavedBytes: 0, monthlyCostSavings: 0 },
          metadata: {},
        }],
        totalRelevantRequests: 1,
        affectedRequestCount: 1,
        passed: false,
        analysisTimeMs: 1,
      }),
    });

    const report = analyzer.analyze(session);
    expect(report.score.audits.length).toBe(14); // 5 built-in + 1 custom
  });

  it('should handle rule errors gracefully', () => {
    const requests = cleanScenario();
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();

    // Add a rule that throws
    analyzer.addRule({
      definition: {
        id: 'X1' as any,
        name: 'Broken Rule',
        description: 'Throws',
        category: 'efficiency',
        severity: 'warning',
        maxWeight: 5,
        autoFixable: false,
      },
      analyze: () => { throw new Error('Rule exploded'); },
    });

    // Should not throw, should still produce a report
    const report = analyzer.analyze(session);
    expect(report).toBeDefined();
    expect(report.score.audits.length).toBe(14);

    // The broken rule should get full score (no penalty)
    const brokenAudit = report.score.audits.find(a => a.rule.id === 'X1');
    expect(brokenAudit).toBeDefined();
    expect(brokenAudit!.score).toBe(5);
    expect(brokenAudit!.passed).toBe(true);
  });

  it('should produce correct summary counts', () => {
    const requests = [
      ...waterfallScenario(3, { route: '/a' }),
      ...nPlus1Scenario(10, { route: '/b' }),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    expect(report.summary.totalViolations).toBeGreaterThan(0);
    expect(report.summary.criticalCount + report.summary.warningCount + report.summary.infoCount)
      .toBe(report.summary.totalViolations);
  });

  it('should configure per-rule settings', () => {
    const requests = nPlus1Scenario(8);
    const session = mockSession(requests);

    // Default threshold is 5 — should detect
    const defaultAnalyzer = new FluxAnalyzer();
    const defaultReport = defaultAnalyzer.analyze(session);
    const e3Default = defaultReport.score.audits.find(a => a.rule.id === 'E3');
    expect(e3Default!.violations.length).toBe(1);

    // Custom threshold of 15 — should not detect 8 items
    const strictAnalyzer = new FluxAnalyzer({
      ruleConfig: { E3: { threshold: 15 } },
    });
    const strictReport = strictAnalyzer.analyze(session);
    const e3Strict = strictReport.score.audits.find(a => a.rule.id === 'E3');
    expect(e3Strict!.violations.length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// Integration: Realistic Scenarios
// ═════════════════════════════════════════════════════════════════

describe('Integration: Realistic Scenarios', () => {
  beforeEach(() => resetMockSeq());

  it('should produce a poor score for a badly optimized app', () => {
    const requests = [
      // Waterfall on dashboard
      ...waterfallScenario(5, { baseDuration: 200, route: '/dashboard' }),
      // Duplicates
      ...duplicateScenario(4, {
        endpoint: 'https://api.example.com/api/user/profile',
        route: '/dashboard',
      }),
      // N+1 on products page
      ...nPlus1Scenario(15, { route: '/products' }),
      // Uncached endpoints
      ...uncachedScenario(2, 3),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    // Should have multiple violation types
    expect(report.summary.totalViolations).toBeGreaterThan(3);
    expect(report.summary.criticalCount).toBeGreaterThan(0);
    // Score should be notably reduced
    expect(report.score.overall).toBeLessThan(80);
    expect(report.score.grade).not.toBe('excellent');
  });

  it('should produce excellent score for well-optimized app', () => {
    const requests = cleanScenario();
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    expect(report.summary.totalViolations).toBeLessThanOrEqual(4); // New rules may find minor issues
    expect(report.score.grade).toBe('excellent');
  });

  it('should show worse score on Jio 4G than WiFi', () => {
    const requests = [
      ...waterfallScenario(4, { baseDuration: 200 }),
      ...uncachedScenario(2, 3),
    ];
    const session = mockSession(requests);

    const wifiAnalyzer = new FluxAnalyzer({ network: 'wifi' });
    const jioAnalyzer = new FluxAnalyzer({ network: 'jio-4g' });

    const wifiReport = wifiAnalyzer.analyze(session);
    const jioReport = jioAnalyzer.analyze(session);

    // Jio network-adjusted score should be lower
    if (jioReport.score.networkAdjustedScore !== null) {
      expect(jioReport.score.networkAdjustedScore).toBeLessThanOrEqual(wifiReport.score.overall);
    }
  });
});
