// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - HTML Report Generator
// Produces a self-contained HTML file (no external dependencies)
// from a FluxReport. Inspired by Lighthouse's report UI.
//
// Features:
//   - Animated score gauge (0-100 with color coding)
//   - Category breakdown bars
//   - Violation cards with severity badges
//   - Fix code blocks with copy-to-clipboard
//   - Request waterfall timeline (mini chart)
//   - Impact summary with savings projection
//   - Dark/light mode support
//   - Fully responsive
//   - Zero external dependencies (all CSS/JS inline)
// ═══════════════════════════════════════════════════════════════════

import type { FluxReport } from '../analyzer/types';
import type { AuditResult, RuleViolation, CategoryScore } from '../analyzer/types';
import { generateFix, type CodeFix } from '../fixer';
import { formatDuration, formatBytes } from '../utils';

// ─── Public API ─────────────────────────────────────────────────

export interface ReportOptions {
  /** Include raw request data in report (larger file). Default: false */
  includeRawData: boolean;
  /** Show fix code suggestions. Default: true */
  showFixes: boolean;
  /** Report title override */
  title: string | null;
  /** Theme: light or dark */
  theme: 'light' | 'dark' | 'auto';
}

const DEFAULT_OPTIONS: ReportOptions = {
  includeRawData: false,
  showFixes: true,
  title: null,
  theme: 'auto',
};

/**
 * Generate a self-contained HTML report string from a FluxReport.
 */
