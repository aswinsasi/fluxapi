// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Report Module
// Multiple output formats for FluxReport data.
// ═══════════════════════════════════════════════════════════════════

export { generateHtmlReport, type ReportOptions } from './html-report';
export { generateFix, generateFixes, type CodeFix } from '../fixer';

import type { FluxReport } from '../analyzer/types';
import { formatDuration, formatBytes } from '../utils';

// ─── JSON Export ────────────────────────────────────────────────

/**
 * Export report as clean JSON (no circular refs, no raw request bodies).
 */
export function exportReportJson(report: FluxReport): string {
  const clean = {
    id: report.id,
    analyzedAt: report.analyzedAt,
    score: {
      overall: report.score.overall,
      grade: report.score.grade,
      network: report.score.network,
      networkAdjustedScore: report.score.networkAdjustedScore,
      categories: report.score.categories,
    },
    summary: report.summary,
    totalImpact: report.totalImpact,
    audits: report.score.audits.map(a => ({
      ruleId: a.rule.id,
      ruleName: a.rule.name,
      category: a.rule.category,
      severity: a.rule.severity,
      score: a.score,
      maxWeight: a.rule.maxWeight,
      passed: a.passed,
      violationCount: a.violations.length,
      violations: a.violations.map(v => ({
        title: v.title,
        description: v.description,
        severity: v.severity,
        endpoints: v.affectedEndpoints,
        components: v.affectedComponents,
        impact: v.impact,
      })),
    })),
    session: {
      pageUrl: report.session.metadata.pageUrl,
      scanDuration: report.session.metadata.scanDuration,
      apiRequests: report.session.metadata.apiRequests,
      uniqueEndpoints: report.session.metadata.uniqueEndpoints,
      stack: report.session.stack,
      network: report.session.config.network,
    },
  };

  return JSON.stringify(clean, null, 2);
}

// ─── Console Pretty-Print ───────────────────────────────────────

/**
 * Print a summary to the console (for CLI/DevTools).
 */
export function printReport(report: FluxReport): string {
  const { score, summary, totalImpact } = report;
  const lines: string[] = [];

  const bar = '═'.repeat(52);
  lines.push('');
  lines.push(`╔${bar}╗`);
  lines.push(`║  FluxAPI Report — Score: ${score.overall}/100 (${score.grade})${' '.repeat(Math.max(0, 17 - score.grade.length - String(score.overall).length))}║`);
  lines.push(`╚${bar}╝`);
  lines.push('');

  // Category breakdown
  for (const cat of score.categories) {
    const filled = Math.round(cat.score / 5);
    const empty = 20 - filled;
    const barStr = '█'.repeat(filled) + '░'.repeat(empty);
    lines.push(`  ${categoryIcon(cat.category)} ${cat.label.padEnd(12)} ${barStr} ${Math.round(cat.score)}%`);
  }
  lines.push('');

  // Violations summary
  if (summary.totalViolations > 0) {
    lines.push(`  Issues Found:`);
    lines.push(`    🔴 ${summary.criticalCount} critical  🟡 ${summary.warningCount} warnings  ℹ️  ${summary.infoCount} info`);
    lines.push('');

    // Top fixes
    if (summary.topFixes.length > 0) {
      lines.push(`  Top Fixes:`);
      for (const fix of summary.topFixes) {
        lines.push(`    ${fix.ruleId}: ${fix.title}`);
        if (fix.impact.timeSavedMs > 0) {
          lines.push(`       ⚡ ${formatDuration(fix.impact.timeSavedMs)} faster`);
        }
        if (fix.impact.requestsEliminated > 0) {
          lines.push(`       📉 ${fix.impact.requestsEliminated} fewer requests`);
        }
      }
      lines.push('');
    }

    // Total impact
    lines.push(`  Total Impact if Fixed:`);
    lines.push(`    ⚡ ${formatDuration(totalImpact.timeSavedMs)} faster`);
    lines.push(`    📉 ${totalImpact.requestsEliminated} fewer requests`);
    lines.push(`    💾 ${formatBytes(totalImpact.bandwidthSavedBytes)} saved`);
    if (totalImpact.monthlyCostSavings > 0.01) {
      lines.push(`    💰 $${totalImpact.monthlyCostSavings.toFixed(2)}/month saved`);
    }
  } else {
    lines.push(`  ✨ No issues found — your API layer is clean!`);
  }

  // Badge
  lines.push('');
  lines.push(`  📛 Add to your README:`);
  lines.push(`    ${generateBadgeMarkdown(score.overall, score.grade)}`);

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate a shields.io badge URL for the score.
 */
export function generateBadgeUrl(score: number, grade?: string): string {
  const color = score >= 90 ? 'brightgreen' : score >= 70 ? 'blue' : score >= 50 ? 'yellow' : 'red';
  const label = 'FluxAPI';
  const message = `${Math.round(score)}%2F100`;
  // Encode the FluxAPI logo as a simple SVG data URI
  const logo = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%237c5cfc"/><path d="M8 10h16M8 16h12M8 22h8" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>');
  return `https://img.shields.io/badge/${label}-${message}-${color}?style=flat&logo=${encodeURIComponent(logo)}`;
}

/**
 * Generate a markdown badge string.
 */
export function generateBadgeMarkdown(score: number, grade?: string): string {
  const color = score >= 90 ? 'brightgreen' : score >= 70 ? 'blue' : score >= 50 ? 'yellow' : 'red';
  const label = 'FluxAPI_Score';
  const message = `${Math.round(score)}%2F100`;
  const url = `https://img.shields.io/badge/${label}-${message}-${color}`;
  return `![FluxAPI Score](${url})`;
}

function categoryIcon(cat: string): string {
  switch (cat) {
    case 'efficiency': return '⚡';
    case 'caching': return '💾';
    case 'patterns': return '🔄';
    default: return '📊';
  }
}
