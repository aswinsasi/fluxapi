// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - FluxScanner
// Main orchestrator class that ties together all Week 1 components:
// Observer, Logger, Navigation Tracker, Stack Detection
// ═══════════════════════════════════════════════════════════════════

import type {
  FluxScanConfig,
  FluxScanSession,
  FluxEvent,
  FluxEventHandler,
  DetectedStack,
} from './types';
import { DEFAULT_CONFIG } from './types';
import { generateId, resetSequence } from './utils';
import { startObserving, stopObserving, onEvent as observerOnEvent } from './observer/interceptor';
import { handleEvent, initLogger, resetLogger, getAllRequests, getApiRequests, getSessionMetadata, getStats } from './logger/request-logger';
import { startNavigationTracking, stopNavigationTracking, getNavigations, resetNavigation } from './navigation/tracker';
import { detectFramework, detectDataLibrary } from './stack-trace/capture';

// ─── Scanner States ─────────────────────────────────────────────

export type ScannerState = 'idle' | 'scanning' | 'complete';

// ─── FluxScanner Class ──────────────────────────────────────────

export class FluxScanner {
  private _state: ScannerState = 'idle';
  private _config: FluxScanConfig;
  private _sessionId: string = '';
  private _startTime: number = 0;
  private _endTime: number | null = null;
  private _cleanupObserver: (() => void) | null = null;
  private _cleanupEventListener: (() => void) | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _eventHandlers: FluxEventHandler[] = [];
  private _detectedStack: DetectedStack | null = null;

