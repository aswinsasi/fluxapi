// ═══════════════════════════════════════════════════════════════════
// FluxDevTools Styles — all CSS-in-JS, zero external deps
// ═══════════════════════════════════════════════════════════════════

export const COLORS = {
  bg: '#0f0f13',
  bg2: '#16161d',
  bg3: '#1e1e28',
  border: '#2a2a3a',
  fg: '#e2e2e6',
  fg2: '#a0a0b0',
  fg3: '#6a6a7a',
  accent: '#7c6afc',
  accent2: '#a78bfa',
  green: '#22c55e',
  blue: '#3b82f6',
  orange: '#f59e0b',
  red: '#ef4444',
  cyan: '#06b6d4',
} as const;

export const FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"SF Mono", "Fira Code", "JetBrains Mono", Menlo, monospace',
} as const;

// ─── Base Container ─────────────────────────────────────────────

export const containerStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 2147483647,
  fontFamily: FONTS.sans,
  fontSize: '12px',
  lineHeight: '1.5',
  color: COLORS.fg,
  WebkitFontSmoothing: 'antialiased',
};

// ─── Badge (collapsed state) ────────────────────────────────────

export const badgeStyle = (score: number, position: string): React.CSSProperties => {
  const color =
    score >= 90 ? COLORS.green :
    score >= 70 ? COLORS.blue :
    score >= 50 ? COLORS.orange :
    COLORS.red;

  const pos = parsePosition(position);

  return {
    ...pos,
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: COLORS.bg,
    border: `2px solid ${color}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px ${COLORS.border}`,
    transition: 'all 0.2s ease',
    userSelect: 'none',
  };
};

export const badgeScoreStyle = (score: number): React.CSSProperties => ({
  fontSize: '14px',
  fontWeight: 800,
  lineHeight: '1',
  color:
    score >= 90 ? COLORS.green :
    score >= 70 ? COLORS.blue :
    score >= 50 ? COLORS.orange :
    COLORS.red,
});

export const badgeLabelStyle: React.CSSProperties = {
  fontSize: '6px',
  fontWeight: 600,
  color: COLORS.fg3,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
};

// ─── Scanning Badge ─────────────────────────────────────────────

export const scanningDotStyle: React.CSSProperties = {
  width: '10px',
  height: '10px',
  borderRadius: '50%',
  background: COLORS.accent,
  animation: 'fluxPulse 1.5s ease-in-out infinite',
};

// ─── Panel (expanded state) ─────────────────────────────────────

export const panelStyle = (position: string): React.CSSProperties => {
  const isRight = position.includes('right');
  const isBottom = position.includes('bottom');

  return {
    position: 'fixed',
    [isBottom ? 'bottom' : 'top']: '16px',
    [isRight ? 'right' : 'left']: '16px',
    width: '380px',
    maxHeight: 'min(580px, calc(100vh - 40px))',
    background: COLORS.bg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '12px',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };
};

// ─── Panel Header ───────────────────────────────────────────────

export const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  background: COLORS.bg2,
  borderBottom: `1px solid ${COLORS.border}`,
  cursor: 'move',
};

export const panelTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  fontWeight: 700,
  color: COLORS.fg,
};

export const panelCloseBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: COLORS.fg3,
  cursor: 'pointer',
  fontSize: '16px',
  padding: '2px 4px',
  borderRadius: '4px',
  lineHeight: '1',
};

// ─── Tabs ───────────────────────────────────────────────────────

export const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: `1px solid ${COLORS.border}`,
  background: COLORS.bg2,
};

export const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '7px 0',
  fontSize: '10px',
  fontWeight: 600,
  textAlign: 'center',
  cursor: 'pointer',
  color: active ? COLORS.accent : COLORS.fg3,
  borderBottom: active ? `2px solid ${COLORS.accent}` : '2px solid transparent',
  background: 'none',
  border: 'none',
  borderBottomStyle: 'solid',
  transition: 'all 0.15s',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
});

// ─── Panel Body ─────────────────────────────────────────────────

export const panelBodyStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '12px',
};

// ─── Score Ring ─────────────────────────────────────────────────

export const scoreRingContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '14px',
};

export const scoreRingStyle: React.CSSProperties = {
  width: '72px',
  height: '72px',
  position: 'relative',
  flexShrink: 0,
};

export const scoreNumberStyle = (color: string): React.CSSProperties => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -55%)',
  fontSize: '22px',
  fontWeight: 800,
  color,
  lineHeight: '1',
});

export const scoreGradeStyle = (color: string): React.CSSProperties => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, 50%)',
  fontSize: '8px',
  fontWeight: 600,
  color,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
});

// ─── Category Bars ──────────────────────────────────────────────

export const catRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '6px',
  fontSize: '11px',
};

export const catNameStyle: React.CSSProperties = {
  width: '70px',
  color: COLORS.fg2,
};

export const catTrackStyle: React.CSSProperties = {
  flex: 1,
  height: '6px',
  borderRadius: '3px',
  background: COLORS.bg3,
  overflow: 'hidden',
};

export const catFillStyle = (pct: number, color: string): React.CSSProperties => ({
  width: `${pct}%`,
  height: '100%',
  borderRadius: '3px',
  background: color,
  transition: 'width 0.5s ease',
});

