// ═══════════════════════════════════════════════════════════════════
// @fluxiapi/vue Tests
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScannerBridge, getGlobalBridge, resetGlobalBridge } from '../scanner-bridge';

// ─── Scanner Bridge ─────────────────────────────────────────────

describe('ScannerBridge', () => {
  let bridge: ScannerBridge;

  beforeEach(() => {
    bridge = new ScannerBridge({ autoStart: false, verbose: false });
  });

  afterEach(() => {
    bridge.destroy();
  });

  it('initializes with default state', () => {
    const state = bridge.state;
    expect(state.scanning).toBe(false);
    expect(state.score).toBe(100);
    expect(state.violations).toEqual([]);
    expect(state.requests).toEqual([]);
    expect(state.report).toBeNull();
    expect(state.network).toBe('wifi');
    expect(state.framework).toBeNull();
  });

  it('subscribes and unsubscribes', () => {
    const listener = vi.fn();
    const unsub = bridge.subscribe(listener);

    bridge.setNetwork('jio-4g');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'jio-4g' })
    );

    unsub();
    bridge.setNetwork('wifi');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setNetwork updates state', () => {
    bridge.setNetwork('bsnl-2g');
    expect(bridge.state.network).toBe('bsnl-2g');
  });

  it('reset clears all state', () => {
    bridge.setNetwork('jio-4g');
    bridge.reset();
    expect(bridge.state.scanning).toBe(false);
    expect(bridge.state.requests).toEqual([]);
    expect(bridge.state.report).toBeNull();
  });

  it('captureQueryEvent runs without error', () => {
    expect(() => {
      bridge.captureQueryEvent({
        type: 'query-added',
        queryKey: ['users'],
        state: { status: 'success', fetchStatus: 'idle', dataUpdatedAt: Date.now() },
        options: { staleTime: 30000 },
      });
    }).not.toThrow();
  });
});

// ─── Global Bridge Singleton ────────────────────────────────────

describe('Global Bridge', () => {
  afterEach(() => {
    resetGlobalBridge();
  });

  it('returns the same instance', () => {
    const a = getGlobalBridge();
    const b = getGlobalBridge();
    expect(a).toBe(b);
  });

  it('reset creates a new instance', () => {
    const a = getGlobalBridge();
    resetGlobalBridge();
    const b = getGlobalBridge();
    expect(a).not.toBe(b);
  });

  it('accepts config on first call', () => {
    const bridge = getGlobalBridge({ network: 'jio-4g' });
    expect(bridge.state.network).toBe('jio-4g');
  });
});

// ─── TanStack Vue Query Integration ─────────────────────────────

describe('wrapQueryClient', () => {
  it('wraps without error', async () => {
    const { wrapQueryClient } = await import('../integrations/tanstack');

    const mockSubscribe = vi.fn();
    const mockQC = {
      getQueryCache: () => ({
        subscribe: mockSubscribe,
        getAll: () => [],
      }),
    };

    const wrapped = wrapQueryClient(mockQC);
    expect(wrapped).toBe(mockQC);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('handles missing getQueryCache gracefully', async () => {
    const { wrapQueryClient } = await import('../integrations/tanstack');
    expect(() => wrapQueryClient({})).not.toThrow();
  });
});

describe('extractQueryMetrics', () => {
  it('extracts metrics from mock QueryClient', async () => {
    const { extractQueryMetrics } = await import('../integrations/tanstack');

    const mockQC = {
      getQueryCache: () => ({
        getAll: () => [
          { options: { staleTime: 30000, refetchInterval: false, retry: 3 } },
          { options: { staleTime: 0, refetchInterval: 5000, retry: false } },
          { options: { staleTime: 60000, retry: 3 } },
        ],
      }),
    };

    const metrics = extractQueryMetrics(mockQC);
    expect(metrics.uniqueQueries).toBe(3);
    expect(metrics.queriesWithoutStaleTime).toBe(1);
    expect(metrics.pollingQueries).toBe(1);
    expect(metrics.noRetryQueries).toBe(1);
    expect(metrics.avgStaleTime).toBe(45000);
  });
});

// ─── FluxDevTools Component ─────────────────────────────────────

describe('FluxDevTools', () => {
  it('is a valid Vue component', async () => {
    const { FluxDevTools } = await import('../devtools/FluxDevTools');
    expect(FluxDevTools).toBeDefined();
    expect(FluxDevTools.name).toBe('FluxDevTools');
    expect(FluxDevTools.setup).toBeTypeOf('function');
  });

  it('has correct default props', async () => {
    const { FluxDevTools } = await import('../devtools/FluxDevTools');
    const props = FluxDevTools.props as any;
    expect(props.position.default).toBe('bottom-right');
    expect(props.network.default).toBe('wifi');
    expect(props.analysisInterval.default).toBe(3000);
    expect(props.autoStart.default).toBe(true);
    expect(props.defaultOpen.default).toBe(false);
    expect(props.verbose.default).toBe(false);
    expect(props.forceShow.default).toBe(false);
    expect(props.shortcut.default).toBe('ctrl+shift+f');
  });
});

// ─── Plugin ─────────────────────────────────────────────────────

describe('FluxPlugin', () => {
  it('exports plugin with install method', async () => {
    const { FluxPlugin } = await import('../plugin');
    expect(FluxPlugin).toBeDefined();
    expect(FluxPlugin.install).toBeTypeOf('function');
  });
});

// ─── Export Verification ────────────────────────────────────────

describe('Package exports', () => {
  it('exports all expected symbols', async () => {
    const mod = await import('../index');

    // DevTools
    expect(mod.FluxDevTools).toBeDefined();

    // Plugin
    expect(mod.FluxPlugin).toBeDefined();
    expect(mod.useFluxBridge).toBeDefined();
    expect(mod.FLUX_BRIDGE_KEY).toBeDefined();

    // Composables
    expect(mod.useFluxState).toBeDefined();
    expect(mod.useFluxScore).toBeDefined();
    expect(mod.useFluxViolations).toBeDefined();
    expect(mod.useFluxRequests).toBeDefined();
    expect(mod.useFluxReport).toBeDefined();
    expect(mod.useFluxScanning).toBeDefined();

    // TanStack
    expect(mod.wrapQueryClient).toBeDefined();
    expect(mod.extractQueryMetrics).toBeDefined();

    // Bridge
    expect(mod.ScannerBridge).toBeDefined();
    expect(mod.getGlobalBridge).toBeDefined();
    expect(mod.resetGlobalBridge).toBeDefined();
  });
});