  constructor(config?: Partial<FluxScanConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Start scanning. Begins intercepting requests and tracking navigation.
   * If duration is set, auto-stops after the configured time.
   */
  start(): void {
    if (this._state === 'scanning') {
      console.warn('[FluxAPI] Scanner already running. Call stop() first.');
      return;
    }

    // Reset everything
    this._sessionId = generateId();
    this._startTime = performance.now();
    this._endTime = null;
    this._state = 'scanning';

    resetSequence();
    resetLogger();
    resetNavigation();

    // Initialize logger
    initLogger(this._config);

    // Connect observer events to logger
    this._cleanupEventListener = observerOnEvent((event: FluxEvent) => {
      handleEvent(event);
      // Forward to external handlers
      this._eventHandlers.forEach(h => {
        try { h(event); } catch { /* ignore */ }
      });
    });

    // Start observation
    this._cleanupObserver = startObserving(this._config);

    // Start navigation tracking
    startNavigationTracking();

    // Detect stack (do this after a short delay to let the page settle)
    setTimeout(() => {
      this._detectedStack = this._detectStack();
    }, 1000);

    // Emit scan start event
    this._emitToHandlers({
      type: 'scan:start',
      data: { sessionId: this._sessionId, config: this._config },
    });

    // Auto-stop timer
    if (this._config.duration > 0) {
      this._timer = setTimeout(() => {
        this.stop();
      }, this._config.duration * 1000);
    }

    if (this._config.verbose) {
      console.log(`[FluxAPI] Scan started (session: ${this._sessionId})`);
      console.log(`[FluxAPI] Duration: ${this._config.duration}s | Network: ${this._config.network}`);
    }
  }

  /**
   * Stop scanning and generate the session data.
   */
  stop(): FluxScanSession {
    if (this._state !== 'scanning') {
      console.warn('[FluxAPI] Scanner not running.');
      return this._buildSession();
    }

    // Clear auto-stop timer
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    // Stop components
    stopObserving();
    stopNavigationTracking();

    // Cleanup listeners
    if (this._cleanupEventListener) {
      this._cleanupEventListener();
      this._cleanupEventListener = null;
    }

    this._endTime = performance.now();
    this._state = 'complete';

    // Detect stack if not already done
    if (!this._detectedStack) {
      this._detectedStack = this._detectStack();
    }

    const session = this._buildSession();

    // Emit scan end event
    this._emitToHandlers({ type: 'scan:end', data: session });

    if (this._config.verbose) {
      const stats = getStats();
      console.log(`[FluxAPI] Scan complete!`);
      console.log(`[FluxAPI] Total requests: ${stats.totalRequests} | API requests: ${stats.apiRequests}`);
      console.log(`[FluxAPI] Unique endpoints: ${stats.uniqueEndpoints} | Avg duration: ${Math.round(stats.avgDuration)}ms`);
    }

    return session;
  }

  /**
   * Subscribe to scanner events.
   */
  onEvent(handler: FluxEventHandler): () => void {
    this._eventHandlers.push(handler);
    return () => {
      const idx = this._eventHandlers.indexOf(handler);
      if (idx !== -1) this._eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Get current scanner state.
   */
  get state(): ScannerState {
    return this._state;
  }

  /**
   * Get live statistics (while scanning).
   */
  get liveStats() {
    return getStats();
  }

  /**
   * Get current configuration.
   */
  get config(): FluxScanConfig {
    return { ...this._config };
  }

  /**
   * Update configuration. Only works when idle.
   */
  configure(config: Partial<FluxScanConfig>): void {
    if (this._state === 'scanning') {
      console.warn('[FluxAPI] Cannot change config while scanning.');
      return;
    }
    this._config = { ...this._config, ...config };
  }

  // ─── Internal Methods ───────────────────────────────────────

  private _detectStack(): DetectedStack {
    const framework = detectFramework();
    const dataLibrary = detectDataLibrary();

    // Detect API type from recorded requests
    const apiRequests = getApiRequests();
    const hasGraphQL = apiRequests.some(r => r.type === 'api-graphql');
    const hasRest = apiRequests.some(r => r.type === 'api-rest');
    const hasGrpc = apiRequests.some(r => r.type === 'api-grpc');

    let apiType: DetectedStack['apiType'] = 'rest';
    if (hasGraphQL && hasRest) apiType = 'mixed';
    else if (hasGraphQL) apiType = 'graphql';
    else if (hasGrpc) apiType = 'grpc-web';

    // Detect backend from response headers
    const backendHints: DetectedStack['backendHints'] = {
      poweredBy: null,
      server: null,
      detectedFramework: null,
    };

    for (const req of apiRequests) {
      if (req.response?.headers) {
        const h = req.response.headers;
        if (h['x-powered-by']) backendHints.poweredBy = h['x-powered-by'];
        if (h['server']) backendHints.server = h['server'];

        // Detect framework from headers
        if (h['x-powered-by']?.includes('Express')) backendHints.detectedFramework = 'express';
        else if (h['x-powered-by']?.includes('Next.js')) backendHints.detectedFramework = 'nextjs';
        else if (h['server']?.includes('nginx')) backendHints.detectedFramework = 'nginx';
        else if (h['x-powered-by']?.includes('PHP')) backendHints.detectedFramework = 'php/laravel';
      }
    }

    return {
      framework: framework
        ? { name: framework.name as any, version: framework.version }
        : null,
      dataLibrary: dataLibrary
        ? { name: dataLibrary.name as any, version: dataLibrary.version }
        : null,
      apiType,
      backendHints,
    };
  }

  private _buildSession(): FluxScanSession {
    const scanDuration = this._endTime
      ? this._endTime - this._startTime
      : performance.now() - this._startTime;

    return {
      id: this._sessionId,
      startTime: this._startTime,
      endTime: this._endTime,
      requests: getAllRequests(),
      navigations: getNavigations(),
      stack: this._detectedStack || this._detectStack(),
      config: { ...this._config },
      metadata: getSessionMetadata(
        typeof window !== 'undefined' ? window.location.href : 'unknown',
        scanDuration,
      ),
    };
  }

  private _emitToHandlers(event: FluxEvent): void {
    this._eventHandlers.forEach(h => {
      try { h(event); } catch { /* ignore */ }
    });
  }
}
