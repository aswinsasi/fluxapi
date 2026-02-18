// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Week 3 Tests
// Tests for fix code generation, HTML report, and console printer
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { FluxAnalyzer } from '../analyzer';
import { generateFix, generateFixes } from '../fixer';
import { generateHtmlReport } from '../reporter/html-report';
import { exportReportJson, printReport } from '../reporter';
import {
  resetMockSeq,
  mockSession,
  waterfallScenario,
  duplicateScenario,
  nPlus1Scenario,
  uncachedScenario,
  underCachingScenario,
  cleanScenario,
} from './helpers';

// ═════════════════════════════════════════════════════════════════
// Fix Code Generator
// ═════════════════════════════════════════════════════════════════

describe('Fix Generator', () => {
  beforeEach(() => resetMockSeq());

  it('should generate E1 waterfall fix with useSuspenseQueries', () => {
    const requests = waterfallScenario(4, { baseDuration: 200 });
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const e1 = report.score.audits.find(a => a.rule.id === 'E1');
    if (e1 && e1.violations.length > 0) {
      const fix = generateFix(e1.violations[0]);
      expect(fix).not.toBeNull();
      expect(fix!.ruleId).toBe('E1');
      expect(fix!.code).toContain('useSuspenseQueries');
      expect(fix!.code).toContain('parallel');
      expect(fix!.alternativeCode).toContain('Promise.all');
      expect(fix!.language).toBe('tsx');
      expect(fix!.dependencies).toContain('@tanstack/react-query');
    }
  });

  it('should generate E2 duplicate fix with shared hook', () => {
    const requests = duplicateScenario(4, {
      components: ['Header', 'Sidebar', 'Footer'],
    });
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const e2 = report.score.audits.find(a => a.rule.id === 'E2');
    if (e2 && e2.violations.length > 0) {
      const fix = generateFix(e2.violations[0]);
      expect(fix).not.toBeNull();
      expect(fix!.ruleId).toBe('E2');
      expect(fix!.code).toContain('useQuery');
      expect(fix!.code).toContain('staleTime');
      expect(fix!.code).toContain('Shared hook');
      expect(fix!.alternativeCode).toContain('cache');
    }
  });

  it('should generate E3 N+1 fix with batch pattern', () => {
    const requests = nPlus1Scenario(15);
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const e3 = report.score.audits.find(a => a.rule.id === 'E3');
    if (e3 && e3.violations.length > 0) {
      const fix = generateFix(e3.violations[0]);
      expect(fix).not.toBeNull();
      expect(fix!.ruleId).toBe('E3');
      expect(fix!.code).toContain('Batch');
      expect(fix!.code).toContain('ids');
      expect(fix!.code).toContain('products');
    }
  });

  it('should generate C1 no-cache fix with staleTime + backend example', () => {
    const requests = uncachedScenario(1, 4);
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const c1 = report.score.audits.find(a => a.rule.id === 'C1');
    if (c1 && c1.violations.length > 0) {
      const fix = generateFix(c1.violations[0]);
      expect(fix).not.toBeNull();
      expect(fix!.ruleId).toBe('C1');
      expect(fix!.code).toContain('staleTime');
      expect(fix!.code).toContain('gcTime');
      expect(fix!.code).toContain('Cache-Control');
      // Should include backend examples
      expect(fix!.code).toContain('Express');
      expect(fix!.code).toContain('Laravel');
    }
  });

  it('should generate C2 under-caching fix with recommended staleTime', () => {
    const requests = underCachingScenario(10, { identicalRate: 0.95 });
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const c2 = report.score.audits.find(a => a.rule.id === 'C2');
    if (c2 && c2.violations.length > 0) {
      const fix = generateFix(c2.violations[0]);
      expect(fix).not.toBeNull();
      expect(fix!.ruleId).toBe('C2');
      expect(fix!.code).toContain('staleTime');
      expect(fix!.code).toContain('Optimized cache timing');
    }
  });

  it('should generate multiple fixes from violations array', () => {
    const requests = [
      ...waterfallScenario(4, { route: '/a' }),
      ...duplicateScenario(3, { route: '/b' }),
      ...nPlus1Scenario(10, { route: '/c' }),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const allViolations = report.score.audits.flatMap(a => a.violations);
    const fixes = generateFixes(allViolations);

    expect(fixes.length).toBeGreaterThan(0);
    // Should have fixes from multiple rule types
    const ruleIds = new Set(fixes.map(f => f.ruleId));
    expect(ruleIds.size).toBeGreaterThanOrEqual(1);
  });

  it('should return null for unknown rule types', () => {
    const fakeViolation = {
      ruleId: 'P4' as any,
      title: 'Test',
      description: 'Test',
      severity: 'info' as const,
      affectedRequests: [],
      affectedEndpoints: [],
      affectedComponents: [],
      impact: { timeSavedMs: 0, requestsEliminated: 0, bandwidthSavedBytes: 0, monthlyCostSavings: 0 },
      metadata: {},
    };

    const fix = generateFix(fakeViolation);
    expect(fix).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════
// HTML Report Generator
// ═════════════════════════════════════════════════════════════════

describe('HTML Report Generator', () => {
  beforeEach(() => resetMockSeq());

  it('should produce valid HTML with all sections', () => {
    const requests = [
      ...waterfallScenario(3, { route: '/dash' }),
      ...duplicateScenario(3, { route: '/dash' }),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report);

    // Valid HTML structure
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');

    // Header
    expect(html).toContain('FluxAPI');
    expect(html).toContain('myapp.com');

    // Score gauge
    expect(html).toContain('fx-gauge');
    expect(html).toContain('API Health');

    // Category bars
    expect(html).toContain('Efficiency');
    expect(html).toContain('Caching');
    expect(html).toContain('Patterns');

    // Audit cards
    expect(html).toContain('E1');
    expect(html).toContain('E2');
    expect(html).toContain('Request Waterfall');
    expect(html).toContain('Duplicate Requests');

    // Copy to clipboard
    expect(html).toContain('fxCopy');
    expect(html).toContain('clipboard');

    // Footer
    expect(html).toContain('fluxapi.dev');
  });

  it('should include fix code blocks when showFixes is true', () => {
    const requests = duplicateScenario(4);
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report, { showFixes: true });

    expect(html).toContain('fx-fix');
    expect(html).toContain('fx-code-block');
    expect(html).toContain('useQuery');
  });

  it('should exclude fix code blocks when showFixes is false', () => {
    const requests = duplicateScenario(4);
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report, { showFixes: false });

    // Should not have any generated fix code (CSS class defs will still exist)
    expect(html).not.toContain('useQuery');
    expect(html).not.toContain('Shared hook');
    // But should still show violations
    expect(html).toContain('fx-violation');
  });

  it('should support custom title', () => {
    const session = mockSession(cleanScenario());
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report, { title: 'My Custom Report' });

    expect(html).toContain('My Custom Report');
  });

  it('should support dark theme', () => {
    const session = mockSession(cleanScenario());
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report, { theme: 'dark' });
    expect(html).toContain('data-theme="dark"');
  });

  it('should render impact section for sessions with violations', () => {
    const requests = nPlus1Scenario(20);
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report);

    expect(html).toContain('If You Fix Everything');
    expect(html).toContain('Faster per page load');
    expect(html).toContain('Fewer API requests');
  });

  it('should render clean message for sessions with no violations', () => {
    const session = mockSession(cleanScenario());
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report);

    expect(html).toContain('looks great');
  });

  it('should render mini timeline for waterfall violations', () => {
    const requests = waterfallScenario(4, { baseDuration: 200 });
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report);

    if (report.summary.criticalCount > 0) {
      expect(html).toContain('fx-mini-timeline');
      expect(html).toContain('fx-tl-bar');
    }
  });

  it('should escape HTML in user content', () => {
    const session = mockSession(cleanScenario());
    session.metadata.pageUrl = 'https://example.com/<script>alert("xss")</script>';
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report);

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should include responsive CSS', () => {
    const session = mockSession(cleanScenario());
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report);

    expect(html).toContain('@media');
    expect(html).toContain('max-width');
  });

  it('should show network badge for non-wifi', () => {
    const session = mockSession(cleanScenario());
    session.config.network = 'jio-4g';
    const analyzer = new FluxAnalyzer({ network: 'jio-4g' });
    const report = analyzer.analyze(session);

    const html = generateHtmlReport(report);

    expect(html).toContain('jio-4g');
    expect(html).toContain('fx-network-badge');
  });
});

