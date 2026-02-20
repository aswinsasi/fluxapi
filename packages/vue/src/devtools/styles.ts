// ═══════════════════════════════════════════════════════════════════
// FluxDevTools Styles — CSS-in-JS constants for Vue components
// ═══════════════════════════════════════════════════════════════════

export const C = {
  bg: '#0f0f13', bg2: '#16161d', bg3: '#1e1e28',
  border: '#2a2a3a', fg: '#e2e2e6', fg2: '#a0a0b0', fg3: '#6a6a7a',
  accent: '#7c6afc', accent2: '#a78bfa',
  green: '#22c55e', blue: '#3b82f6', orange: '#f59e0b', red: '#ef4444', cyan: '#06b6d4',
} as const;

export const MONO = '"SF Mono", "Fira Code", "JetBrains Mono", Menlo, monospace';
export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function scoreColor(s: number): string {
  return s >= 90 ? C.green : s >= 70 ? C.blue : s >= 50 ? C.orange : C.red;
}

export function severityColor(sev: string): string {
  return sev === 'critical' ? C.red : sev === 'warning' ? C.orange : C.blue;
}

export function methodColor(m: string): string {
  return m === 'GET' ? C.green : m === 'POST' ? C.blue : m === 'PUT' ? C.orange : m === 'DELETE' ? C.red : C.fg3;
}

export function durationColor(ms: number): string {
  return ms > 500 ? C.red : ms > 200 ? C.orange : C.green;
}

export function statusColor(s: number): string {
  return s >= 500 ? C.red : s >= 400 ? C.orange : s >= 300 ? C.blue : C.green;
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function fmtBytes(b: number): string {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)}MB`;
  if (b >= 1024) return `${Math.round(b / 1024)}KB`;
  return `${b}B`;
}

// ─── Inject CSS keyframes once ──────────────────────────────────

let _injected = false;

export function injectStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes fluxPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    .flux-devtools * { box-sizing: border-box; }
    .flux-devtools ::-webkit-scrollbar { width: 4px; }
    .flux-devtools ::-webkit-scrollbar-track { background: transparent; }
    .flux-devtools ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
  `;
  document.head.appendChild(style);
}

export const RULE_NAMES: Record<string, string> = {
  E1: 'Request Waterfall', E2: 'Duplicate Requests', E3: 'N+1 Pattern',
  E4: 'Over-fetching', E5: 'Batchable Requests',
  C1: 'No Cache', C2: 'Under-Caching', C3: 'Over-Caching', C4: 'Missing Revalidation',
  P1: 'Missing Prefetch', P2: 'Unnecessary Polling', P3: 'No Error Recovery', P4: 'Uncompressed',
};
