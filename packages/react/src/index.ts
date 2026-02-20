// ═══════════════════════════════════════════════════════════════════
// @fluxiapi/react — React SDK for FluxAPI
//
// Drop-in API health monitoring for React apps.
//
// Quick start:
//   import { FluxDevTools } from '@fluxiapi/react';
//   <FluxDevTools />  // Add to your app root
//
// With TanStack Query:
//   import { wrapQueryClient } from '@fluxiapi/react';
//   const queryClient = wrapQueryClient(new QueryClient());
//
// With SWR:
//   import { fluxSWRMiddleware } from '@fluxiapi/react';
//   <SWRConfig value={{ use: [fluxSWRMiddleware] }}>
// ═══════════════════════════════════════════════════════════════════

// ─── DevTools Component ─────────────────────────────────────────
export { FluxDevTools, type FluxDevToolsProps } from './devtools';

// ─── React Context & Provider ───────────────────────────────────
export { FluxProvider, useFlux, useFluxBridge, useFluxState } from './context';
export type { FluxProviderProps } from './context';

// ─── Hooks ──────────────────────────────────────────────────────
export {
  useFluxScore,
  useFluxViolations,
  useFluxRequests,
  useFluxReport,
  useFluxScanning,
  type ScoreInfo,
  type ViolationFilter,
  type RequestFilter,
} from './hooks';

// ─── TanStack Query Integration ─────────────────────────────────
export { wrapQueryClient, extractQueryMetrics, type QueryMetrics } from './integrations/tanstack';

// ─── SWR Integration ────────────────────────────────────────────
export { createFluxSWRMiddleware, fluxSWRMiddleware, type SWRMetrics } from './integrations/swr';

// ─── Scanner Bridge (advanced) ──────────────────────────────────
export {
  ScannerBridge,
  getGlobalBridge,
  resetGlobalBridge,
  type FluxState,
  type FluxStateListener,
  type ScannerBridgeConfig,
} from './scanner-bridge';
