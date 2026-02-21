# ⚡ FluxAPI — Lighthouse for Your API Calls

**Scans your web app's network layer. 13 audit rules detect waterfalls, duplicate fetches, N+1 patterns, caching gaps, polling waste, and missing compression. Drop-in DevTools for Vue & React. Generates framework-aware fix code you can copy-paste.**

[![npm version](https://img.shields.io/npm/v/@fluxiapi/scan)](https://www.npmjs.com/package/@fluxiapi/scan)
[![npm version](https://img.shields.io/npm/v/@fluxiapi/cli)](https://www.npmjs.com/package/@fluxiapi/cli)
[![npm version](https://img.shields.io/npm/v/@fluxiapi/vue)](https://www.npmjs.com/package/@fluxiapi/vue)
[![npm version](https://img.shields.io/npm/v/@fluxiapi/react)](https://www.npmjs.com/package/@fluxiapi/react)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![FluxAPI Score](https://img.shields.io/badge/FluxAPI_Score-82%2F100-blue)

```bash
npx flux-scan https://your-app.com -o report.html
```

---

## What it Detects

### ⚡ Efficiency Rules

| Rule | What it Catches | Auto-Fix | Severity |
|------|----------------|----------|----------|
| **E1** | Request Waterfalls — sequential calls that could run in parallel | `Promise.all` / `useSuspenseQueries` | 🔴 Critical |
| **E2** | Duplicate Requests — same endpoint called by multiple components | Shared `useQuery` hook | 🔴 Critical |
| **E3** | N+1 Query Pattern — GET /products/1, /products/2 ×25 | Batch endpoint | 🔴 Critical |
| **E4** | Payload Over-fetching — API returns 50 fields, app uses 6 | Sparse fieldsets / GraphQL | 🟡 Warning |
| **E5** | Batchable Requests — 5 calls to same host in tight window | Batch API / DataLoader | 🟡 Warning |

### 💾 Caching Rules

| Rule | What it Catches | Auto-Fix | Severity |
|------|----------------|----------|----------|
| **C1** | No Cache Strategy — zero Cache-Control, ETag, or staleTime | `staleTime` + headers | 🔴 Critical |
| **C2** | Under-Caching — 95% of fetches return identical data | Optimized TTL | 🟡 Warning |
| **C3** | Over-Caching — cache TTL outlives data freshness | Reduced TTL + `stale-while-revalidate` | 🟡 Warning |
| **C4** | Missing Revalidation — has ETag but never sends If-None-Match | Conditional requests (304) | 🔵 Info |

### 🔄 Pattern Rules

| Rule | What it Catches | Auto-Fix | Severity |
|------|----------------|----------|----------|
| **P1** | Missing Prefetch — predictable navigations with no prefetch | `prefetchQuery` on likely routes | 🟡 Warning |
| **P2** | Unnecessary Polling — polling every 2s, data changes every 60s | Increased interval / SSE | 🟡 Warning |
| **P3** | Missing Error Recovery — 500s with no retry | Exponential backoff retry | 🔵 Info |
| **P4** | Uncompressed Responses — JSON without gzip/brotli | Server compression config | 🔵 Info |

### 🧠 Intelligence

| Feature | What it Does |
|---------|-------------|
| **Framework Detection** | Auto-detects React, Next.js, Vue, Nuxt, Remix, SvelteKit, Angular |
| **GraphQL Dedup** | Parses operations, detects duplicate queries by hash + variables |
| **WebSocket Monitor** | Tracks WS connections, message rates, channels, subscriptions |
| **Framework-Aware Fixes** | Generates fix code for TanStack Query, SWR, Apollo, Vue composables, Angular |

---

## Installation

### CLI — Scan any URL from terminal

```bash
# Zero install (recommended)
npx flux-scan https://myapp.com -o report.html

# Or install globally
npm install -g @fluxiapi/cli
flux-scan https://myapp.com -o report.html
```

### Vue DevTools — Live monitoring in Vue 3 / Nuxt apps

```bash
npm install @fluxiapi/vue
```

```vue
<script setup>
import { FluxDevTools } from '@fluxiapi/vue';
</script>

<template>
  <RouterView />
  <FluxDevTools />
</template>
```

### React DevTools — Live monitoring in React / Next.js apps

```bash
npm install @fluxiapi/react
```

```jsx
import { FluxDevTools } from '@fluxiapi/react';

function App() {
  return (
    <>
      <YourApp />
      <FluxDevTools />
    </>
  );
}
```

### Programmatic SDK

```bash
npm install @fluxiapi/scan
```

### Chrome Extension

1. Download `packages/extension/` from this repo
2. Go to `chrome://extensions` → Enable Developer Mode
3. Click "Load unpacked" → select the extension folder
4. Open DevTools → **FluxAPI** tab → Start Scan

---

## Vue & React DevTools

### CLI vs DevTools

| Feature | CLI (`npx flux-scan`) | DevTools (`<FluxDevTools />`) |
|---------|----------------------|------------------------------|
| Runs | From terminal, outside your app | Inside your app during development |
| Captures | Initial page load (30-60s) | Every API call including user interactions |
| Sees | Network requests only | Which component triggered which call |
| Library integration | None | TanStack Query, SWR, Vue Query config |
| Feedback | One-time report | Live — code change → instant score update |

### Vue Setup

```vue
<script setup>
import { FluxDevTools } from '@fluxiapi/vue';
</script>

<template>
  <RouterView />
  <FluxDevTools force-show verbose network="jio-4g" />
</template>
```

**With TanStack Vue Query:**
```ts
import { wrapQueryClient } from '@fluxiapi/vue';
const queryClient = wrapQueryClient(new QueryClient());
app.use(VueQueryPlugin, { queryClient });
```

**Composables:**
```vue
<script setup>
import { useFluxScore, useFluxViolations, useFluxScanning } from '@fluxiapi/vue';

const score = useFluxScore();
const violations = useFluxViolations({ severity: 'critical' });
const { scanning, start, stop } = useFluxScanning();
</script>
```

**Nuxt:**
```ts
// plugins/fluxapi.client.ts
export default defineNuxtPlugin((nuxtApp) => {
  if (process.dev) {
    nuxtApp.vueApp.use(FluxPlugin, { network: 'jio-4g' });
  }
});
```

### React Setup

```jsx
import { FluxDevTools } from '@fluxiapi/react';

function App() {
  return (
    <>
      <YourApp />
      <FluxDevTools />
    </>
  );
}
```

**With TanStack Query:**
```jsx
import { wrapQueryClient } from '@fluxiapi/react';
const queryClient = wrapQueryClient(new QueryClient());
```

**With SWR:**
```jsx
import { fluxSWRMiddleware } from '@fluxiapi/react';
<SWRConfig value={{ use: [fluxSWRMiddleware] }}>
```

**Hooks:**
```jsx
import { useFluxScore, useFluxViolations, useFluxScanning } from '@fluxiapi/react';

const { overall, grade, color } = useFluxScore();
const violations = useFluxViolations({ severity: 'critical' });
const { scanning, start, stop } = useFluxScanning();
```

### `<FluxDevTools />` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `position` | `string` | `'bottom-right'` | Badge position (bottom-right/left, top-right/left) |
| `network` | `string` | `'wifi'` | Network profile for scoring |
| `analysisInterval` | `number` | `3000` | Re-analysis interval (ms) |
| `autoStart` | `boolean` | `true` | Auto-start scanning on mount |
| `defaultOpen` | `boolean` | `false` | Start with panel expanded |
| `verbose` | `boolean` | `false` | Console debug logging |
| `forceShow` | `boolean` | `false` | Show in production mode |
| `shortcut` | `string` | `'ctrl+shift+f'` | Keyboard toggle shortcut |

---

## CLI Examples

```bash
# Basic scan with HTML report
npx flux-scan https://myapp.com -o report.html

# Indian network conditions
npx flux-scan https://myapp.com --network jio-4g -o report.html

# Authenticated apps (manual login)
npx flux-scan https://myapp.com --no-headless --interact

# JSON output for CI/CD
npx flux-scan https://staging.myapp.com -f json

# Slow network stress test
npx flux-scan https://myapp.com -n bsnl-2g -o slow-report.html
```

---

## CLI Reference

```
USAGE
  npx flux-scan <url> [options]

OPTIONS
  -d, --duration <sec>   Scan duration (default: 30)
  -n, --network <n>      wifi | jio-4g | airtel-4g | airtel-3g | bsnl-2g | slow-3g
  -o, --output <file>    Output file (.html or .json)
  -f, --format <fmt>     console | html | json
  -s, --session <file>   Analyze saved session JSON
      --no-headless      Show browser window
      --interact         Manual browse mode
  -h, --help             Show help
  -v, --version          Show version

EXIT CODES
  0  Score >= 50 (pass)
  1  Score < 50  (fail)
  2  Fatal error
```

---

## Programmatic API

```typescript
import { FluxScanner, FluxAnalyzer, generateHtmlReport } from '@fluxiapi/scan';

const scanner = new FluxScanner({ duration: 60, network: 'jio-4g' });
scanner.start();
const session = scanner.stop();

const analyzer = new FluxAnalyzer({ network: 'jio-4g' });
const report = analyzer.analyze(session);
const html = generateHtmlReport(report);
```

---

## GitHub Action

```yaml
- uses: aswinsasi/fluxapi-scan-action@v1
  with:
    url: https://staging.your-app.com
    threshold: 70
    network: jio-4g
```

---

## Network-Adjusted Scoring

| Network | Latency | Bandwidth | Example Score |
|---------|---------|-----------|---------------|
| WiFi | 1.0× | 1.0× | 85/100 |
| Jio 4G | 1.8× | 2.5× | 62/100 |
| Airtel 3G | 3.0× | 5.0× | 45/100 |
| BSNL 2G | 8.0× | 15.0× | 23/100 |

---

## Architecture

```
@fluxiapi/scan        — Core library (scanner, analyzer, fixer, reporter)
@fluxiapi/cli         — npx flux-scan (Puppeteer + Chrome DevTools Protocol)
@fluxiapi/vue         — Vue 3 DevTools + composables + Vue Query integration
@fluxiapi/react       — React DevTools + hooks + TanStack Query / SWR integration
extension/           — Chrome DevTools panel (Manifest V3)
github-action/       — CI/CD integration (action.yml)
landing/             — Marketing site
```

## Packages

| Package | Description | Size |
|---------|-------------|------|
| [`@fluxiapi/scan`](https://www.npmjs.com/package/@fluxiapi/scan) | Core scanner + analyzer engine | 167 KB |
| [`@fluxiapi/cli`](https://www.npmjs.com/package/@fluxiapi/cli) | CLI tool (`npx flux-scan`) | 207 KB |
| [`@fluxiapi/vue`](https://www.npmjs.com/package/@fluxiapi/vue) | Vue 3 DevTools + composables | 34 KB |
| [`@fluxiapi/react`](https://www.npmjs.com/package/@fluxiapi/react) | React DevTools + hooks | 42 KB |

## Changelog

### v0.3.2 — Vue & React DevTools
- **`@fluxiapi/vue`** — Drop-in `<FluxDevTools />` for Vue 3 / Nuxt
- **`@fluxiapi/react`** — Drop-in `<FluxDevTools />` for React / Next.js
- Floating badge with live score, expandable panel (Overview / Violations / Requests)
- Vue composables + React hooks for custom UI
- TanStack Query + SWR integration
- Keyboard shortcut: `Ctrl+Shift+F`
- Fixed scanner interceptor lifecycle

### v0.3.0 — Smarter Scanner
- Framework detection, GraphQL dedup, WebSocket monitor
- Framework-aware fixes for 6 frameworks

### v0.2.0 — Full Rule Set
- All 13 audit rules, HTML reports, CLI, Chrome extension

### v0.1.0 — MVP
- 5 core rules, CLI scanner, Chrome extension

## License

MIT
