// ═══════════════════════════════════════════════════════════════════
// React Hooks — convenient access to FluxAPI scan data
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { useFlux } from '../context';
import type { RuleViolation, FluxRequestRecord, FluxReport } from '@fluxiapi/scan';
import type { FluxState } from '../scanner-bridge';

// ─── useFluxScore ───────────────────────────────────────────────

export interface ScoreInfo {
  overall: number;
  grade: string;
  efficiency: number;
  caching: number;
  patterns: number;
  color: string;
}

export function useFluxScore(): ScoreInfo {
  const { state } = useFlux();

  return useMemo(() => {
    const score = state.report?.score;
    const overall = score?.overall ?? 100;

    // Extract category scores from categories array
    const cats = score?.categories ?? [];
    const getCat = (label: string) => cats.find((c) => c.category === label)?.score ?? 100;

    return {
      overall,
      grade: score?.grade ?? 'excellent',
      efficiency: getCat('efficiency'),
      caching: getCat('caching'),
      patterns: getCat('patterns'),
      color:
        overall >= 90 ? '#22c55e' :
        overall >= 70 ? '#3b82f6' :
        overall >= 50 ? '#f59e0b' :
        '#ef4444',
    };
  }, [state.report?.score]);
}

// ─── useFluxViolations ──────────────────────────────────────────

export interface ViolationFilter {
  severity?: 'critical' | 'warning' | 'info';
  category?: 'efficiency' | 'caching' | 'patterns';
  ruleId?: string;
}

export function useFluxViolations(filter?: ViolationFilter): RuleViolation[] {
  const { state } = useFlux();

  return useMemo(() => {
    let violations = state.violations;

    if (filter?.severity) {
      violations = violations.filter((v) => v.severity === filter.severity);
    }

    if (filter?.ruleId) {
      violations = violations.filter((v) => v.ruleId === filter.ruleId);
    }

    if (filter?.category) {
      const prefixMap: Record<string, string[]> = {
        efficiency: ['E1', 'E2', 'E3', 'E4', 'E5'],
        caching: ['C1', 'C2', 'C3', 'C4'],
        patterns: ['P1', 'P2', 'P3', 'P4'],
      };
      const allowed = prefixMap[filter.category] ?? [];
      violations = violations.filter((v) => allowed.includes(v.ruleId));
    }

    return violations;
  }, [state.violations, filter?.severity, filter?.ruleId, filter?.category]);
}

// ─── useFluxRequests ────────────────────────────────────────────

export interface RequestFilter {
  type?: 'api-rest' | 'api-graphql' | 'static' | 'document';
  method?: string;
  minDuration?: number;
}

export function useFluxRequests(filter?: RequestFilter): FluxRequestRecord[] {
  const { state } = useFlux();

  return useMemo(() => {
    let requests = state.requests;

    if (filter?.type) {
      requests = requests.filter((r) => r.type === filter.type);
    }
    if (filter?.method) {
      requests = requests.filter((r) => r.method === filter.method);
    }
    if (filter?.minDuration) {
      requests = requests.filter((r) => (r.duration ?? 0) >= (filter.minDuration ?? 0));
    }

    return requests;
  }, [state.requests, filter?.type, filter?.method, filter?.minDuration]);
}

// ─── useFluxReport ──────────────────────────────────────────────

export function useFluxReport(): FluxReport | null {
  const { state } = useFlux();
  return state.report;
}

// ─── useFluxScanning ────────────────────────────────────────────

export function useFluxScanning(): {
  scanning: boolean;
  elapsed: number;
  requestCount: number;
  start: () => void;
  stop: () => void;
  reset: () => void;
} {
  const { bridge, state } = useFlux();

  return useMemo(
    () => ({
      scanning: state.scanning,
      elapsed: state.elapsed,
      requestCount: state.requests.length,
      start: () => bridge.start(),
      stop: () => bridge.stop(),
      reset: () => bridge.reset(),
    }),
    [bridge, state.scanning, state.elapsed, state.requests.length]
  );
}
