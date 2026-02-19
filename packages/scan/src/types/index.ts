// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Type Definitions
// The data model for all intercepted requests, responses, and metadata
// ═══════════════════════════════════════════════════════════════════

// ─── Request/Response Types ─────────────────────────────────────

export interface FluxRequestRecord {
  /** Unique ID for this request */
  id: string;
  /** Request URL (normalized, no hash) */
  url: string;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Parsed URL components for pattern matching */
  urlParts: ParsedUrl;
  /** Request headers (sanitized - auth tokens redacted) */
  headers: Record<string, string>;
  /** Request body size in bytes (0 for GET) */
  bodySize: number;
  /** Serialized body hash for dedup detection (not the actual body) */
  bodyHash: string | null;
  /** Timestamp when request was initiated (performance.now()) */
  startTime: number;
  /** Timestamp when first byte received */
  ttfb: number | null;
  /** Timestamp when response fully loaded */
  endTime: number | null;
  /** Total duration in ms */
  duration: number | null;
  /** Response metadata (null if request failed/pending) */
  response: FluxResponseRecord | null;
  /** Which component/function initiated this request */
  initiator: RequestInitiator;
  /** Navigation context at time of request */
  navigationContext: NavigationContext;
  /** Request type classification */
  type: RequestType;
  /** Whether this was intercepted from fetch() or XMLHttpRequest */
  source: 'fetch' | 'xhr';
  /** Any error that occurred */
  error: string | null;
  /** Sequence number (order of request firing) */
  sequence: number;
}

export interface FluxResponseRecord {
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body size in bytes */
  bodySize: number;
  /** Content-Type header value */
  contentType: string | null;
  /** Cache-related headers extracted */
  cacheHeaders: CacheHeaders;
  /** Hash of response body for change detection */
  bodyHash: string;
  /** Number of top-level fields in JSON response (null if not JSON) */
  jsonFieldCount: number | null;
  /** Whether response was served from browser cache */
  fromCache: boolean;
}

export interface CacheHeaders {
  /** Cache-Control header value */
  cacheControl: string | null;
  /** ETag header value */
  etag: string | null;
  /** Last-Modified header value */
  lastModified: string | null;
  /** Expires header value */
  expires: string | null;
  /** Age header value */
  age: string | null;
  /** Whether Accept-Encoding was used in request */
  acceptEncoding: boolean;
  /** Content-Encoding (gzip, br, etc.) */
  contentEncoding: string | null;
}

export interface ParsedUrl {
  /** Protocol (https:, http:) */
  protocol: string;
  /** Hostname */
  host: string;
  /** Path segments: /api/users/123 → ['api', 'users', '123'] */
  pathSegments: string[];
  /** URL path pattern: /api/users/:id (numeric/UUID segments replaced) */
  pathPattern: string;
  /** Query parameters */
  queryParams: Record<string, string>;
  /** Full path without query string */
  pathname: string;
}

// ─── Request Classification ─────────────────────────────────────

export type RequestType =
  | 'api-rest'       // Standard REST API call
  | 'api-graphql'    // GraphQL query/mutation
  | 'api-grpc'       // gRPC-Web call
  | 'static'         // Static asset (js, css, image, font)
  | 'document'       // HTML document
  | 'websocket'      // WebSocket connection
  | 'other';         // Unclassified

// ─── Initiator / Stack Trace ────────────────────────────────────

export interface RequestInitiator {
  /** Cleaned stack trace (top 5 frames, internal frames removed) */
  stackTrace: StackFrame[];
  /** Detected component name (React/Vue) if available */
  componentName: string | null;
  /** Component file path if available */
  componentFile: string | null;
  /** Raw stack string for debugging */
  rawStack: string;
}

export interface StackFrame {
  /** Function name (or '<anonymous>') */
  functionName: string;
  /** Source file path */
  fileName: string;
  /** Line number */
  lineNumber: number;
  /** Column number */
  columnNumber: number;
  /** Whether this is a framework internal frame */
  isInternal: boolean;
}

// ─── Navigation Context ─────────────────────────────────────────

