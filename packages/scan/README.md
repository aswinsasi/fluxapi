# @fluxiapi/scan

**Lighthouse for your API calls.** Scans your React app's network layer for performance anti-patterns and generates fix code.

```bash
npm install @fluxiapi/scan
```

## What it detects

| Rule | Issue | Auto-fix |
|------|-------|----------|
| E1 | Request Waterfalls (sequential calls that could be parallel) | ✅ useSuspenseQueries |
| E2 | Duplicate Requests (same endpoint from multiple components) | ✅ Shared useQuery hook |
| E3 | N+1 Pattern (GET /items/1, /items/2 ×25) | ✅ Batch endpoint |
| C1 | No Cache Strategy (missing Cache-Control, ETag, staleTime) | ✅ staleTime + headers |
| C2 | Under-Caching (95% identical responses) | ✅ Optimized TTL |

## Quick start

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

## CLI

```bash
npx flux-scan https://myapp.com -o report.html
npx flux-scan https://myapp.com --network jio-4g
```

## Docs

Full documentation: [github.com/AswanthManoj/fluxapi](https://github.com/AswanthManoj/fluxapi)

## License

MIT
