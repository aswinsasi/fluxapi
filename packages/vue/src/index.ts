// ═══════════════════════════════════════════════════════════════════
// @fluxiapi/vue — Vue SDK for FluxAPI
//
// Drop-in API health monitoring for Vue 3 / Nuxt apps.
//
// Quick start:
//   <script setup>
//   import { FluxDevTools } from '@fluxiapi/vue';
//   </script>
//   <template>
//     <FluxDevTools />
//   </template>
//
// With Plugin:
//   import { FluxPlugin } from '@fluxiapi/vue';
//   app.use(FluxPlugin, { network: 'jio-4g' });
//
// With TanStack Vue Query:
//   import { wrapQueryClient } from '@fluxiapi/vue';
//   const queryClient = wrapQueryClient(new QueryClient());
// ═══════════════════════════════════════════════════════════════════

// ─── DevTools Component ─────────────────────────────────────────
export { FluxDevTools } from './devtools/FluxDevTools';

// ─── Vue Plugin ─────────────────────────────────────────────────
export { FluxPlugin, useFluxBridge, FLUX_BRIDGE_KEY } from './plugin';
export type { FluxPluginOptions } from './plugin';

// ─── Composables ────────────────────────────────────────────────
export {
  useFluxState,
  useFluxScore,
  useFluxViolations,
  useFluxRequests,
  useFluxReport,
  useFluxScanning,
  type ScoreInfo,
  type ViolationFilter,
  type RequestFilter,
} from './composables';

// ─── TanStack Vue Query Integration ─────────────────────────────
export { wrapQueryClient, extractQueryMetrics, type QueryMetrics } from './integrations/tanstack';

// ─── Scanner Bridge (advanced) ──────────────────────────────────
export {
  ScannerBridge,
  getGlobalBridge,
  resetGlobalBridge,
  type FluxState,
  type FluxStateListener,
  type ScannerBridgeConfig,
} from './scanner-bridge';
