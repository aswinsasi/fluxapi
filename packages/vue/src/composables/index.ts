// ═══════════════════════════════════════════════════════════════════
// Vue Composables — reactive access to FluxAPI scan data
// ═══════════════════════════════════════════════════════════════════

import {
  ref,
  reactive,
  computed,
  onMounted,
  onUnmounted,
  type Ref,
  type ComputedRef,
} from 'vue';
import { useFluxBridge } from '../plugin';
import type { FluxReport, RuleViolation, FluxRequestRecord } from '@fluxiapi/scan';
import type { FluxState, ScannerBridge } from '../scanner-bridge';

// ─── useFluxState — full reactive state ─────────────────────────

export function useFluxState(): {
  state: Ref<FluxState>;
  bridge: ScannerBridge;
} {
  const bridge = useFluxBridge();
  const state = ref<FluxState>({ ...bridge.state });

  let unsub: (() => void) | null = null;

  onMounted(() => {
    unsub = bridge.subscribe((newState) => {
      state.value = { ...newState };
    });
    // Sync initial state
    state.value = { ...bridge.state };
  });

  onUnmounted(() => {
    unsub?.();
  });

  return { state, bridge };
}

// ─── useFluxScore ───────────────────────────────────────────────

export interface ScoreInfo {
  overall: number;
  grade: string;
  efficiency: number;
  caching: number;
  patterns: number;
  color: string;
}

export function useFluxScore(): ComputedRef<ScoreInfo> {
  const { state } = useFluxState();

  return computed(() => {
    const score = state.value.report?.score;
    const overall = score?.overall ?? 100;

    const cats = score?.categories ?? [];
    const getCat = (cat: string) => cats.find((c) => c.category === cat)?.score ?? 100;

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
  });
}

// ─── useFluxViolations ──────────────────────────────────────────

export interface ViolationFilter {
  severity?: 'critical' | 'warning' | 'info';
  category?: 'efficiency' | 'caching' | 'patterns';
  ruleId?: string;
}

export function useFluxViolations(filter?: ViolationFilter): ComputedRef<RuleViolation[]> {
  const { state } = useFluxState();

  return computed(() => {
    let violations = state.value.violations;

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
  });
}

// ─── useFluxRequests ────────────────────────────────────────────

export interface RequestFilter {
  type?: string;
  method?: string;
  minDuration?: number;
}

export function useFluxRequests(filter?: RequestFilter): ComputedRef<FluxRequestRecord[]> {
  const { state } = useFluxState();

  return computed(() => {
    let requests = state.value.requests;

    if (filter?.type) {
      requests = requests.filter((r) => r.type === filter.type);
    }
    if (filter?.method) {
      requests = requests.filter((r) => r.method === filter.method);
    }
    if (filter?.minDuration) {
      const min = filter.minDuration;
      requests = requests.filter((r) => (r.duration ?? 0) >= min);
    }

    return requests;
  });
}

// ─── useFluxReport ──────────────────────────────────────────────

export function useFluxReport(): ComputedRef<FluxReport | null> {
  const { state } = useFluxState();
  return computed(() => state.value.report);
}

// ─── useFluxScanning ────────────────────────────────────────────

export function useFluxScanning(): {
  scanning: ComputedRef<boolean>;
  elapsed: ComputedRef<number>;
  requestCount: ComputedRef<number>;
  start: () => void;
  stop: () => void;
  reset: () => void;
} {
  const { state, bridge } = useFluxState();

  return {
    scanning: computed(() => state.value.scanning),
    elapsed: computed(() => state.value.elapsed),
    requestCount: computed(() => state.value.requests.length),
    start: () => bridge.start(),
    stop: () => bridge.stop(),
    reset: () => bridge.reset(),
  };
}
