# @fluxiapi/scan

**Lighthouse for your API calls.** Scans your web app's network layer for performance anti-patterns and generates framework-aware fix code.

```bash
npm install @fluxiapi/scan
```

## What it Detects

### ⚡ Efficiency

| Rule | Issue | Auto-fix |
|------|-------|----------|
| E1 | Request Waterfalls (sequential calls that could be parallel) | ✅ `useSuspenseQueries` / `Promise.all` |
| E2 | Duplicate Requests (same endpoint from multiple components) | ✅ Shared `useQuery` hook |
| E3 | N+1 Pattern (GET /items/1, /items/2 ×25) | ✅ Batch endpoint |
| E4 | Payload Over-fetching (>60% unused response fields) | ✅ Sparse fieldsets / GraphQL |
| E5 | Batchable Requests (multiple calls to same host) | ✅ Batch API / DataLoader |

### 💾 Caching

| Rule | Issue | Auto-fix |
|------|-------|----------|
| C1 | No Cache Strategy (missing Cache-Control, ETag, staleTime) | ✅ `staleTime` + headers |
| C2 | Under-Caching (95% identical responses) | ✅ Optimized TTL |
| C3 | Over-Caching (TTL outlives data freshness) | ✅ Reduced TTL + `stale-while-revalidate` |
| C4 | Missing Revalidation (has ETag, no conditional requests) | ✅ `If-None-Match` headers |

### 🔄 Patterns

| Rule | Issue | Auto-fix |
|------|-------|----------|
| P1 | Missing Prefetch (predictable navigation, no prefetch) | ✅ `prefetchQuery` |
| P2 | Unnecessary Polling (polling faster than data changes) | ✅ Increased interval / SSE |
| P3 | Missing Error Recovery (500s with no retry) | ✅ Exponential backoff |
| P4 | Uncompressed Responses (no gzip/brotli) | ✅ Server compression config |

### 🧠 Intelligence

| Feature | Description |
|---------|-------------|
| Framework Detection | Auto-detects React, Next.js, Vue, Nuxt, Remix, SvelteKit, Angular |
| GraphQL Dedup | Parses operations, detects duplicate queries by hash + variables |
| WebSocket Monitor | Tracks connections, message rates, channels, subscriptions |
| Framework-Aware Fixes | Generates code for TanStack Query, SWR, Apollo, Vue composables, Angular |

## Quick Start

```typescript
import { FluxScanner, FluxAnalyzer, generateHtmlReport, printReport } from '@fluxiapi/scan';

// Scan
const scanner = new FluxScanner({ duration: 60, network: 'jio-4g' });
scanner.start();
// ... user browses ...
const session = scanner.stop();

// Analyze
const analyzer = new FluxAnalyzer({ network: 'jio-4g' });
const report = analyzer.analyze(session);

// Output
console.log(printReport(report));              // Console
const html = generateHtmlReport(report);       // Self-contained HTML
```

## GraphQL Dedup

```typescript
import { parseGraphQLBody, detectGraphQLDuplicates } from '@fluxiapi/scan';

// Parse a GraphQL request body
const op = parseGraphQLBody(requestBody);
// → { operationName: 'GetUsers', operationType: 'query', queryHash: '...', variablesHash: '...' }

// Detect duplicate queries across requests
const dupes = detectGraphQLDuplicates(requests, 3000);
// → [{ operationName: 'GetUsers', count: 4, identicalVariables: true }]
```

## Framework-Aware Fixes

```typescript
import { detectFixFramework, generateDedupFix, generateParallelFix, generateRetryFix } from '@fluxiapi/scan';

// Auto-detect best fix framework from stack
const framework = detectFixFramework(session.stack);
// → 'react-tanstack' | 'react-swr' | 'vue-composable' | 'apollo' | 'angular' | 'vanilla'

// Generate fix code that matches your stack
const fix = generateDedupFix(framework, '/api/users', 'useUsers', 'users', 30000);
console.log(fix.code);     // Ready-to-paste code
console.log(fix.deps);     // ['@tanstack/react-query']
```

## WebSocket Monitoring

```typescript
import { startWebSocketMonitoring, stopWebSocketMonitoring, getWebSocketSummary } from '@fluxiapi/scan';

startWebSocketMonitoring();
// ... app runs ...
stopWebSocketMonitoring();

const summary = getWebSocketSummary();
// → { connections: [...], totalMessages: 142, messagesPerSecond: 2.3 }
```

## CLI

```bash
npx flux-scan https://myapp.com -o report.html
npx flux-scan https://myapp.com --network jio-4g
npx flux-scan https://myapp.com --no-headless --interact
```

## Docs

Full documentation: [github.com/aswinsasi/fluxapi](https://github.com/aswinsasi/fluxapi)

## License

MIT
