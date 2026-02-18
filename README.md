# ⚡ FluxAPI — Lighthouse for Your API Calls

**Scans your React app's network layer. Finds waterfalls, duplicate fetches, N+1 patterns, and missing cache. Generates fix code you can copy-paste.**

```bash
npx flux-scan https://your-app.com -o report.html
```

---

## What it does

FluxAPI monitors your app's API traffic and detects performance anti-patterns that are invisible in DevTools:

| Rule | What it Catches | Severity |
|------|----------------|----------|
| **E1** | Request Waterfalls — sequential calls that could run in parallel | 🔴 Critical |
| **E2** | Duplicate Requests — same endpoint called by multiple components | 🔴 Critical |
| **E3** | N+1 Query Pattern — GET /products/1, /products/2 ×25 | 🔴 Critical |
| **C1** | No Cache Strategy — zero Cache-Control, ETag, or staleTime | 🔴 Critical |
| **C2** | Under-Caching — 95% of fetches return identical data | 🟡 Warning |

Every violation generates **copy-pasteable React + TanStack Query code** to fix it.

---

## Quick Start

### CLI (zero install)

```bash
# Scan any URL
npx flux-scan https://myapp.com

# Jio 4G scoring + HTML report
npx flux-scan https://myapp.com --network jio-4g -o report.html

# From saved session
npx flux-scan --session scan-data.json -o report.html
```

### Programmatic API

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

### GitHub Action

```yaml
- uses: fluxapi/scan-action@v1
  with:
    url: https://staging.your-app.com
    threshold: 70
    network: jio-4g
```

### Chrome DevTools Extension

1. Load `packages/extension/` as unpacked extension
2. Open DevTools → FluxAPI tab
3. Click "Start Scan" and browse your app
4. Click "Stop" to see results

---

## Network-Adjusted Scoring

Same API issues cost differently on different networks:

| Network | Latency Multiplier | Bandwidth Penalty |
|---------|-------------------|------------------|
| WiFi | 1.0× | 1.0× |
| Jio 4G | 1.8× | 2.5× |
| Airtel 3G | 3.0× | 5.0× |
| BSNL 2G | 8.0× | 15.0× |

```bash
npx flux-scan https://myapp.com --network jio-4g
# Score: 75/100 (WiFi) → 48/100 (Jio 4G)
```

---

## Fix Code Generator

Every violation comes with production-ready React + TanStack Query code:

**E1 Waterfall → useSuspenseQueries** | **E2 Duplicates → Shared hook** | **E3 N+1 → Batch endpoint** | **C1 NoCache → staleTime + Cache-Control** | **C2 UnderCaching → Optimized TTL**

All fixes include a vanilla alternative for non-React projects.

---

## Architecture

```
@fluxiapi/scan        — Core library (scanner, analyzer, fixer, reporter)
@fluxiapi/cli         — npx flux-scan (Puppeteer + CDP)
extension/           — Chrome DevTools panel
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