export const catPctStyle = (color: string): React.CSSProperties => ({
  width: '32px',
  textAlign: 'right',
  fontWeight: 700,
  fontFamily: FONTS.mono,
  fontSize: '10px',
  color,
});

// ─── Violation Card ─────────────────────────────────────────────

export const violationCardStyle: React.CSSProperties = {
  background: COLORS.bg2,
  border: `1px solid ${COLORS.border}`,
  borderRadius: '8px',
  padding: '10px',
  marginBottom: '8px',
};

export const violationHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginBottom: '4px',
};

export const severityDotStyle = (severity: string): React.CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  flexShrink: 0,
  background:
    severity === 'critical' ? COLORS.red :
    severity === 'warning' ? COLORS.orange :
    COLORS.blue,
});

export const ruleIdBadgeStyle: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 700,
  fontFamily: FONTS.mono,
  color: COLORS.accent,
  padding: '1px 4px',
  borderRadius: '3px',
  background: 'rgba(124, 106, 252, 0.12)',
};

export const violationTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: COLORS.fg,
  flex: 1,
};

export const violationDescStyle: React.CSSProperties = {
  fontSize: '10px',
  color: COLORS.fg3,
  lineHeight: '1.4',
};

export const violationImpactStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  marginTop: '6px',
  fontSize: '10px',
};

export const impactItemStyle = (color: string): React.CSSProperties => ({
  color,
  fontWeight: 600,
  fontFamily: FONTS.mono,
});

// ─── Request Row ────────────────────────────────────────────────

export const requestRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 0',
  borderBottom: `1px solid ${COLORS.border}`,
  fontSize: '10px',
};

export const methodBadgeStyle = (method: string): React.CSSProperties => ({
  fontSize: '9px',
  fontWeight: 700,
  fontFamily: FONTS.mono,
  padding: '1px 4px',
  borderRadius: '3px',
  color: method === 'GET' ? COLORS.green : method === 'POST' ? COLORS.blue : COLORS.orange,
  background:
    method === 'GET' ? 'rgba(34, 197, 94, 0.1)' :
    method === 'POST' ? 'rgba(59, 130, 246, 0.1)' :
    'rgba(245, 158, 11, 0.1)',
  minWidth: '32px',
  textAlign: 'center',
});

export const pathStyle: React.CSSProperties = {
  flex: 1,
  color: COLORS.fg2,
  fontFamily: FONTS.mono,
  fontSize: '10px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const durationStyle = (ms: number): React.CSSProperties => ({
  fontFamily: FONTS.mono,
  fontWeight: 600,
  fontSize: '10px',
  color: ms > 500 ? COLORS.red : ms > 200 ? COLORS.orange : COLORS.green,
  minWidth: '40px',
  textAlign: 'right',
});

export const statusStyle = (status: number): React.CSSProperties => ({
  fontFamily: FONTS.mono,
  fontSize: '9px',
  fontWeight: 600,
  color:
    status >= 500 ? COLORS.red :
    status >= 400 ? COLORS.orange :
    status >= 300 ? COLORS.blue :
    COLORS.green,
  minWidth: '24px',
  textAlign: 'center',
});

// ─── Stats Grid ─────────────────────────────────────────────────

export const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '8px',
  marginBottom: '14px',
};

export const statCardStyle = (color: string): React.CSSProperties => ({
  background: COLORS.bg2,
  border: `1px solid ${COLORS.border}`,
  borderRadius: '8px',
  padding: '8px',
  textAlign: 'center',
});

export const statNumStyle = (color: string): React.CSSProperties => ({
  fontSize: '18px',
  fontWeight: 800,
  color,
  lineHeight: '1.2',
});

export const statLabelStyle: React.CSSProperties = {
  fontSize: '9px',
  color: COLORS.fg3,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
};

// ─── Info Row ───────────────────────────────────────────────────

export const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 10px',
  background: COLORS.bg2,
  borderRadius: '6px',
  marginBottom: '8px',
  fontSize: '10px',
  color: COLORS.fg2,
};

// ─── Empty State ────────────────────────────────────────────────

export const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '24px',
  color: COLORS.fg3,
  fontSize: '12px',
};

// ─── Helpers ────────────────────────────────────────────────────

function parsePosition(pos: string): React.CSSProperties {
  switch (pos) {
    case 'bottom-right': return { bottom: '16px', right: '16px' };
    case 'bottom-left': return { bottom: '16px', left: '16px' };
    case 'top-right': return { top: '16px', right: '16px' };
    case 'top-left': return { top: '16px', left: '16px' };
    default: return { bottom: '16px', right: '16px' };
  }
}

// ─── Keyframes (injected once) ──────────────────────────────────

let _stylesInjected = false;

export function injectKeyframes() {
  if (_stylesInjected || typeof document === 'undefined') return;
  _stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes fluxPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    @keyframes fluxFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .flux-devtools * { box-sizing: border-box; }
    .flux-devtools ::-webkit-scrollbar { width: 4px; }
    .flux-devtools ::-webkit-scrollbar-track { background: transparent; }
    .flux-devtools ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
  `;
  document.head.appendChild(style);
}
