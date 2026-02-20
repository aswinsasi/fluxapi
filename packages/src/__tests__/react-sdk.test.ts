// ═══════════════════════════════════════════════════════════════════
// @fluxiapi/react Tests
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

  it('subscribes and unsubscribes to state changes', () => {
    const listener = vi.fn();
    const unsub = bridge.subscribe(listener);

    bridge.setNetwork('jio-4g');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'jio-4g' })
    );

    unsub();
    bridge.setNetwork('wifi');
    expect(listener).toHaveBeenCalledTimes(1); // Not called again
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
    expect(bridge.state.score).toBe(100);
  });

  it('captureQueryEvent runs without error', () => {
    expect(() => {
      bridge.captureQueryEvent({
        type: 'query-added',
        queryKey: ['users'],
        state: { status: 'success', fetchStatus: 'idle', dataUpdatedAt: Date.now() },
        options: { staleTime: 30000, gcTime: 300000 },
      });
    }).not.toThrow();
  });

  it('captureSWREvent runs without error', () => {
    expect(() => {
      bridge.captureSWREvent({
        type: 'swr-request',
        key: '/api/users',
        config: { refreshInterval: 5000, dedupingInterval: 2000 },
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

// ─── TanStack Integration ───────────────────────────────────────

describe('wrapQueryClient', () => {
  it('wraps without error', async () => {
    const { wrapQueryClient } = await import('../integrations/tanstack');

    // Mock QueryClient
    const mockSubscribe = vi.fn();
    const mockQC = {
      getQueryCache: () => ({
        subscribe: mockSubscribe,
        getAll: () => [],
      }),
    };

    const wrapped = wrapQueryClient(mockQC);
    expect(wrapped).toBe(mockQC); // Returns same object
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('handles missing getQueryCache gracefully', async () => {
    const { wrapQueryClient } = await import('../integrations/tanstack');

    const mockQC = {};
    expect(() => wrapQueryClient(mockQC)).not.toThrow();
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
    expect(metrics.avgStaleTime).toBe(45000); // (30000 + 60000) / 2
  });

  it('handles empty cache', async () => {
    const { extractQueryMetrics } = await import('../integrations/tanstack');

    const mockQC = {
      getQueryCache: () => ({ getAll: () => [] }),
    };

    const metrics = extractQueryMetrics(mockQC);
    expect(metrics.uniqueQueries).toBe(0);
    expect(metrics.avgStaleTime).toBe(0);
  });
});

// ─── SWR Integration ────────────────────────────────────────────

describe('SWR middleware', () => {
  it('createFluxSWRMiddleware returns a function', async () => {
    const { createFluxSWRMiddleware } = await import('../integrations/swr');

    const bridge = new ScannerBridge({ autoStart: false });
    const middleware = createFluxSWRMiddleware(bridge);
    expect(typeof middleware).toBe('function');
    bridge.destroy();
  });

  it('middleware wraps useSWRNext', async () => {
    const { createFluxSWRMiddleware } = await import('../integrations/swr');

    const bridge = new ScannerBridge({ autoStart: false });
    const middleware = createFluxSWRMiddleware(bridge);

    const mockResult = { data: 'test' };
    const mockUseSWRNext = vi.fn().mockReturnValue(mockResult);

    const wrappedHook = middleware(mockUseSWRNext);
    const result = wrappedHook('/api/users', null, {});

    expect(mockUseSWRNext).toHaveBeenCalled();
    expect(result).toBe(mockResult);

    bridge.destroy();
  });
});

// ─── Export Verification ────────────────────────────────────────

describe('Package exports', () => {
  it('exports all expected symbols', async () => {
    const mod = await import('../index');

    // DevTools
    expect(mod.FluxDevTools).toBeDefined();

    // Context
    expect(mod.FluxProvider).toBeDefined();
    expect(mod.useFlux).toBeDefined();
    expect(mod.useFluxBridge).toBeDefined();
    expect(mod.useFluxState).toBeDefined();

    // Hooks
    expect(mod.useFluxScore).toBeDefined();
    expect(mod.useFluxViolations).toBeDefined();
    expect(mod.useFluxRequests).toBeDefined();
    expect(mod.useFluxReport).toBeDefined();
    expect(mod.useFluxScanning).toBeDefined();

    // TanStack
    expect(mod.wrapQueryClient).toBeDefined();
    expect(mod.extractQueryMetrics).toBeDefined();

    // SWR
    expect(mod.createFluxSWRMiddleware).toBeDefined();
    expect(mod.fluxSWRMiddleware).toBeDefined();

    // Bridge
    expect(mod.ScannerBridge).toBeDefined();
    expect(mod.getGlobalBridge).toBeDefined();
    expect(mod.resetGlobalBridge).toBeDefined();
  });
});
