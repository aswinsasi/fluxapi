# @fluxiapi/scan

**Lighthouse for your API calls.** Scans your web app's network layer for performance anti-patterns and generates framework-aware fix code.

## Installation

```bash
npm install @fluxiapi/scan
```

or with yarn/pnpm:

```bash
yarn add @fluxiapi/scan
pnpm add @fluxiapi/scan
```

### Requirements

- **Node.js >= 18**
- **TypeScript >= 5.0** (if using TypeScript — types are included)

> This is the **core scan engine**. For CLI usage (scan any URL from terminal), install [@fluxiapi/cli](https://www.npmjs.com/package/@fluxiapi/cli) instead or run `npx flux-scan`. For drop-in DevTools, see [@fluxiapi/vue](https://www.npmjs.com/package/@fluxiapi/vue) or [@fluxiapi/react](https://www.npmjs.com/package/@fluxiapi/react).

---

## Quick Start

### Browser (in-app integration)

```typescript
import { FluxScanner, FluxAnalyzer, generateHtmlReport, printReport } from '@fluxiapi/scan';

// 1. Start scanning (monkey-patches fetch/XHR to capture requests)
const scanner = new FluxScanner({ duration: 60, network: 'jio-4g' });
scanner.start();

// 2. User browses your app...

// 3. Stop and get session data
const session = scanner.stop();

// 4. Analyze
const analyzer = new FluxAnalyzer({ network: 'jio-4g' });
const report = analyzer.analyze(session);

// 5. Output
console.log(printReport(report));              // Console summary
const html = generateHtmlReport(report);       // Self-contained HTML report
```

### Script tag (no build tools)

```html
<script src="https://unpkg.com/@fluxiapi/scan"></script>
<script>
  const scanner = new FluxScanner({ duration: 30 });
  scanner.start();
  setTimeout(() => {
    const session = scanner.stop();
    const report = new FluxAnalyzer().analyze(session);
    console.log(report.score); // { overall: 72, grade: 'good', ... }
  }, 30000);
</script>
```

---

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

---

## API Reference

### Core

```typescript
// Scanner — captures network requests
const scanner = new FluxScanner({ duration: 30, network: 'wifi' });
scanner.start();
const session = scanner.stop();

// Analyzer — runs 13 audit rules
const analyzer = new FluxAnalyzer({ network: 'jio-4g' });
const report = analyzer.analyze(session);

// Reporters
const html = generateHtmlReport(report);   // Self-contained HTML
const text = printReport(report);           // Console-friendly text
const json = JSON.stringify(report);        // Raw JSON
```

### GraphQL Dedup

```typescript
import { parseGraphQLBody, detectGraphQLDuplicates } from '@fluxiapi/scan';

// Parse a GraphQL request body
const op = parseGraphQLBody(requestBody);
// → { operationName: 'GetUsers', operationType: 'query', queryHash: '...', variablesHash: '...' }

// Detect duplicate queries across requests
const dupes = detectGraphQLDuplicates(requests, 3000);
// → [{ operationName: 'GetUsers', count: 4, identicalVariables: true }]
```

### Framework-Aware Fixes

```typescript
import { detectFixFramework, generateDedupFix, generateParallelFix, generateRetryFix } from '@fluxiapi/scan';

// Auto-detect best fix framework from scan stack
const framework = detectFixFramework(session.stack);
// → 'react-tanstack' | 'react-swr' | 'vue-composable' | 'apollo' | 'angular' | 'vanilla'

// Generate fix code that matches your stack
const fix = generateDedupFix(framework, '/api/users', 'useUsers', 'users', 30000);
console.log(fix.code);     // Ready-to-paste code
console.log(fix.deps);     // ['@tanstack/react-query']

const parallel = generateParallelFix(framework, ['/api/users', '/api/posts']);
const retry = generateRetryFix(framework, '/api/orders', 'useOrders', 'orders');
```

### WebSocket Monitoring

```typescript
import { startWebSocketMonitoring, stopWebSocketMonitoring, getWebSocketSummary } from '@fluxiapi/scan';

startWebSocketMonitoring();
// ... app runs ...
stopWebSocketMonitoring();

const summary = getWebSocketSummary();
// → { connections: [...], totalMessages: 142, messagesPerSecond: 2.3 }
```

---

## CLI

For quick scanning from the terminal:

```bash
# Zero install
npx flux-scan https://myapp.com -o report.html

# With network profile
npx flux-scan https://myapp.com --network jio-4g -o report.html

# Authenticated app (manual login)
npx flux-scan https://myapp.com --no-headless --interact
```

See [@fluxiapi/cli](https://www.npmjs.com/package/@fluxiapi/cli) for full CLI docs.

---

## Chrome Extension

Install the [FluxAPI Chrome Extension](https://github.com/aswinsasi/fluxapi/tree/main/packages/extension) for real-time scanning in DevTools — no setup required:

1. Download `packages/extension/` from the repo
2. Go to `chrome://extensions` → Enable Developer Mode
3. Click "Load unpacked" → select the extension folder
4. Open DevTools → FluxAPI tab → Start Scan

---

## Related Packages

| Package | Description |
|---------|-------------|
| [`@fluxiapi/cli`](https://www.npmjs.com/package/@fluxiapi/cli) | `npx flux-scan <url>` — scan any URL from terminal |
| [`@fluxiapi/vue`](https://www.npmjs.com/package/@fluxiapi/vue) | `<FluxDevTools />` for Vue 3 / Nuxt — live API monitoring during development |
| [`@fluxiapi/react`](https://www.npmjs.com/package/@fluxiapi/react) | `<FluxDevTools />` for React / Next.js — live API monitoring with TanStack Query & SWR |

---

## Docs

Full documentation: [github.com/aswinsasi/fluxapi](https://github.com/aswinsasi/fluxapi)

## License

MIT
