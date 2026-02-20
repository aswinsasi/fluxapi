# @fluxiapi/cli

CLI for [FluxAPI](https://github.com/aswinsasi/fluxapi) — scan any URL for API anti-patterns. **13 audit rules**, framework-aware fixes, GraphQL dedup, WebSocket monitoring.

## Installation

### Zero install (recommended)

```bash
npx flux-scan https://myapp.com -o report.html
```

### Global install

```bash
npm install -g @fluxiapi/cli

# Now use directly:
flux-scan https://myapp.com -o report.html
```

### Prerequisites

- **Node.js >= 18** — [Download](https://nodejs.org)
- **Puppeteer** — installed automatically on first run, or manually:

```bash
npm install -g puppeteer
```

> Puppeteer downloads Chromium (~170MB) on first run. If you're behind a proxy or firewall, see [Puppeteer troubleshooting](https://pptr.dev/troubleshooting).

---

## Quick Start

```bash
# 1. Scan any URL (30 seconds, headless Chrome)
npx flux-scan https://myapp.com

# 2. Get an HTML report
npx flux-scan https://myapp.com -o report.html

# 3. Open report.html in your browser — see score, violations, and fix code
```

---

## What it Detects

### ⚡ Efficiency

| Rule | Issue | Severity |
|------|-------|----------|
| E1 | Request Waterfalls — sequential calls that could be parallel | 🔴 Critical |
| E2 | Duplicate Requests — same endpoint from multiple components | 🔴 Critical |
| E3 | N+1 Pattern — GET /items/1, /items/2 ×25 | 🔴 Critical |
| E4 | Payload Over-fetching — responses with >60% unused fields | 🟡 Warning |
| E5 | Batchable Requests — multiple calls to same service in tight window | 🟡 Warning |

### 💾 Caching

| Rule | Issue | Severity |
|------|-------|----------|
| C1 | No Cache Strategy — missing Cache-Control, ETag, staleTime | 🔴 Critical |
| C2 | Under-Caching — 95% identical responses not cached | 🟡 Warning |
| C3 | Over-Caching — cache TTL longer than data change rate | 🟡 Warning |
| C4 | Missing Revalidation — full refetch when 304 would work | 🔵 Info |

### 🔄 Patterns

| Rule | Issue | Severity |
|------|-------|----------|
| P1 | Missing Prefetch — predictable navigations with no prefetch | 🟡 Warning |
| P2 | Unnecessary Polling — polling faster than data changes | 🟡 Warning |
| P3 | Missing Error Recovery — failed requests with no retry logic | 🔵 Info |
| P4 | Uncompressed Responses — JSON without gzip/brotli | 🔵 Info |

### 🧠 Intelligence

- **Framework Detection** — auto-detects React, Next.js, Vue, Nuxt, Remix, SvelteKit, Angular
- **GraphQL Dedup** — detects duplicate queries by operation + variables hash
- **WebSocket Monitor** — tracks connections, message rates, subscriptions
- **Framework-Aware Fixes** — generates fix code for TanStack Query, SWR, Apollo, Vue composables, Angular

---

## Examples

```bash
# Quick scan (headless, 30s, console output)
npx flux-scan https://myapp.com

# Full report with Jio 4G scoring
npx flux-scan https://myapp.com -n jio-4g -o report.html

# Authenticated apps (login manually, browse, press Enter)
npx flux-scan https://myapp.com --no-headless --interact

# Longer scan with visible browser
npx flux-scan https://myapp.com --no-headless -d 60

# Analyze a saved session file
npx flux-scan --session scan-data.json -o report.html

# JSON output for CI/CD
npx flux-scan https://staging.myapp.com -f json

# Slow network stress test
npx flux-scan https://myapp.com -n bsnl-2g -o slow-report.html
```

---

## Options

```
-d, --duration <sec>    Scan duration (default: 30)
-n, --network <profile> Network: wifi | jio-4g | airtel-4g | airtel-3g | bsnl-2g | slow-3g
-o, --output <file>     Output file (.html or .json)
-f, --format <fmt>      console | html | json
-s, --session <file>    Analyze saved session JSON
    --no-headless       Show browser window
    --interact          Manual browsing mode (press Enter to stop)
-h, --help              Show help
-v, --version           Show version
```

---

## Use Cases

| Scenario | Command |
|----------|---------|
| Public site audit | `npx flux-scan https://myapp.com -o report.html` |
| Auth site (manual login) | `npx flux-scan https://myapp.com --no-headless --interact` |
| CI/CD gate (fail < 50) | `npx flux-scan https://staging.app.com -f json` |
| India network test | `npx flux-scan https://myapp.com -n jio-4g -o jio.html` |
| Compare networks | Run twice: `-n wifi` vs `-n bsnl-2g`, compare reports |

---

## Scoring

| Score | Grade | Meaning |
|-------|-------|---------|
| 90-100 | 🟢 Excellent | API layer is well optimized |
| 70-89 | 🔵 Good | Minor improvements possible |
| 50-69 | 🟡 Needs Work | Several optimization opportunities |
| 0-49 | 🔴 Poor | Significant API anti-patterns detected |

---

## Exit Codes

- `0` — Score >= 50 (pass)
- `1` — Score < 50 (fail — useful for CI/CD)
- `2` — Fatal error

---

## Troubleshooting

**Puppeteer won't install / Chromium download fails**
```bash
# Use system Chrome instead
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx flux-scan https://myapp.com
# On Windows:
set PUPPETEER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npx flux-scan https://myapp.com
```

**Scan captures 0 API requests**
- Make sure the site actually makes API calls during the scan window
- Increase duration: `-d 60`
- Use `--no-headless` to watch the browser and verify the page loads

**Permission errors on global install**
```bash
# Use npx instead (no global install needed)
npx flux-scan https://myapp.com
```

---

## Related Packages

| Package | Description |
|---------|-------------|
| [`@fluxiapi/scan`](https://www.npmjs.com/package/@fluxiapi/scan) | Core scanner + analyzer engine (programmatic API) |
| [`@fluxiapi/vue`](https://www.npmjs.com/package/@fluxiapi/vue) | `<FluxDevTools />` for Vue 3 / Nuxt — live API monitoring during development |
| [`@fluxiapi/react`](https://www.npmjs.com/package/@fluxiapi/react) | `<FluxDevTools />` for React / Next.js — live API monitoring with TanStack Query & SWR |

## License

MIT
