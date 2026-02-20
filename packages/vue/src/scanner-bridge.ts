// ═══════════════════════════════════════════════════════════════════
// Scanner Bridge — connects @fluxiapi/scan engine to Vue state
// Framework-agnostic core, Vue reactivity wrapped in composables
// ═══════════════════════════════════════════════════════════════════

import type {
  FluxRequestRecord,
  FluxScanSession,
  FluxReport,
  RuleViolation,
  NetworkProfile,
} from '@fluxiapi/scan';

// ─── Types ──────────────────────────────────────────────────────

export interface FluxState {
  scanning: boolean;
  requests: FluxRequestRecord[];
  report: FluxReport | null;
  score: number;
  violations: RuleViolation[];
  startTime: number;
  elapsed: number;
  network: string;
  framework: string | null;
}

export type FluxStateListener = (state: FluxState) => void;

export interface ScannerBridgeConfig {
  network?: string;
  analysisInterval?: number;
  autoStart?: boolean;
  verbose?: boolean;
}

// ─── Scanner Bridge ─────────────────────────────────────────────

export class ScannerBridge {
  private _state: FluxState;
  private _listeners = new Set<FluxStateListener>();
  private _analyzeTimer: ReturnType<typeof setInterval> | null = null;
  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _config: Required<ScannerBridgeConfig>;
  private _scanner: any = null;
  private _analyzer: any = null;
  private _detectedStack: any = null;

  constructor(config: ScannerBridgeConfig = {}) {
    this._config = {
      network: config.network ?? 'wifi',
      analysisInterval: config.analysisInterval ?? 3000,
      autoStart: config.autoStart ?? true,
      verbose: config.verbose ?? false,
    };

    this._state = {
      scanning: false,
      requests: [],
      report: null,
      score: 100,
      violations: [],
      startTime: 0,
      elapsed: 0,
      network: this._config.network,
      framework: null,
    };
  }

  get state(): FluxState {
    return this._state;
  }

  subscribe(listener: FluxStateListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _emit() {
    const snapshot = { ...this._state };
    this._listeners.forEach((fn) => fn(snapshot));
  }

  private _update(partial: Partial<FluxState>) {
    this._state = { ...this._state, ...partial };
    this._emit();
  }

  // ─── Scan Lifecycle ─────────────────────────────────────────

  async start() {
    if (this._state.scanning) return;

    try {
      const scanModule = await import('@fluxiapi/scan');

      this._scanner = new scanModule.FluxScanner({
        duration: 0,
        network: this._config.network as NetworkProfile,
        verbose: this._config.verbose,
      });

      this._analyzer = new scanModule.FluxAnalyzer({
        network: this._config.network as NetworkProfile,
      });

      this._scanner.start();

      this._update({
        scanning: true,
        startTime: Date.now(),
        elapsed: 0,
        requests: [],
        report: null,
        violations: [],
        score: 100,
      });

      // Tick timer — update elapsed + request count every 500ms
      this._tickTimer = setInterval(async () => {
        try {
          const scanModule = await import('@fluxiapi/scan');
          const requests = scanModule.getAllRequests?.() ?? [];
          this._update({
            elapsed: Math.round((Date.now() - this._state.startTime) / 1000),
            requests,
          });
        } catch { /* ignore */ }
      }, 500);

      this._analyzeTimer = setInterval(() => {
        this._runAnalysis();
      }, this._config.analysisInterval);

      if (this._config.verbose) {
        console.log('[FluxAPI] Scanner started');
      }
    } catch (err) {
      console.error('[FluxAPI] Failed to start scanner:', err);
    }
  }

  stop(): FluxReport | null {
    if (!this._state.scanning || !this._scanner) return null;

    if (this._tickTimer) clearInterval(this._tickTimer);
    if (this._analyzeTimer) clearInterval(this._analyzeTimer);
    this._tickTimer = null;
    this._analyzeTimer = null;

    const session: FluxScanSession = this._scanner.stop();
    const report = this._analyzer?.analyze(session) ?? null;

    this._update({
      scanning: false,
      report,
      score: report?.score?.overall ?? 100,
      violations: report?.violations ?? [],
      framework: session?.stack?.framework?.name ?? null,
    });

    if (this._config.verbose) {
      console.log('[FluxAPI] Scanner stopped. Score:', report?.score?.overall);
    }

    return report;
  }

  reset() {
    this.stop();
    this._update({
      scanning: false,
      requests: [],
      report: null,
      score: 100,
      violations: [],
      startTime: 0,
      elapsed: 0,
      framework: null,
    });
  }

  setNetwork(network: string) {
    this._config.network = network;
    this._update({ network });
  }

  private async _runAnalysis() {
    if (!this._scanner || !this._analyzer) return;

    try {
      // Get current requests WITHOUT stopping the scanner
      const scanModule = await import('@fluxiapi/scan');
      const requests = scanModule.getAllRequests?.() ?? [];

      if (requests.length === 0) return; // Nothing to analyze yet

      // Build a lightweight session for the analyzer
      const session: FluxScanSession = {
        id: `live_${Date.now()}`,
        startTime: this._state.startTime,
        endTime: performance.now(),
        requests,
        navigations: [],
        websockets: { connections: [], totalMessages: 0, messagesPerSecond: 0 },
        stack: this._detectedStack ?? null,
        config: { duration: 0, network: this._config.network } as any,
        metadata: {
          url: typeof window !== 'undefined' ? window.location.href : 'unknown',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          scanDuration: Date.now() - this._state.startTime,
          timestamp: new Date().toISOString(),
        } as any,
      };

      // Detect framework once
      if (!this._detectedStack && typeof scanModule.detectFramework === 'function') {
        try {
          this._detectedStack = scanModule.detectFramework?.() ?? null;
          if (this._detectedStack) {
            (session as any).stack = this._detectedStack;
          }
        } catch { /* ignore */ }
      }

      const report = this._analyzer.analyze(session);

      this._update({
        report,
        score: report?.score?.overall ?? 100,
        violations: report?.violations ?? [],
        framework: (session.stack as any)?.framework?.name ?? null,
      });
    } catch (err) {
      if (this._config.verbose) {
        console.error('[FluxAPI] Analysis error:', err);
      }
    }
  }

  captureQueryEvent(event: {
    type: string;
    queryKey: unknown[];
    state?: any;
    options?: any;
  }) {
    if (this._config.verbose) {
      console.log('[FluxAPI] Query event:', event.type, event.queryKey);
    }
  }

  destroy() {
    this.stop();
    this._listeners.clear();
    this._scanner = null;
    this._analyzer = null;
  }
}

// ─── Singleton ──────────────────────────────────────────────────

let _globalBridge: ScannerBridge | null = null;

export function getGlobalBridge(config?: ScannerBridgeConfig): ScannerBridge {
  if (!_globalBridge) {
    _globalBridge = new ScannerBridge(config);
  }
  return _globalBridge;
}

export function resetGlobalBridge() {
  _globalBridge?.destroy();
  _globalBridge = null;
}