export interface NavigationContext {
  /** Current URL/route when request was made */
  currentRoute: string;
  /** Previous route (null if first page) */
  previousRoute: string | null;
  /** Time since last navigation in ms */
  timeSinceNavigation: number;
  /** Page lifecycle state */
  pageState: 'loading' | 'interactive' | 'complete';
}

export interface NavigationEvent {
  /** Unique ID */
  id: string;
  /** Route navigated FROM */
  fromRoute: string;
  /** Route navigated TO */
  toRoute: string;
  /** Timestamp of navigation */
  timestamp: number;
  /** How navigation was triggered */
  trigger: 'popstate' | 'pushState' | 'replaceState' | 'hashchange' | 'initial';
  /** Time spent on previous route (ms) */
  dwellTime: number;
}

// ─── Stack Detection ────────────────────────────────────────────

export interface DetectedStack {
  /** Frontend framework */
  framework: FrameworkInfo | null;
  /** Data fetching library */
  dataLibrary: DataLibraryInfo | null;
  /** API type (REST, GraphQL, gRPC) */
  apiType: 'rest' | 'graphql' | 'grpc-web' | 'mixed';
  /** Backend hints from response headers */
  backendHints: BackendHints;
}

export interface FrameworkInfo {
  name: 'react' | 'vue' | 'svelte' | 'angular' | 'unknown';
  version: string | null;
  /** Meta-framework like Next.js, Nuxt, Remix, SvelteKit */
  metaFramework: string | null;
}

export interface DataLibraryInfo {
  name: 'tanstack-query' | 'swr' | 'apollo' | 'rtk-query' | 'urql' | 'none';
  version: string | null;
}

export interface BackendHints {
  /** X-Powered-By header */
  poweredBy: string | null;
  /** Server header */
  server: string | null;
  /** Detected framework from error responses */
  detectedFramework: string | null;
}

// ─── Scanner Configuration ──────────────────────────────────────

export interface FluxScanConfig {
  /** Scan duration in seconds (default: 60) */
  duration: number;
  /** Network profile for scoring adjustment */
  network: NetworkProfile;
  /** URL patterns to ignore */
  ignore: string[];
  /** Whether to capture response bodies for field analysis */
  captureFields: boolean;
  /** Maximum number of requests to record */
  maxRequests: number;
  /** Minimum request duration to track (ms) - filters noise */
  minDuration: number;
  /** Enable verbose logging */
  verbose: boolean;
}

export type NetworkProfile =
  | 'wifi'
  | 'fiber'
  | '4g'
  | 'jio-4g'
  | 'airtel-4g'
  | '3g'
  | 'airtel-3g'
  | '2g'
  | 'bsnl-2g'
  | 'slow-3g';

export const NETWORK_PROFILES: Record<NetworkProfile, NetworkCondition> = {
  'wifi':       { latencyMultiplier: 1.0, bandwidthMultiplier: 1.0, label: 'WiFi / Fiber' },
  'fiber':      { latencyMultiplier: 1.0, bandwidthMultiplier: 1.0, label: 'Fiber' },
  '4g':         { latencyMultiplier: 1.5, bandwidthMultiplier: 1.3, label: '4G LTE' },
  'jio-4g':     { latencyMultiplier: 1.8, bandwidthMultiplier: 1.5, label: 'Jio 4G' },
  'airtel-4g':  { latencyMultiplier: 1.6, bandwidthMultiplier: 1.4, label: 'Airtel 4G' },
  '3g':         { latencyMultiplier: 3.0, bandwidthMultiplier: 2.5, label: '3G' },
  'airtel-3g':  { latencyMultiplier: 3.2, bandwidthMultiplier: 2.8, label: 'Airtel 3G' },
  '2g':         { latencyMultiplier: 6.0, bandwidthMultiplier: 5.0, label: '2G' },
  'bsnl-2g':    { latencyMultiplier: 7.0, bandwidthMultiplier: 6.0, label: 'BSNL 2G' },
  'slow-3g':    { latencyMultiplier: 5.0, bandwidthMultiplier: 4.0, label: 'Slow 3G' },
};

