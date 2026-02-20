// ═══════════════════════════════════════════════════════════════════
// FluxProvider — React Context for FluxAPI scanner state
// Provides scanner bridge to all child components
// ═══════════════════════════════════════════════════════════════════

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  ScannerBridge,
  getGlobalBridge,
  type FluxState,
  type ScannerBridgeConfig,
} from './scanner-bridge';

// ─── Context ────────────────────────────────────────────────────

interface FluxContextValue {
  bridge: ScannerBridge;
  state: FluxState;
}

const FluxContext = createContext<FluxContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────

export interface FluxProviderProps {
  children: ReactNode;
  /** Network profile for scoring */
  network?: string;
  /** Re-analysis interval in ms (default: 3000) */
  analysisInterval?: number;
  /** Auto-start scanning on mount (default: true) */
  autoStart?: boolean;
  /** Console logging */
  verbose?: boolean;
  /** Custom scanner bridge instance */
  bridge?: ScannerBridge;
}

export function FluxProvider({
  children,
  network,
  analysisInterval,
  autoStart = true,
  verbose = false,
  bridge: customBridge,
}: FluxProviderProps) {
  const bridgeRef = useRef<ScannerBridge>(
    customBridge ?? getGlobalBridge({ network, analysisInterval, autoStart, verbose })
  );

  const bridge = bridgeRef.current;

  // Subscribe to state changes using useSyncExternalStore for concurrent mode safety
  const state = useSyncExternalStore(
    (callback) => bridge.subscribe(callback),
    () => bridge.state,
    () => bridge.state // server snapshot
  );

  // Auto-start on mount
  useEffect(() => {
    if (autoStart && !bridge.state.scanning) {
      bridge.start();
    }

    return () => {
      // Don't destroy on unmount — let the bridge persist for re-mounts
    };
  }, [autoStart, bridge]);

  return (
    <FluxContext.Provider value={{ bridge, state }}>
      {children}
    </FluxContext.Provider>
  );
}

// ─── Hook: useFlux ──────────────────────────────────────────────

export function useFlux(): FluxContextValue {
  const ctx = useContext(FluxContext);
  if (!ctx) {
    throw new Error(
      'useFlux must be used within a <FluxProvider>. ' +
      'Wrap your app with <FluxProvider> or use <FluxDevTools /> which includes it.'
    );
  }
  return ctx;
}

// ─── Hook: useFluxBridge (low-level) ────────────────────────────

export function useFluxBridge(): ScannerBridge {
  return useFlux().bridge;
}

// ─── Hook: useFluxState ─────────────────────────────────────────

export function useFluxState(): FluxState {
  return useFlux().state;
}
