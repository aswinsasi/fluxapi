// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Public API
// "Lighthouse for your API calls"
// ═══════════════════════════════════════════════════════════════════

// ─── Core ───────────────────────────────────────────────────────
export { FluxScanner } from './scanner';
export type { ScannerState } from './scanner';

// ─── Analyzer (Week 2) ─────────────────────────────────────────
export { FluxAnalyzer } from './analyzer';
export { calculateScore, calculateTotalImpact, generateSummary } from './analyzer/scorer';
export { createE1Rule } from './analyzer/rules/e1-waterfall';
export { createE2Rule } from './analyzer/rules/e2-duplicates';
export { createE3Rule } from './analyzer/rules/e3-nplus1';
export { createC1Rule } from './analyzer/rules/c1-no-cache';
export { createC2Rule } from './analyzer/rules/c2-under-caching';

export type {
  RuleId,
  RuleCategory,
  RuleSeverity,
  RuleDefinition,
  RuleViolation,
  ViolationImpact,
  AuditResult,
  AuditRule,
  CategoryScore,
  FluxScore,
  FluxReport,
  ReportSummary,
  AnalyzerConfig,
} from './analyzer/types';
export { RULE_DEFINITIONS, DEFAULT_ANALYZER_CONFIG } from './analyzer/types';

// ─── Types ──────────────────────────────────────────────────────
export type {
  FluxRequestRecord,
  FluxResponseRecord,
  CacheHeaders,
  ParsedUrl,
  RequestType,
  RequestInitiator,
  StackFrame,
  NavigationContext,
  NavigationEvent,
  DetectedStack,
  FrameworkInfo,
  DataLibraryInfo,
  BackendHints,
  FluxScanConfig,
  NetworkProfile,
  NetworkCondition,
  FluxScanSession,
  SessionMetadata,
  FluxEvent,
  FluxEventHandler,
  WebSocketEvent,
  WebSocketSummary,
  WebSocketConnection,
  GraphQLOperation,
} from './types';

export { DEFAULT_CONFIG, NETWORK_PROFILES } from './types';

// ─── Observer ───────────────────────────────────────────────────
export {
  startObserving,
  stopObserving,
  isObserving,
  onEvent,
} from './observer/interceptor';

// ─── Logger ─────────────────────────────────────────────────────
export {
  getAllRequests,
  getApiRequests,
  getCompletedRequests,
  getByUrlPattern,
  getDuplicateGroups,
  getByComponent,
  getByHost,
  getByRoute,
  getUniquePatterns,
  getUniqueHosts,
  getDetectedComponents,
  getRequestsInWindow,
  getTimeline,
  getSessionMetadata,
  getStats,
} from './logger/request-logger';

// ─── Navigation ─────────────────────────────────────────────────
export {
  getNavigations,
  getNavigationContext,
  buildTransitionMatrix,
  getTransitionProbabilities,
} from './navigation/tracker';
export type { TransitionMatrix } from './navigation/tracker';

// ─── Stack Detection ────────────────────────────────────────────
export {
  captureInitiator,
  detectFramework,
  detectDataLibrary,
} from './stack-trace/capture';

// ─── WebSocket Monitoring (Stage 3) ────────────────────────────
export {
  startWebSocketMonitoring,
  stopWebSocketMonitoring,
  getWebSocketSummary,
  resetWebSocketMonitor,
} from './observer/websocket-monitor';

// ─── GraphQL Dedup (Stage 3) ───────────────────────────────────
export {
  parseGraphQLBody,
  detectGraphQLDuplicates,
} from './analyzer/graphql-dedup';
export type { GraphQLDuplicate } from './analyzer/graphql-dedup';

// ─── Framework-Aware Fixes (Stage 3) ──────────────────────────
export {
  detectFixFramework,
  generateDedupFix,
  generateParallelFix,
  generateRetryFix,
} from './fixer/framework-fixes';
export type { FixFramework } from './fixer/framework-fixes';

// ─── Reporter (Week 3) ──────────────────────────────────────────
export { generateHtmlReport, type ReportOptions } from './reporter/html-report';
export { exportReportJson, printReport } from './reporter';
export { generateFix, generateFixes, type CodeFix } from './fixer';

// ─── Utilities ──────────────────────────────────────────────────
export {
  parseUrl,
  classifyRequest,
  fastHash,
  requestSignature,
  matchesPattern,
  shouldIgnore,
  sanitizeHeaders,
  formatDuration,
  formatBytes,
} from './utils';
