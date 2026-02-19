# ⚡ FluxAPI — Lighthouse for Your API Calls

**Scans your web app's network layer. 13 audit rules detect waterfalls, duplicate fetches, N+1 patterns, caching gaps, polling waste, and missing compression. Generates framework-aware fix code you can copy-paste.**

[![npm version](https://img.shields.io/npm/v/@fluxiapi/scan)](https://www.npmjs.com/package/@fluxiapi/scan)
[![npm version](https://img.shields.io/npm/v/@fluxiapi/cli)](https://www.npmjs.com/package/@fluxiapi/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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

### 🧠 Intelligence (v0.2.0)

| Feature | What it Does |
|---------|-------------|
| **Framework Detection** | Auto-detects React, Next.js, Vue, Nuxt, Remix, SvelteKit, Angular |
| **GraphQL Dedup** | Parses operations, detects duplicate queries by hash + variables |
| **WebSocket Monitor** | Tracks WS connections, message rates, channels, subscriptions |
| **Framework-Aware Fixes** | Generates fix code for TanStack Query, SWR, Apollo, Vue composables, Angular |

Every violation generates **framework-aware fix code** — React, Vue, Angular, SWR, Apollo — that matches your detected stack.

---

## Quick Start

### CLI (zero install)

```bash
npx flux-scan https://myapp.com
```

That's it. Opens headless Chrome, captures 30 seconds of traffic, prints the score.

---

## CLI Examples

### Basic scan with HTML report
```bash
npx flux-scan https://myapp.com -o report.html
```

### Test with Indian network conditions
```bash
npx flux-scan https://myapp.com --network jio-4g -o report.html
```

### Authenticated apps (manual login)
```bash
npx flux-scan https://myapp.com --no-headless --interact
```
Opens a visible browser → login manually → browse around → press Enter when done.

### Longer scan with visible browser
```bash
npx flux-scan https://myapp.com --no-headless -d 60
```

### Analyze a saved session
```bash
npx flux-scan --session scan-data.json -o report.html
```

### JSON output for CI/CD pipelines
```bash
npx flux-scan https://staging.myapp.com -f json
```

### Slow network stress test
```bash
npx flux-scan https://myapp.com -n bsnl-2g -o slow-report.html
```

### Compare WiFi vs Jio 4G
```bash
npx flux-scan https://myapp.com -n wifi -o wifi-report.html
npx flux-scan https://myapp.com -n jio-4g -o jio-report.html
# Compare the two HTML reports
```

---

## CLI Reference

```
USAGE
  npx flux-scan <url> [options]

OPTIONS
  -d, --duration <sec>   Scan duration in seconds (default: 30)
  -n, --network <name>   Network profile for scoring
                         wifi | jio-4g | airtel-4g | airtel-3g | bsnl-2g | slow-3g
  -o, --output <file>    Output file (.html or .json)
  -f, --format <fmt>     Output format: console | html | json
  -s, --session <file>   Analyze saved session JSON (skip live scan)
      --no-headless      Show browser window during scan
      --interact         Manual browse mode (press Enter to stop)
  -h, --help             Show help
  -v, --version          Show version

EXIT CODES
  0  Score >= 50 (pass)
  1  Score < 50  (fail — useful for CI/CD)
  2  Fatal error
```

---

## Use Cases

### 1. Pre-deploy audit
Run before every deploy to catch API regressions:
```bash
npx flux-scan https://staging.myapp.com -o report.html
# Open report.html → share with team
```

### 2. CI/CD quality gate
Fail the build if API health drops below 50:
```bash
npx flux-scan https://staging.myapp.com -f json
# Exit code 1 if score < 50
```

### 3. India market optimization
Your app works on WiFi but how does it perform on Jio 4G?
```bash
npx flux-scan https://myapp.com -n jio-4g -o jio-report.html
npx flux-scan https://myapp.com -n bsnl-2g -o bsnl-report.html
```

### 4. Authenticated app scanning
For apps behind login (admin panels, dashboards):
```bash
npx flux-scan https://admin.myapp.com --no-headless --interact
# Login manually → browse all pages → press Enter
```

### 5. Chrome DevTools (daily workflow)
Load the extension for real-time scanning while you develop:
1. Load `packages/extension/` as unpacked extension
2. Open DevTools (F12) → FluxAPI tab
3. Start Scan → browse → Stop → see results instantly
4. Export as HTML or JSON

### 6. Compare before/after optimization
```bash
# Before fix
npx flux-scan https://myapp.com -o before.html
# Apply the suggested fixes
# After fix
npx flux-scan https://myapp.com -o after.html
```

---

## Programmatic API

```typescript
import { FluxScanner, FluxAnalyzer, generateHtmlReport, printReport } from '@fluxiapi/scan';

// 1. Scan
const scanner = new FluxScanner({ duration: 60, network: 'jio-4g' });
scanner.start();
// ... user browses app ...
const session = scanner.stop();

// 2. Analyze
const analyzer = new FluxAnalyzer({
  network: 'jio-4g',
  monthlyActiveUsers: 50000,
});
const report = analyzer.analyze(session);

// 3. Output
console.log(printReport(report));          // Console table
const html = generateHtmlReport(report);   // Self-contained HTML
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

## Chrome DevTools Extension

Real-time API scanning right inside Chrome DevTools. Best for authenticated apps.

1. Go to `chrome://extensions` → Enable Developer mode
2. Click "Load unpacked" → select `packages/extension/`
3. Open any site → F12 → **FluxAPI** tab
4. Click **▶ SCAN** → browse your app → click **■ STOP**
5. View score, violations, request timeline
6. Export as **HTML** or **JSON**

---

## Network-Adjusted Scoring

Same API issues cost differently on different networks:

| Network | Latency | Bandwidth | Example Score |
|---------|---------|-----------|---------------|
| WiFi | 1.0× | 1.0× | 85/100 |
| Jio 4G | 1.8× | 2.5× | 62/100 |
| Airtel 3G | 3.0× | 5.0× | 45/100 |
| BSNL 2G | 8.0× | 15.0× | 23/100 |

```bash
npx flux-scan https://myapp.com --network jio-4g
# Same app, same API calls — different score based on real network conditions
```

---

## Fix Code Generator

Every violation comes with production-ready code:

| Rule | Fix Generated |
|------|--------------|
| E1 Waterfall | `Promise.all([...])` or `useSuspenseQueries` |
| E2 Duplicates | Shared `useQuery` hook with `staleTime` |
| E3 N+1 | Batch endpoint with `?ids=1,2,3` |
| C1 No Cache | `staleTime: 30_000` + `Cache-Control` header |
| C2 Under-Cache | Optimized TTL based on response variance |

All fixes include vanilla JS alternatives for non-React projects.

---

## Architecture

```
@fluxiapi/scan        — Core library (scanner, analyzer, fixer, reporter)
@fluxiapi/cli         — npx flux-scan (Puppeteer + Chrome DevTools Protocol)
extension/           — Chrome DevTools panel (Manifest V3)
github-action/       — CI/CD integration (action.yml)
landing/             — Marketing site
```

## Stats

| Metric | Value |
|--------|-------|
| Source lines | ~8,000 |
| Tests | 127/127 |
| Type errors | 0 |
| Build (ESM) | 117 KB |
| Build (CJS) | 120 KB |

## License

MIT
