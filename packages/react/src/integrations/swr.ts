// ═══════════════════════════════════════════════════════════════════
// SWR Integration
// SWR middleware that captures hook config for FluxAPI analysis
// ═══════════════════════════════════════════════════════════════════

import { getGlobalBridge, type ScannerBridge } from '../scanner-bridge';

// ─── Types (compatible with swr v2) ─────────────────────────────

type SWRKey = string | unknown[] | null | undefined | (() => string | unknown[] | null);

interface SWRConfig {
  refreshInterval?: number;
  dedupingInterval?: number;
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
  errorRetryCount?: number;
  [key: string]: unknown;
}

type SWRHook = (useSWRNext: any) => (key: SWRKey, fetcher: any, config: SWRConfig) => any;

// ─── Flux SWR Middleware ────────────────────────────────────────

/**
 * SWR middleware that instruments all SWR hooks for FluxAPI monitoring.
 *
 * Usage:
 * ```tsx
 * import { SWRConfig } from 'swr';
 * import { fluxSWRMiddleware } from '@fluxiapi/react';
 *
 * function App() {
 *   return (
 *     <SWRConfig value={{ use: [fluxSWRMiddleware] }}>
 *       <MyApp />
 *     </SWRConfig>
 *   );
 * }
 * ```
 */
export function createFluxSWRMiddleware(bridge?: ScannerBridge): SWRHook {
  const _bridge = bridge ?? getGlobalBridge();

  return (useSWRNext: any) => {
    return (key: SWRKey, fetcher: any, config: SWRConfig) => {
      // Resolve key
      const resolvedKey = typeof key === 'function' ? (() => {
        try { return (key as Function)(); } catch { return null; }
      })() : key;

      const keyStr = resolvedKey
        ? (typeof resolvedKey === 'string' ? resolvedKey : JSON.stringify(resolvedKey))
        : 'null';

      // Capture SWR config metadata
      _bridge.captureSWREvent({
        type: 'swr-request',
        key: keyStr,
        config: {
          refreshInterval: config.refreshInterval,
          dedupingInterval: config.dedupingInterval,
          revalidateOnFocus: config.revalidateOnFocus,
          errorRetryCount: config.errorRetryCount,
        },
      });

      // Wrap fetcher to capture timing
      const instrumentedFetcher = fetcher
        ? async (...args: any[]) => {
            const start = Date.now();
            try {
              const result = await fetcher(...args);
              _bridge.captureSWREvent({
                type: 'swr-success',
                key: keyStr,
              });
              return result;
            } catch (err) {
              _bridge.captureSWREvent({
                type: 'swr-error',
                key: keyStr,
              });
              throw err;
            }
          }
        : fetcher;

      // Call the real useSWR
      return useSWRNext(key, instrumentedFetcher, config);
    };
  };
}

// Default middleware instance using global bridge
export const fluxSWRMiddleware = createFluxSWRMiddleware();

// ─── SWR Metrics ────────────────────────────────────────────────

export interface SWRMetrics {
  /** Number of unique SWR keys */
  totalKeys: number;
  /** Keys with refreshInterval (polling) */
  pollingKeys: number;
  /** Keys with revalidateOnFocus enabled */
  revalidateOnFocusKeys: number;
  /** Keys with errorRetryCount = 0 */
  noRetryKeys: number;
  /** Average deduping interval */
  avgDedupingInterval: number;
}
