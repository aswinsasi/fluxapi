# @fluxiapi/cli

CLI for [FluxAPI](https://github.com/aswinsasi/fluxapi) — scan any URL for API anti-patterns. **13 audit rules**, framework-aware fixes, GraphQL dedup, WebSocket monitoring.

```bash
npx flux-scan https://myapp.com -o report.html
```

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

## Use Cases

| Scenario | Command |
|----------|---------|
| Public site audit | `npx flux-scan https://myapp.com -o report.html` |
| Auth site (manual login) | `npx flux-scan https://myapp.com --no-headless --interact` |
| CI/CD gate (fail < 50) | `npx flux-scan https://staging.app.com -f json` |
| India network test | `npx flux-scan https://myapp.com -n jio-4g -o jio.html` |
| Compare networks | Run twice: `-n wifi` vs `-n bsnl-2g`, compare reports |

## Scoring

| Score | Grade | Meaning |
|-------|-------|---------|
| 90-100 | 🟢 Excellent | API layer is well optimized |
| 70-89 | 🔵 Good | Minor improvements possible |
| 50-69 | 🟡 Needs Work | Several optimization opportunities |
| 0-49 | 🔴 Poor | Significant API anti-patterns detected |

## Exit Codes

- `0` — Score >= 50 (pass)
- `1` — Score < 50 (fail — useful for CI/CD)
- `2` — Fatal error

## License

MIT