export function generateHtmlReport(
  report: FluxReport,
  options?: Partial<ReportOptions>,
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const title = opts.title || `FluxAPI Report — ${report.session.metadata.pageUrl}`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="${opts.theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>${generateCss()}</style>
</head>
<body>
  <div class="fx-report">
    ${renderHeader(report, title)}
    ${renderScoreSection(report)}
    ${renderCategoryBars(report)}
    ${renderImpactSummary(report)}
    ${renderWebSocketSummary(report)}
    ${renderAuditSection(report, opts)}
    ${renderFooter(report)}
  </div>
  <script>${generateJs()}</script>
</body>
</html>`;
}

// ─── Section Renderers ──────────────────────────────────────────

function renderHeader(report: FluxReport, title: string): string {
  const meta = report.session.metadata;
  const cfg = report.session.config;
  const stack = report.session.stack;

  return `
    <header class="fx-header">
      <div class="fx-logo">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="var(--accent)"/>
          <path d="M8 10h16M8 16h12M8 22h8" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span class="fx-logo-text">FluxAPI</span>
      </div>
      <h1 class="fx-title">${escHtml(title)}</h1>
      <div class="fx-meta">
        <span class="fx-meta-item">📍 ${escHtml(meta.pageUrl)}</span>
        <span class="fx-meta-item">⏱️ ${(meta.scanDuration / 1000).toFixed(1)}s scan</span>
        <span class="fx-meta-item">📡 ${meta.apiRequests} API calls</span>
        <span class="fx-meta-item">🔌 ${meta.uniqueEndpoints} endpoints</span>
        ${stack.framework ? `<span class="fx-meta-item">⚛️ ${capitalize(stack.framework.name)}${stack.framework.version ? ' ' + stack.framework.version : ''}${stack.framework.metaFramework ? ' (' + capitalize(stack.framework.metaFramework) + ')' : ''}</span>` : ''}
        ${stack.dataLibrary && stack.dataLibrary.name !== 'none' ? `<span class="fx-meta-item">📦 ${stack.dataLibrary.name}</span>` : ''}
        ${cfg.network !== 'wifi' ? `<span class="fx-meta-item fx-network-badge">📶 ${cfg.network}</span>` : ''}
      </div>
    </header>`;
}

function renderScoreSection(report: FluxReport): string {
  const { overall, grade, networkAdjustedScore, network } = report.score;
  const color = scoreColor(overall);
  const deg = (overall / 100) * 360;

  return `
    <section class="fx-score-section">
      <div class="fx-gauge-container">
        <div class="fx-gauge" style="--score: ${overall}; --color: ${color}; --deg: ${deg}deg">
          <div class="fx-gauge-ring">
            <svg viewBox="0 0 120 120">
              <circle class="fx-gauge-bg" cx="60" cy="60" r="54" />
              <circle class="fx-gauge-fill" cx="60" cy="60" r="54"
                stroke-dasharray="${(overall / 100) * 339.3} 339.3"
                style="stroke: ${color}" />
            </svg>
          </div>
          <div class="fx-gauge-value">
            <span class="fx-gauge-number" data-target="${overall}">0</span>
            <span class="fx-gauge-label">API Health</span>
          </div>
        </div>
        <div class="fx-grade fx-grade-${grade}" title="${grade}">${gradeEmoji(grade)} ${capitalize(grade)}</div>
        ${networkAdjustedScore !== null ? `
          <div class="fx-network-score">
            On <strong>${network}</strong>: <span style="color: ${scoreColor(networkAdjustedScore)}">${networkAdjustedScore}</span>/100
          </div>
        ` : ''}
      </div>
      <div class="fx-score-summary">
        <div class="fx-stat-card fx-stat-critical">
          <div class="fx-stat-value">${report.summary.criticalCount}</div>
          <div class="fx-stat-label">Critical</div>
        </div>
        <div class="fx-stat-card fx-stat-warning">
          <div class="fx-stat-value">${report.summary.warningCount}</div>
          <div class="fx-stat-label">Warnings</div>
        </div>
        <div class="fx-stat-card fx-stat-info">
          <div class="fx-stat-value">${report.summary.infoCount}</div>
          <div class="fx-stat-label">Info</div>
        </div>
        <div class="fx-stat-card fx-stat-fixable">
          <div class="fx-stat-value">${report.summary.autoFixableCount}</div>
          <div class="fx-stat-label">Auto-fixable</div>
        </div>
      </div>
    </section>`;
}

function renderCategoryBars(report: FluxReport): string {
  const bars = report.score.categories.map(cat => {
    const color = scoreColor(cat.score);
    return `
      <div class="fx-cat-row">
        <div class="fx-cat-label">
          <span class="fx-cat-icon">${categoryIcon(cat.category)}</span>
          <span>${escHtml(cat.label)}</span>
        </div>
        <div class="fx-cat-bar-track">
          <div class="fx-cat-bar-fill" style="width: ${cat.score}%; background: ${color}"></div>
        </div>
        <div class="fx-cat-score" style="color: ${color}">${Math.round(cat.score)}</div>
      </div>`;
  }).join('');

  return `
    <section class="fx-categories">
      <h2 class="fx-section-title">Category Scores</h2>
      ${bars}
    </section>`;
}

function renderImpactSummary(report: FluxReport): string {
  const impact = report.totalImpact;
  if (impact.timeSavedMs === 0 && impact.requestsEliminated === 0) {
    return `
      <section class="fx-impact">
        <h2 class="fx-section-title">Estimated Impact</h2>
        <div class="fx-impact-clean">✨ No significant issues found. Your API layer looks great!</div>
      </section>`;
  }

  return `
    <section class="fx-impact">
      <h2 class="fx-section-title">If You Fix Everything</h2>
      <div class="fx-impact-grid">
        <div class="fx-impact-card">
          <div class="fx-impact-icon">⚡</div>
          <div class="fx-impact-value">${formatDuration(impact.timeSavedMs)}</div>
          <div class="fx-impact-label">Faster per page load</div>
        </div>
        <div class="fx-impact-card">
          <div class="fx-impact-icon">📉</div>
          <div class="fx-impact-value">${impact.requestsEliminated}</div>
          <div class="fx-impact-label">Fewer API requests</div>
        </div>
        <div class="fx-impact-card">
          <div class="fx-impact-icon">💾</div>
          <div class="fx-impact-value">${formatBytes(impact.bandwidthSavedBytes)}</div>
          <div class="fx-impact-label">Bandwidth saved</div>
        </div>
        ${impact.monthlyCostSavings > 0.01 ? `
        <div class="fx-impact-card">
          <div class="fx-impact-icon">💰</div>
          <div class="fx-impact-value">$${impact.monthlyCostSavings.toFixed(2)}</div>
          <div class="fx-impact-label">Saved per month</div>
        </div>
        ` : ''}
      </div>
    </section>`;
}

function renderWebSocketSummary(report: FluxReport): string {
  const ws = report.session.websockets;
  if (!ws || ws.connections.length === 0) return '';

  const connCards = ws.connections.map(conn => {
    const url = new URL(conn.url).host || conn.url;
    const totalMsgs = conn.messagesReceived + conn.messagesSent;
    return `
      <div class="fx-impact-card">
        <div class="fx-impact-icon">🔌</div>
        <div style="font-size:12px;font-weight:700;margin-bottom:4px">${escHtml(url)}</div>
        <div class="fx-impact-value">${totalMsgs}</div>
        <div class="fx-impact-label">messages (↓${conn.messagesReceived} ↑${conn.messagesSent})</div>
        ${conn.channels.length > 0 ? `<div style="font-size:11px;color:var(--fg3);margin-top:4px">${conn.channels.map(c => escHtml(c)).join(', ')}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <section class="fx-impact">
      <h2 class="fx-section-title">WebSocket Activity</h2>
      <div class="fx-impact-grid">
        <div class="fx-impact-card">
          <div class="fx-impact-icon">📡</div>
          <div class="fx-impact-value">${ws.connections.length}</div>
          <div class="fx-impact-label">connections</div>
        </div>
        <div class="fx-impact-card">
          <div class="fx-impact-icon">💬</div>
          <div class="fx-impact-value">${ws.totalMessages}</div>
          <div class="fx-impact-label">total messages</div>
        </div>
        <div class="fx-impact-card">
          <div class="fx-impact-icon">⚡</div>
          <div class="fx-impact-value">${ws.messagesPerSecond}/s</div>
          <div class="fx-impact-label">message rate</div>
        </div>
        ${connCards}
      </div>
    </section>`;
}

function renderAuditSection(report: FluxReport, opts: ReportOptions): string {
  const audits = [...report.score.audits].sort((a, b) => {
    // Sort: failed first, then by severity weight
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    return b.rule.maxWeight - a.rule.maxWeight;
  });

  const cards = audits.map(audit => renderAuditCard(audit, opts)).join('');

  return `
    <section class="fx-audits">
      <h2 class="fx-section-title">Audit Results</h2>
      ${cards}
    </section>`;
}

function renderAuditCard(audit: AuditResult, opts: ReportOptions): string {
  const { rule, score, violations, passed } = audit;
  const statusClass = passed ? 'fx-audit-pass' : 'fx-audit-fail';
  const statusIcon = passed ? '✅' : (rule.severity === 'critical' ? '🔴' : rule.severity === 'warning' ? '🟡' : 'ℹ️');
  const pct = rule.maxWeight > 0 ? Math.round((score / rule.maxWeight) * 100) : 100;

  let violationHtml = '';
  if (violations.length > 0) {
    violationHtml = violations.map((v, i) => renderViolation(v, i, opts)).join('');
  }

  return `
    <div class="fx-audit-card ${statusClass}">
      <div class="fx-audit-header" onclick="this.parentElement.classList.toggle('fx-expanded')">
        <div class="fx-audit-status">${statusIcon}</div>
        <div class="fx-audit-info">
          <div class="fx-audit-name">${escHtml(rule.id)}: ${escHtml(rule.name)}</div>
          <div class="fx-audit-desc">${escHtml(rule.description)}</div>
        </div>
        <div class="fx-audit-badges">
          <span class="fx-badge fx-badge-${rule.severity}">${rule.severity}</span>
          <span class="fx-badge fx-badge-score" style="color: ${scoreColor(pct)}">${Math.round(score)}/${rule.maxWeight}</span>
          ${violations.length > 0 ? `<span class="fx-badge fx-badge-count">${violations.length} issue${violations.length > 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="fx-audit-chevron">▾</div>
      </div>
      <div class="fx-audit-body">
        ${violationHtml}
      </div>
    </div>`;
}

function renderViolation(v: RuleViolation, index: number, opts: ReportOptions): string {
  let fixHtml = '';
  if (opts.showFixes) {
    const fix = generateFix(v);
    if (fix) {
      fixHtml = renderFixCode(fix);
    }
  }

  // Mini timeline for waterfall/N+1 violations
  let timelineHtml = '';
  if (v.metadata.requestTimeline && v.metadata.requestTimeline.length > 0) {
    timelineHtml = renderMiniTimeline(v.metadata.requestTimeline);
  }

  return `
    <div class="fx-violation">
      <div class="fx-violation-header">
        <span class="fx-severity-dot fx-severity-${v.severity}"></span>
        <span class="fx-badge fx-badge-${v.severity}" style="font-family:monospace;font-size:10px">${escHtml(v.ruleId)}</span>
        <span class="fx-violation-title">${escHtml(v.title)}</span>
      </div>
      <div class="fx-violation-desc">${escHtml(v.description)}</div>
      ${timelineHtml}
      <div class="fx-violation-impact">
        ${v.impact.timeSavedMs > 0 ? `<span class="fx-impact-tag">⚡ ${formatDuration(v.impact.timeSavedMs)} faster</span>` : ''}
        ${v.impact.requestsEliminated > 0 ? `<span class="fx-impact-tag">📉 ${v.impact.requestsEliminated} fewer requests</span>` : ''}
        ${v.impact.bandwidthSavedBytes > 1024 ? `<span class="fx-impact-tag">💾 ${formatBytes(v.impact.bandwidthSavedBytes)} saved</span>` : ''}
        ${v.impact.monthlyCostSavings > 0.01 ? `<span class="fx-impact-tag">💰 $${v.impact.monthlyCostSavings.toFixed(2)}/mo</span>` : ''}
      </div>
      ${fixHtml}
    </div>`;
}

function renderFixCode(fix: CodeFix): string {
  const altHtml = fix.alternativeCode ? `
    <details class="fx-alt-code">
      <summary>Vanilla alternative (no TanStack Query)</summary>
      <div class="fx-code-block">
        <button class="fx-copy-btn" onclick="fxCopy(this)" title="Copy to clipboard">📋</button>
        <pre><code>${escHtml(fix.alternativeCode)}</code></pre>
      </div>
    </details>` : '';

  return `
    <div class="fx-fix">
      <div class="fx-fix-header">
        <span class="fx-fix-icon">🔧</span>
        <span class="fx-fix-title">${escHtml(fix.title)}</span>
        ${fix.dependencies.length > 0 ? `<span class="fx-fix-deps">${fix.dependencies.join(', ')}</span>` : ''}
      </div>
      <div class="fx-fix-explanation">${escHtml(fix.explanation)}</div>
      <div class="fx-code-block">
        <div class="fx-code-header">
          <span class="fx-code-filename">${escHtml(fix.suggestedFilename)}</span>
          <button class="fx-copy-btn" onclick="fxCopy(this)" title="Copy to clipboard">📋 Copy</button>
        </div>
        <pre><code>${escHtml(fix.code)}</code></pre>
      </div>
      ${altHtml}
    </div>`;
}

function renderMiniTimeline(timeline: Array<{ url: string; start: number; end: number; duration: number; component?: string }>): string {
  if (timeline.length === 0) return '';

  const minStart = Math.min(...timeline.map(t => t.start));
  const maxEnd = Math.max(...timeline.map(t => t.end));
  const totalSpan = maxEnd - minStart || 1;

  const bars = timeline.map(t => {
    const left = ((t.start - minStart) / totalSpan) * 100;
    const width = Math.max(((t.duration) / totalSpan) * 100, 2);
    const label = (t.url || '').split('/').pop() || '';
    return `<div class="fx-tl-bar" style="left:${left}%;width:${width}%" title="${escHtml(label)} — ${Math.round(t.duration)}ms"></div>`;
  }).join('');

  return `
    <div class="fx-mini-timeline">
      <div class="fx-tl-label">Request timeline (${Math.round(totalSpan)}ms total)</div>
      <div class="fx-tl-track">${bars}</div>
    </div>`;
}

function renderFooter(report: FluxReport): string {
  return `
    <footer class="fx-footer">
      <div class="fx-footer-text">
        Generated by <strong>FluxAPI</strong> • ${new Date().toISOString().split('T')[0]} • Report ID: ${report.id}
      </div>
      <div class="fx-footer-links">
        <a href="https://fluxapi.dev" target="_blank">fluxapi.dev</a> •
        <a href="https://github.com/fluxapi/scan" target="_blank">GitHub</a>
      </div>
    </footer>`;
}

// ─── CSS ────────────────────────────────────────────────────────

function generateCss(): string {
  return `
    :root, [data-theme="light"] {
      --bg: #ffffff; --bg2: #f8f9fa; --bg3: #e9ecef;
      --fg: #1a1a2e; --fg2: #495057; --fg3: #868e96;
      --border: #dee2e6; --border2: #ced4da;
      --accent: #6366f1; --accent2: #818cf8;
      --red: #ef4444; --orange: #f59e0b; --green: #22c55e; --blue: #3b82f6;
      --code-bg: #1e1e2e; --code-fg: #cdd6f4;
      --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
      --shadow-lg: 0 4px 12px rgba(0,0,0,0.1);
    }
    [data-theme="dark"] {
      --bg: #1a1a2e; --bg2: #16213e; --bg3: #0f3460;
      --fg: #e2e8f0; --fg2: #a0aec0; --fg3: #718096;
      --border: #2d3748; --border2: #4a5568;
      --accent: #818cf8; --accent2: #a5b4fc;
      --code-bg: #0d1117; --code-fg: #c9d1d9;
      --shadow: 0 1px 3px rgba(0,0,0,0.3);
      --shadow-lg: 0 4px 12px rgba(0,0,0,0.4);
    }
    @media (prefers-color-scheme: dark) {
      [data-theme="auto"] {
        --bg: #1a1a2e; --bg2: #16213e; --bg3: #0f3460;
        --fg: #e2e8f0; --fg2: #a0aec0; --fg3: #718096;
        --border: #2d3748; --border2: #4a5568;
        --accent: #818cf8; --accent2: #a5b4fc;
        --code-bg: #0d1117; --code-fg: #c9d1d9;
        --shadow: 0 1px 3px rgba(0,0,0,0.3);
        --shadow-lg: 0 4px 12px rgba(0,0,0,0.4);
      }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--fg);
      line-height: 1.6; -webkit-font-smoothing: antialiased;
    }

    .fx-report { max-width: 900px; margin: 0 auto; padding: 24px 16px; }

    /* Header */
    .fx-header { margin-bottom: 32px; }
    .fx-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .fx-logo-text { font-size: 20px; font-weight: 700; color: var(--accent); letter-spacing: -0.5px; }
    .fx-title { font-size: 18px; font-weight: 600; color: var(--fg); margin-bottom: 8px; }
    .fx-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 13px; color: var(--fg2); }
    .fx-meta-item { white-space: nowrap; }
    .fx-network-badge { background: var(--accent); color: white; padding: 1px 8px; border-radius: 99px; font-weight: 600; }

    /* Score Section */
    .fx-score-section { display: flex; gap: 32px; align-items: center; margin-bottom: 32px; flex-wrap: wrap; justify-content: center; }
    .fx-gauge-container { text-align: center; }
    .fx-gauge { position: relative; width: 160px; height: 160px; margin: 0 auto 12px; }
    .fx-gauge-ring { position: absolute; inset: 0; }
    .fx-gauge-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .fx-gauge-bg { fill: none; stroke: var(--bg3); stroke-width: 8; }
    .fx-gauge-fill { fill: none; stroke-width: 8; stroke-linecap: round; transition: stroke-dasharray 1.5s ease; }
    .fx-gauge-value { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .fx-gauge-number { font-size: 42px; font-weight: 800; line-height: 1; color: var(--color, var(--fg)); }
    .fx-gauge-label { font-size: 12px; color: var(--fg3); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .fx-grade { font-size: 15px; font-weight: 700; text-align: center; }
    .fx-grade-excellent { color: var(--green); }
    .fx-grade-good { color: var(--blue); }
    .fx-grade-needs-work { color: var(--orange); }
    .fx-grade-poor { color: var(--red); }
    .fx-network-score { font-size: 13px; color: var(--fg2); text-align: center; margin-top: 6px; }

    .fx-score-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; flex: 1; min-width: 200px; }
    .fx-stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-align: center; }
    .fx-stat-value { font-size: 28px; font-weight: 800; }
    .fx-stat-label { font-size: 12px; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.5px; }
    .fx-stat-critical .fx-stat-value { color: var(--red); }
    .fx-stat-warning .fx-stat-value { color: var(--orange); }
    .fx-stat-info .fx-stat-value { color: var(--blue); }
    .fx-stat-fixable .fx-stat-value { color: var(--green); }

    /* Category Bars */
    .fx-categories { margin-bottom: 32px; }
    .fx-section-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--border); }
    .fx-cat-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
    .fx-cat-label { width: 130px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .fx-cat-icon { font-size: 16px; }
    .fx-cat-bar-track { flex: 1; height: 10px; background: var(--bg3); border-radius: 99px; overflow: hidden; }
    .fx-cat-bar-fill { height: 100%; border-radius: 99px; transition: width 1s ease; min-width: 4px; }
    .fx-cat-score { width: 36px; text-align: right; font-weight: 700; font-size: 15px; }

    /* Impact */
    .fx-impact { margin-bottom: 32px; }
    .fx-impact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .fx-impact-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-align: center; }
    .fx-impact-icon { font-size: 24px; margin-bottom: 4px; }
    .fx-impact-value { font-size: 22px; font-weight: 800; color: var(--accent); }
    .fx-impact-label { font-size: 12px; color: var(--fg3); }
    .fx-impact-clean { background: var(--bg2); border: 1px solid var(--green); border-radius: 12px; padding: 24px; text-align: center; font-size: 16px; color: var(--green); }

    /* Audit Cards */
    .fx-audits { margin-bottom: 32px; }
    .fx-audit-card { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px; overflow: hidden; background: var(--bg); }
    .fx-audit-card.fx-audit-fail { border-left: 3px solid var(--red); }
    .fx-audit-card.fx-audit-pass { border-left: 3px solid var(--green); }
    .fx-audit-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; user-select: none; }
    .fx-audit-header:hover { background: var(--bg2); }
    .fx-audit-status { font-size: 18px; flex-shrink: 0; }
    .fx-audit-info { flex: 1; min-width: 0; }
    .fx-audit-name { font-size: 14px; font-weight: 600; }
    .fx-audit-desc { font-size: 12px; color: var(--fg3); }
    .fx-audit-badges { display: flex; gap: 6px; flex-shrink: 0; }
    .fx-audit-chevron { font-size: 14px; color: var(--fg3); transition: transform 0.2s; }
    .fx-expanded .fx-audit-chevron { transform: rotate(180deg); }
    .fx-audit-body { display: none; border-top: 1px solid var(--border); padding: 16px; }
    .fx-expanded .fx-audit-body { display: block; }

    /* Badges */
    .fx-badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 600; white-space: nowrap; }
    .fx-badge-critical { background: #fef2f2; color: var(--red); border: 1px solid #fecaca; }
    .fx-badge-warning { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
    .fx-badge-info { background: #eff6ff; color: var(--blue); border: 1px solid #bfdbfe; }
    .fx-badge-count { background: var(--bg3); color: var(--fg2); }
    .fx-badge-score { font-weight: 800; background: transparent; }
    @media (prefers-color-scheme: dark) {
      [data-theme="auto"] .fx-badge-critical { background: #450a0a; border-color: #7f1d1d; }
      [data-theme="auto"] .fx-badge-warning { background: #451a03; border-color: #78350f; }
      [data-theme="auto"] .fx-badge-info { background: #172554; border-color: #1e3a5f; }
    }
    [data-theme="dark"] .fx-badge-critical { background: #450a0a; border-color: #7f1d1d; }
    [data-theme="dark"] .fx-badge-warning { background: #451a03; border-color: #78350f; }
    [data-theme="dark"] .fx-badge-info { background: #172554; border-color: #1e3a5f; }

    /* Violations */
    .fx-violation { padding: 12px 0; border-bottom: 1px solid var(--border); }
    .fx-violation:last-child { border-bottom: none; }
    .fx-violation-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .fx-severity-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .fx-severity-critical { background: var(--red); }
    .fx-severity-warning { background: var(--orange); }
    .fx-severity-info { background: var(--blue); }
    .fx-violation-title { font-size: 13px; font-weight: 600; }
    .fx-violation-desc { font-size: 13px; color: var(--fg2); margin-bottom: 8px; line-height: 1.5; }
    .fx-violation-impact { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .fx-impact-tag { font-size: 12px; background: var(--bg2); padding: 3px 10px; border-radius: 99px; color: var(--fg2); border: 1px solid var(--border); white-space: nowrap; }

    /* Mini Timeline */
    .fx-mini-timeline { margin: 8px 0 12px; }
    .fx-tl-label { font-size: 11px; color: var(--fg3); margin-bottom: 4px; }
    .fx-tl-track { position: relative; height: 24px; background: var(--bg3); border-radius: 4px; overflow: hidden; }
    .fx-tl-bar { position: absolute; top: 3px; height: 18px; background: var(--accent); border-radius: 3px; opacity: 0.8; min-width: 4px; }
    .fx-tl-bar:nth-child(odd) { background: var(--accent2); }

    /* Fix Code */
    .fx-fix { margin-top: 12px; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .fx-fix-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .fx-fix-icon { font-size: 16px; }
    .fx-fix-title { font-size: 13px; font-weight: 600; }
    .fx-fix-deps { font-size: 11px; color: var(--accent); background: var(--bg); padding: 2px 8px; border-radius: 4px; }
    .fx-fix-explanation { font-size: 12px; color: var(--fg2); margin-bottom: 10px; line-height: 1.5; }
    .fx-code-block { position: relative; border-radius: 8px; overflow: hidden; }
    .fx-code-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: #161b22; border-bottom: 1px solid #30363d; }
    .fx-code-filename { font-size: 12px; color: #8b949e; font-family: 'SF Mono', 'Fira Code', monospace; }
    .fx-copy-btn { background: transparent; border: 1px solid #30363d; color: #8b949e; padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s; }
    .fx-copy-btn:hover { background: #21262d; color: #c9d1d9; }
    .fx-copy-btn.fx-copied { color: var(--green); border-color: var(--green); }
    pre { background: var(--code-bg); color: var(--code-fg); padding: 14px; overflow-x: auto; font-size: 12.5px; line-height: 1.55; font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace; }
    code { font-family: inherit; }
    .fx-alt-code { margin-top: 8px; }
    .fx-alt-code summary { font-size: 12px; color: var(--fg3); cursor: pointer; padding: 4px 0; }

    /* Footer */
    .fx-footer { text-align: center; padding: 24px 0 16px; border-top: 1px solid var(--border); margin-top: 24px; }
    .fx-footer-text { font-size: 13px; color: var(--fg3); }
    .fx-footer-links { font-size: 12px; margin-top: 4px; }
    .fx-footer-links a { color: var(--accent); text-decoration: none; }
    .fx-footer-links a:hover { text-decoration: underline; }

    /* Responsive */
    @media (max-width: 640px) {
      .fx-score-section { flex-direction: column; }
      .fx-score-summary { grid-template-columns: repeat(2, 1fr); width: 100%; }
      .fx-audit-badges { display: none; }
      .fx-meta { font-size: 12px; gap: 8px; }
      .fx-cat-label { width: 100px; font-size: 13px; }
    }
  `;
}

// ─── JavaScript ─────────────────────────────────────────────────

function generateJs(): string {
  return `
    // Animate score counter
    document.querySelectorAll('.fx-gauge-number').forEach(el => {
      const target = parseFloat(el.dataset.target || '0');
      const color = target >= 90 ? 'var(--green)' : target >= 70 ? 'var(--blue)' : target >= 50 ? 'var(--orange)' : 'var(--red)';
      el.style.color = color;
      let current = 0;
      const step = target / 40;
      const timer = setInterval(() => {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        el.textContent = Math.round(current);
      }, 25);
    });

    // Copy to clipboard
    window.fxCopy = function(btn) {
      const code = btn.closest('.fx-code-block').querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.textContent || '').then(() => {
        btn.classList.add('fx-copied');
        const orig = btn.innerHTML;
        btn.innerHTML = '✅ Copied!';
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('fx-copied'); }, 2000);
      });
    };

    // Auto-expand first failing audit
    const firstFail = document.querySelector('.fx-audit-fail');
    if (firstFail) firstFail.classList.add('fx-expanded');
  `;
}

// ─── Helpers ────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreColor(score: number): string {
  if (score >= 90) return 'var(--green)';
  if (score >= 70) return 'var(--blue)';
  if (score >= 50) return 'var(--orange)';
  return 'var(--red)';
}

function gradeEmoji(grade: string): string {
  switch (grade) {
    case 'excellent': return '🟢';
    case 'good': return '🔵';
    case 'needs-work': return '🟡';
    case 'poor': return '🔴';
    default: return '⚪';
  }
}

function categoryIcon(cat: string): string {
  switch (cat) {
    case 'efficiency': return '⚡';
    case 'caching': return '💾';
    case 'patterns': return '🔄';
    default: return '📊';
  }
}