export interface NetworkCondition {
  latencyMultiplier: number;
  bandwidthMultiplier: number;
  label: string;
}

// ─── Scan Session ───────────────────────────────────────────────

export interface FluxScanSession {
  /** Session unique ID */
  id: string;
  /** When scan started */
  startTime: number;
  /** When scan ended (null if still running) */
  endTime: number | null;
  /** All recorded requests */
  requests: FluxRequestRecord[];
  /** All navigation events */
  navigations: NavigationEvent[];
  /** WebSocket activity during scan */
  websockets: WebSocketSummary;
  /** Detected technology stack */
  stack: DetectedStack;
  /** Scanner configuration used */
  config: FluxScanConfig;
  /** Session metadata */
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  /** Page URL that was scanned */
  pageUrl: string;
  /** User agent */
  userAgent: string;
  /** Total scan duration in ms */
  scanDuration: number;
  /** Total requests recorded */
  totalRequests: number;
  /** Total API requests (excluding static assets) */
  apiRequests: number;
  /** Unique endpoints detected */
  uniqueEndpoints: number;
  /** Unique hosts detected */
  uniqueHosts: string[];
}

// ─── Observer Events ────────────────────────────────────────────

export type FluxEvent =
  | { type: 'request:start'; data: FluxRequestRecord }
  | { type: 'request:end'; data: FluxRequestRecord }
  | { type: 'request:error'; data: FluxRequestRecord }
  | { type: 'navigation'; data: NavigationEvent }
  | { type: 'websocket:open'; data: WebSocketEvent }
  | { type: 'websocket:message'; data: WebSocketEvent }
  | { type: 'websocket:close'; data: WebSocketEvent }
  | { type: 'scan:start'; data: { sessionId: string; config: FluxScanConfig } }
  | { type: 'scan:end'; data: FluxScanSession };

export type FluxEventHandler = (event: FluxEvent) => void;

// ─── WebSocket Monitoring ──────────────────────────────────────

export interface WebSocketEvent {
  /** Unique ID */
  id: string;
  /** WebSocket URL */
  url: string;
  /** Event type */
  eventType: 'open' | 'message' | 'close' | 'error';
  /** Timestamp */
  timestamp: number;
  /** Message size in bytes (for message events) */
  messageSize: number | null;
  /** Message direction */
  direction: 'sent' | 'received' | null;
  /** Subscription/channel name if detected */
  channel: string | null;
}

export interface WebSocketSummary {
  /** All tracked WebSocket connections */
  connections: WebSocketConnection[];
  /** Total messages sent/received */
  totalMessages: number;
  /** Messages per second */
  messagesPerSecond: number;
}

export interface WebSocketConnection {
  /** WebSocket URL */
  url: string;
  /** When connection opened */
  openedAt: number;
  /** When connection closed (null if still open) */
  closedAt: number | null;
  /** Total messages received */
  messagesReceived: number;
  /** Total messages sent */
  messagesSent: number;
  /** Average message size */
  avgMessageSize: number;
  /** Detected channels/subscriptions */
  channels: string[];
}

// ─── GraphQL Detection ─────────────────────────────────────────

export interface GraphQLOperation {
  /** Operation name (query UserProfile) */
  operationName: string | null;
  /** Operation type (query, mutation, subscription) */
  operationType: 'query' | 'mutation' | 'subscription' | 'unknown';
  /** Hash of variables for dedup detection */
  variablesHash: string;
  /** The request record */
  request: FluxRequestRecord;
}

// ─── Default Configuration ──────────────────────────────────────

export const DEFAULT_CONFIG: FluxScanConfig = {
  duration: 60,
  network: 'wifi',
  ignore: [
    '**/*.js', '**/*.css', '**/*.png', '**/*.jpg', '**/*.svg',
    '**/*.woff*', '**/*.ico', '**/favicon*',
    '**/analytics*', '**/tracking*', '**/pixel*',
    '**/hot-update*', '**/sockjs*', '**/__webpack*',
  ],
  captureFields: true,
  maxRequests: 5000,
  minDuration: 0,
  verbose: false,
};