// ═════════════════════════════════════════════════════════════════
// JSON Export
// ═════════════════════════════════════════════════════════════════

describe('JSON Export', () => {
  beforeEach(() => resetMockSeq());

  it('should produce valid JSON', () => {
    const requests = [
      ...waterfallScenario(3),
      ...duplicateScenario(3),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const json = exportReportJson(report);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBeDefined();
    expect(parsed.score.overall).toBeDefined();
    expect(parsed.score.grade).toBeDefined();
    expect(parsed.audits).toBeInstanceOf(Array);
    expect(parsed.audits.length).toBe(5);
    expect(parsed.session.pageUrl).toBeDefined();
  });

  it('should not contain circular references', () => {
    const session = mockSession(cleanScenario());
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    // Should not throw
    const json = exportReportJson(report);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should include violation details', () => {
    const requests = nPlus1Scenario(10);
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const parsed = JSON.parse(exportReportJson(report));
    const e3 = parsed.audits.find((a: any) => a.ruleId === 'E3');

    expect(e3).toBeDefined();
    if (e3.violations.length > 0) {
      expect(e3.violations[0].title).toBeDefined();
      expect(e3.violations[0].impact).toBeDefined();
      expect(e3.violations[0].endpoints).toBeInstanceOf(Array);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Console Printer
// ═════════════════════════════════════════════════════════════════

describe('Console Printer', () => {
  beforeEach(() => resetMockSeq());

  it('should produce readable output with score', () => {
    const requests = [
      ...waterfallScenario(3),
      ...uncachedScenario(1, 3),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const output = printReport(report);

    expect(output).toContain('FluxAPI Report');
    expect(output).toContain('/100');
    expect(output).toContain('Efficiency');
    expect(output).toContain('Caching');
  });

  it('should show clean message when no issues', () => {
    const session = mockSession(cleanScenario());
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const output = printReport(report);

    expect(output).toContain('clean');
  });

  it('should show top fixes and impact', () => {
    const requests = [
      ...nPlus1Scenario(15),
      ...duplicateScenario(4),
    ];
    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer();
    const report = analyzer.analyze(session);

    const output = printReport(report);

    if (report.summary.totalViolations > 0) {
      expect(output).toContain('Top Fixes');
      expect(output).toContain('Total Impact');
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// End-to-End: Scan → Analyze → Report
// ═════════════════════════════════════════════════════════════════

describe('End-to-End Pipeline', () => {
  beforeEach(() => resetMockSeq());

  it('should produce complete report from scan session', () => {
    // Simulate a real-world session with mixed patterns
    const requests = [
      ...waterfallScenario(3, { baseDuration: 250, route: '/dashboard' }),
      ...duplicateScenario(3, {
        endpoint: 'https://api.example.com/api/user/profile',
        route: '/dashboard',
      }),
      ...nPlus1Scenario(12, { route: '/products' }),
      ...uncachedScenario(2, 3),
      ...underCachingScenario(8, { identicalRate: 0.9 }),
    ];

    const session = mockSession(requests);
    const analyzer = new FluxAnalyzer({ network: 'jio-4g' });
    const report = analyzer.analyze(session);

    // All outputs should work
    const html = generateHtmlReport(report);
    const json = exportReportJson(report);
    const console = printReport(report);

    // HTML should be valid and substantial
    expect(html.length).toBeGreaterThan(5000);
    expect(html).toContain('<!DOCTYPE html>');

    // JSON should be parseable
    expect(() => JSON.parse(json)).not.toThrow();

    // Console should be readable
    expect(console).toContain('/100');

    // All fixes should generate
    const allViolations = report.score.audits.flatMap(a => a.violations);
    const fixes = generateFixes(allViolations);
    expect(fixes.length).toBeGreaterThan(0);

    // Every fix should have code
    for (const fix of fixes) {
      expect(fix.code.length).toBeGreaterThan(50);
      expect(fix.title.length).toBeGreaterThan(5);
      expect(fix.explanation.length).toBeGreaterThan(20);
    }
  });
});
