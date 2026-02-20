// ═══════════════════════════════════════════════════════════════════
// TanStack Vue Query Integration
// Wraps QueryClient to capture query metadata for FluxAPI
// ═══════════════════════════════════════════════════════════════════

import { getGlobalBridge, type ScannerBridge } from '../scanner-bridge';

/**
 * Wraps a TanStack QueryClient to instrument queries for FluxAPI.
 *
 * Usage:
 * ```ts
 * import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
 * import { wrapQueryClient } from '@fluxiapi/vue';
 *
 * const queryClient = wrapQueryClient(new QueryClient({
 *   defaultOptions: { queries: { staleTime: 30_000 } },
 * }));
 *
 * app.use(VueQueryPlugin, { queryClient });
 * ```
 */
export function wrapQueryClient<T extends object>(
  queryClient: T,
  bridge?: ScannerBridge,
): T {
  const _bridge = bridge ?? getGlobalBridge();

  try {
    const qc = queryClient as any;

    if (typeof qc.getQueryCache === 'function') {
      const cache = qc.getQueryCache();

      if (typeof cache.subscribe === 'function') {
        cache.subscribe((event: any) => {
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
                staleTime: query.options.staleTime,
                gcTime: query.options.gcTime,
                refetchInterval: query.options.refetchInterval,
                enabled: query.options.enabled,
                retry: query.options.retry,
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

// ─── Query Metrics ──────────────────────────────────────────────

export interface QueryMetrics {
  uniqueQueries: number;
  queriesWithoutStaleTime: number;
  pollingQueries: number;
  noRetryQueries: number;
  avgStaleTime: number;
}

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

    const queries: any[] = queryClient.getQueryCache().getAll?.() ?? [];
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
