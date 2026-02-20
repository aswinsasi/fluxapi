// ═══════════════════════════════════════════════════════════════════
// TanStack Query Integration
// Wraps QueryClient to capture query metadata for FluxAPI analysis
// ═══════════════════════════════════════════════════════════════════

import { getGlobalBridge, type ScannerBridge } from '../scanner-bridge';

// ─── Types (compatible with @tanstack/react-query v5) ───────────

interface QueryClientConfig {
  defaultOptions?: {
    queries?: Record<string, unknown>;
    mutations?: Record<string, unknown>;
  };
  queryCache?: unknown;
  mutationCache?: unknown;
}

interface QueryCacheNotifyEvent {
  type: string;
  query?: {
    queryKey: unknown[];
    state: {
      status: string;
      fetchStatus: string;
      dataUpdatedAt: number;
      error: unknown;
    };
    options: {
      staleTime?: number;
      gcTime?: number;
      refetchInterval?: number | false;
      enabled?: boolean;
      retry?: number | boolean;
      queryKey: unknown[];
    };
  };
}

// ─── FluxQueryClient ────────────────────────────────────────────

/**
 * Wraps a TanStack QueryClient to instrument all queries for FluxAPI monitoring.
 *
 * Usage:
 * ```tsx
 * import { QueryClient } from '@tanstack/react-query';
 * import { wrapQueryClient } from '@fluxiapi/react';
 *
 * const queryClient = wrapQueryClient(new QueryClient({
 *   defaultOptions: { queries: { staleTime: 30_000 } },
 * }));
 * ```
 */
export function wrapQueryClient<T extends object>(
  queryClient: T,
  bridge?: ScannerBridge,
): T {
  const _bridge = bridge ?? getGlobalBridge();

  // Subscribe to query cache events
  try {
    const qc = queryClient as any;

    // TanStack v5: queryClient.getQueryCache().subscribe()
    if (typeof qc.getQueryCache === 'function') {
      const cache = qc.getQueryCache();

      if (typeof cache.subscribe === 'function') {
        cache.subscribe((event: QueryCacheNotifyEvent) => {
          if (!event.query) return;

          const { query } = event;
          const eventType = event.type;

          if (eventType === 'added' || eventType === 'updated') {
            _bridge.captureQueryEvent({
              type: eventType === 'added' ? 'query-added' : 'query-updated',
              queryKey: query.queryKey,
              state: {
                status: query.state.status,
                fetchStatus: query.state.fetchStatus,
                dataUpdatedAt: query.state.dataUpdatedAt,
              },
              options: {
                staleTime: query.options.staleTime as number | undefined,
                gcTime: query.options.gcTime as number | undefined,
                refetchInterval: query.options.refetchInterval as number | false | undefined,
                enabled: query.options.enabled as boolean | undefined,
                retry: query.options.retry as number | boolean | undefined,
              },
            });
          } else if (eventType === 'removed') {
            _bridge.captureQueryEvent({
              type: 'query-removed',
              queryKey: query.queryKey,
            });
          }
        });
      }
    }
  } catch (err) {
    console.warn('[FluxAPI] Failed to instrument QueryClient:', err);
  }

  return queryClient;
}

// ─── Query Metrics (extracted from bridge state) ────────────────

export interface QueryMetrics {
  /** Total unique query keys seen */
  uniqueQueries: number;
  /** Queries without staleTime configured */
  queriesWithoutStaleTime: number;
  /** Queries with refetchInterval (polling) */
  pollingQueries: number;
  /** Queries with retry disabled */
  noRetryQueries: number;
  /** Average staleTime across queries */
  avgStaleTime: number;
}

/**
 * Extracts TanStack Query-specific metrics from the current scan report.
 * Call this after getting a report to see query-level insights.
 */
export function extractQueryMetrics(queryClient: any): QueryMetrics {
  const metrics: QueryMetrics = {
    uniqueQueries: 0,
    queriesWithoutStaleTime: 0,
    pollingQueries: 0,
    noRetryQueries: 0,
    avgStaleTime: 0,
  };

  try {
    if (typeof queryClient.getQueryCache !== 'function') return metrics;

    const cache = queryClient.getQueryCache();
    const queries: any[] = cache.getAll?.() ?? [];

    metrics.uniqueQueries = queries.length;

    let totalStaleTime = 0;
    let staleTimeCount = 0;

    queries.forEach((q: any) => {
      const opts = q.options ?? {};

      if (!opts.staleTime || opts.staleTime === 0) {
        metrics.queriesWithoutStaleTime++;
      } else {
        totalStaleTime += opts.staleTime;
        staleTimeCount++;
      }

      if (opts.refetchInterval && opts.refetchInterval !== false) {
        metrics.pollingQueries++;
      }

      if (opts.retry === false || opts.retry === 0) {
        metrics.noRetryQueries++;
      }
    });

    metrics.avgStaleTime = staleTimeCount > 0 ? Math.round(totalStaleTime / staleTimeCount) : 0;
  } catch { /* ignore */ }

  return metrics;
}
