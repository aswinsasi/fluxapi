// ═══════════════════════════════════════════════════════════════════
// Vue Plugin — provides FluxAPI scanner to entire app
// ═══════════════════════════════════════════════════════════════════

import { inject, type InjectionKey, type Plugin } from 'vue';
import { ScannerBridge, getGlobalBridge, type ScannerBridgeConfig } from './scanner-bridge';

// ─── Injection Key ──────────────────────────────────────────────

export const FLUX_BRIDGE_KEY: InjectionKey<ScannerBridge> = Symbol('flux-bridge');

// ─── Plugin ─────────────────────────────────────────────────────

export interface FluxPluginOptions extends ScannerBridgeConfig {
  /** Custom bridge instance */
  bridge?: ScannerBridge;
}

/**
 * Vue plugin to install FluxAPI scanner globally.
 *
 * Usage:
 * ```ts
 * import { createApp } from 'vue';
 * import { FluxPlugin } from '@fluxiapi/vue';
 *
 * const app = createApp(App);
 * app.use(FluxPlugin, { network: 'jio-4g', autoStart: true });
 * ```
 */
export const FluxPlugin: Plugin<FluxPluginOptions> = {
  install(app, options: FluxPluginOptions = {}) {
    const bridge = options.bridge ?? getGlobalBridge(options);
    app.provide(FLUX_BRIDGE_KEY, bridge);

    // Auto-start if configured
    if (options.autoStart !== false) {
      bridge.start();
    }

    // Register global component
    // Users can also import FluxDevTools directly
    app.config.globalProperties.$flux = bridge;
  },
};

// ─── Inject Helper ──────────────────────────────────────────────

export function useFluxBridge(): ScannerBridge {
  const bridge = inject(FLUX_BRIDGE_KEY);
  if (!bridge) {
    // Fallback to global bridge if plugin not installed
    return getGlobalBridge();
  }
  return bridge;
}
