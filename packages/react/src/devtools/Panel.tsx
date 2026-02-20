// ═══════════════════════════════════════════════════════════════════
// Panel — expanded view with tabs
// ═══════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import type { FluxState } from '../scanner-bridge';
import type { ScannerBridge } from '../scanner-bridge';
import type { RuleViolation, FluxRequestRecord } from '@fluxiapi/scan';
import * as S from './styles';

const RULE_NAMES: Record<string, string> = {
  E1: 'Request Waterfall', E2: 'Duplicate Requests', E3: 'N+1 Pattern',
  E4: 'Over-fetching', E5: 'Batchable Requests',
  C1: 'No Cache', C2: 'Under-Caching', C3: 'Over-Caching', C4: 'Missing Revalidation',
  P1: 'Missing Prefetch', P2: 'Unnecessary Polling', P3: 'No Error Recovery', P4: 'Uncompressed',
};

type Tab = 'overview' | 'violations' | 'requests';

interface PanelProps {
  state: FluxState;
  bridge: ScannerBridge;
  position: string;
  onClose: () => void;
}

export function Panel({ state, bridge, position, onClose }: PanelProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const { report, violations, requests, scanning, elapsed, score, framework } = state;

  const apiRequests = useMemo(
    () => requests.filter((r) => r.type === 'api-rest' || r.type === 'api-graphql'),
    [requests]
  );

  return (
    <div style={S.panelStyle(position)} className="flux-devtools">
      {/* Header */}
      <div style={S.panelHeaderStyle}>
        <div style={S.panelTitleStyle}>
          <span>⚡</span>
          <span>FluxAPI</span>
          {scanning && (
            <span style={{ color: S.COLORS.accent, fontSize: '10px', fontWeight: 500 }}>
              ● Recording
            </span>
          )}
          {!scanning && report && (
            <span style={{
              color: score >= 70 ? S.COLORS.green : score >= 50 ? S.COLORS.orange : S.COLORS.red,
              fontSize: '10px', fontWeight: 700
            }}>
              {score}/100
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {scanning ? (
            <button
              style={{ ...S.panelCloseBtnStyle, color: S.COLORS.red, fontSize: '10px' }}
              onClick={() => bridge.stop()}
            >⏹ Stop</button>
          ) : (
            <button
              style={{ ...S.panelCloseBtnStyle, color: S.COLORS.green, fontSize: '10px' }}
              onClick={() => bridge.start()}
            >▶ Scan</button>
          )}
          <button style={S.panelCloseBtnStyle} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={S.tabBarStyle}>
        {(['overview', 'violations', 'requests'] as Tab[]).map((t) => (
          <button
            key={t}
            style={S.tabStyle(tab === t)}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'violations' && violations.length > 0 && (
              <span style={{
                marginLeft: '4px', background: S.COLORS.red, color: '#fff',
                borderRadius: '8px', padding: '0 5px', fontSize: '9px', fontWeight: 700,
              }}>
                {violations.length}
              </span>
            )}
            {t === 'requests' && (
              <span style={{
                marginLeft: '4px', color: S.COLORS.fg3, fontSize: '9px',
              }}>
                {apiRequests.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={S.panelBodyStyle}>
        {tab === 'overview' && (
          <OverviewTab
            state={state}
            apiRequests={apiRequests}
            violations={violations}
          />
        )}
        {tab === 'violations' && <ViolationsTab violations={violations} />}
        {tab === 'requests' && <RequestsTab requests={apiRequests} />}
      </div>
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────

function OverviewTab({
  state,
  apiRequests,
  violations,
}: {
  state: FluxState;
  apiRequests: FluxRequestRecord[];
  violations: RuleViolation[];
}) {
  const { report, score, scanning, elapsed, framework } = state;
  const scoreObj = report?.score;

  const color =
    score >= 90 ? S.COLORS.green :
    score >= 70 ? S.COLORS.blue :
    score >= 50 ? S.COLORS.orange :
    S.COLORS.red;

  const dash = Math.round((score / 100) * 251);

  const crits = violations.filter((v) => v.severity === 'critical').length;
  const warns = violations.filter((v) => v.severity === 'warning').length;
  const infos = violations.filter((v) => v.severity === 'info').length;

  const totalTimeSaved = violations.reduce((s, v) => s + (v.impact?.timeSavedMs ?? 0), 0);
  const totalReqsSaved = violations.reduce((s, v) => s + (v.impact?.requestsEliminated ?? 0), 0);

  return (
    <>
      {/* Score Ring + Stats */}
      <div style={S.scoreRingContainerStyle}>
        <div style={S.scoreRingStyle}>
          <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="50" cy="50" r="40" fill="none" stroke={S.COLORS.bg3} strokeWidth="6" />
            <circle
              cx="50" cy="50" r="40" fill="none"
              stroke={color} strokeWidth="6"
              strokeDasharray={`${dash} 251`}
              strokeLinecap="round"
            />
          </svg>
          <div style={S.scoreNumberStyle(color)}>{score}</div>
          <div style={S.scoreGradeStyle(color)}>
            {score >= 90 ? 'A+' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'F'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>API Health</div>
          <div style={{ fontSize: '10px', color: S.COLORS.fg3 }}>
            {apiRequests.length} API calls · {elapsed}s
          </div>
          {framework && (
            <div style={{ fontSize: '10px', color: S.COLORS.accent, marginTop: '2px' }}>
              ⚛️ {framework}
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div style={S.statsGridStyle}>
        <div style={S.statCardStyle(S.COLORS.red)}>
          <div style={S.statNumStyle(S.COLORS.red)}>{crits}</div>
          <div style={S.statLabelStyle}>Critical</div>
        </div>
        <div style={S.statCardStyle(S.COLORS.orange)}>
          <div style={S.statNumStyle(S.COLORS.orange)}>{warns}</div>
          <div style={S.statLabelStyle}>Warnings</div>
        </div>
        <div style={S.statCardStyle(S.COLORS.blue)}>
          <div style={S.statNumStyle(S.COLORS.blue)}>{apiRequests.length}</div>
          <div style={S.statLabelStyle}>API Calls</div>
        </div>
      </div>

      {/* Impact Banner */}
      {(totalTimeSaved > 0 || totalReqsSaved > 0) && (
        <div style={S.infoRowStyle}>
          {totalTimeSaved > 0 && (
            <span style={{ color: S.COLORS.blue, fontWeight: 600 }}>
              ⚡ {fmtMs(totalTimeSaved)} saveable
            </span>
          )}
          {totalReqsSaved > 0 && (
            <span style={{ color: S.COLORS.green, fontWeight: 600 }}>
              📉 {totalReqsSaved} fewer requests
            </span>
          )}
        </div>
      )}

      {/* Category Bars */}
      {scoreObj && (() => {
        const cats = scoreObj.categories ?? [];
        const getCat = (cat: string) => cats.find((c: any) => c.category === cat)?.score ?? 100;
        return (
          <div style={{ marginBottom: '12px' }}>
            <CategoryBar icon="⚡" name="Efficiency" score={getCat('efficiency')} />
            <CategoryBar icon="💾" name="Caching" score={getCat('caching')} />
            <CategoryBar icon="🔄" name="Patterns" score={getCat('patterns')} />
          </div>
        );
      })()}

      {/* Top Issues */}
      {violations.length > 0 && (
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: S.COLORS.fg2, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Top Issues
          </div>
          {violations.slice(0, 3).map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: '10px' }}>
              <span style={S.severityDotStyle(v.severity)} />
              <span style={S.ruleIdBadgeStyle}>{v.ruleId}</span>
              <span style={{ color: S.COLORS.fg2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.title}
              </span>
              {v.impact?.timeSavedMs > 0 && (
                <span style={{ color: S.COLORS.blue, fontSize: '9px', fontWeight: 600 }}>
                  ⚡{fmtMs(v.impact.timeSavedMs)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {violations.length === 0 && !scanning && apiRequests.length > 0 && (
        <div style={S.emptyStateStyle}>
          <div style={{ fontSize: '24px', marginBottom: '6px' }}>✨</div>
          <div style={{ color: S.COLORS.green, fontWeight: 700 }}>No API issues found!</div>
        </div>
      )}

      {scanning && apiRequests.length === 0 && (
        <div style={S.emptyStateStyle}>
          <div style={{ fontSize: '24px', marginBottom: '6px' }}>📡</div>
          Waiting for API requests...
        </div>
      )}
    </>
  );
}

// ─── Violations Tab ─────────────────────────────────────────────

function ViolationsTab({ violations }: { violations: RuleViolation[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (violations.length === 0) {
    return (
      <div style={S.emptyStateStyle}>
        <div style={{ fontSize: '24px', marginBottom: '6px' }}>✨</div>
        No violations detected
      </div>
    );
  }

  return (
    <>
      {violations.map((v, i) => (
        <div key={i} style={S.violationCardStyle}>
          <div
            style={{ ...S.violationHeaderStyle, cursor: 'pointer' }}
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            <span style={S.severityDotStyle(v.severity)} />
            <span style={S.ruleIdBadgeStyle}>{v.ruleId}</span>
            <span style={{ ...S.violationTitleStyle, fontSize: '10px', color: S.COLORS.fg3 }}>
              {RULE_NAMES[v.ruleId] || v.ruleId}
            </span>
            <span style={{ color: S.COLORS.fg3, fontSize: '10px' }}>
              {expanded === i ? '▾' : '▸'}
            </span>
          </div>

          <div style={{ ...S.violationTitleStyle, marginTop: '2px' }}>{v.title}</div>

          {/* Impact pills */}
          <div style={S.violationImpactStyle}>
            {v.impact?.timeSavedMs > 0 && (
              <span style={S.impactItemStyle(S.COLORS.blue)}>⚡ {fmtMs(v.impact.timeSavedMs)}</span>
            )}
            {v.impact?.requestsEliminated > 0 && (
              <span style={S.impactItemStyle(S.COLORS.green)}>📉 {v.impact.requestsEliminated} reqs</span>
            )}
            {v.impact?.bandwidthSavedBytes > 0 && (
              <span style={S.impactItemStyle(S.COLORS.orange)}>💾 {fmtBytes(v.impact.bandwidthSavedBytes)}</span>
            )}
          </div>

          {/* Expanded Details */}
          {expanded === i && (
            <div style={{ marginTop: '8px' }}>
              <div style={S.violationDescStyle}>{v.description}</div>

              {v.affectedEndpoints && v.affectedEndpoints.length > 0 && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ fontSize: '9px', color: S.COLORS.fg3, fontWeight: 600, marginBottom: '3px' }}>
                    ENDPOINTS
                  </div>
                  {v.affectedEndpoints.slice(0, 5).map((ep: string, j: number) => (
                    <div key={j} style={{ fontSize: '10px', fontFamily: S.FONTS.mono, color: S.COLORS.fg2, padding: '1px 0' }}>
                      {ep}
                    </div>
                  ))}
                </div>
              )}

              {v.metadata?.fix && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ fontSize: '9px', color: S.COLORS.fg3, fontWeight: 600, marginBottom: '3px' }}>
                    FIX
                  </div>
                  <pre style={{
                    fontSize: '9px', fontFamily: S.FONTS.mono, color: S.COLORS.accent2,
                    background: S.COLORS.bg, borderRadius: '4px', padding: '6px',
                    overflow: 'auto', maxHeight: '120px', lineHeight: '1.4',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {typeof v.metadata.fix === 'string' ? v.metadata.fix : (v.metadata.fix as any)?.code ?? ''}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ─── Requests Tab ───────────────────────────────────────────────

function RequestsTab({ requests }: { requests: FluxRequestRecord[] }) {
  const sorted = useMemo(
    () => [...requests].sort((a, b) => b.startTime - a.startTime),
    [requests]
  );

  if (sorted.length === 0) {
    return (
      <div style={S.emptyStateStyle}>
        <div style={{ fontSize: '24px', marginBottom: '6px' }}>📡</div>
        No API requests captured yet
      </div>
    );
  }

  return (
    <>
      <div style={{ fontSize: '10px', color: S.COLORS.fg3, marginBottom: '6px' }}>
        {sorted.length} API requests (newest first)
      </div>
      {sorted.slice(0, 50).map((r, i) => {
        const path = r.urlParts?.pathname ?? new URL(r.url, 'http://x').pathname;
        const short = path.length > 40 ? '…' + path.slice(-37) : path;
        const status = r.response?.status ?? 0;

        return (
          <div key={i} style={S.requestRowStyle}>
            <span style={S.methodBadgeStyle(r.method)}>{r.method}</span>
            <span style={S.pathStyle} title={r.url}>{short}</span>
            {status > 0 && <span style={S.statusStyle(status)}>{status}</span>}
            <span style={S.durationStyle(r.duration ?? 0)}>{r.duration ?? 0}ms</span>
          </div>
        );
      })}
    </>
  );
}

// ─── Category Bar Component ─────────────────────────────────────

function CategoryBar({ icon, name, score }: { icon: string; name: string; score: number }) {
  const color = score >= 70 ? S.COLORS.green : score >= 50 ? S.COLORS.orange : S.COLORS.red;
  return (
    <div style={S.catRowStyle}>
      <span>{icon}</span>
      <span style={S.catNameStyle}>{name}</span>
      <div style={S.catTrackStyle}>
        <div style={S.catFillStyle(score, color)} />
      </div>
      <span style={S.catPctStyle(color)}>{score}%</span>
    </div>
  );
}

// ─── Format Helpers ─────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
