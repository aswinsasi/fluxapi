#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// @fluxapi/cli — npx flux-scan
// Scans any URL for API anti-patterns and generates a report.
//
// Usage:
//   npx flux-scan https://myapp.com
//   npx flux-scan https://myapp.com --duration 30 --network jio-4g
//   npx flux-scan https://myapp.com --output report.html
//   npx flux-scan --session scan-data.json --output report.html
//
// Options:
//   --duration, -d    Scan duration in seconds (default: 30)
//   --network, -n     Network profile (wifi/jio-4g/airtel-3g/bsnl-2g/etc)
//   --output, -o      Output file (auto-detect format: .html, .json)
//   --format, -f      Output format: html, json, console (default: console)
//   --session, -s     Read from saved session JSON instead of live scan
//   --no-headless     Show browser window during scan
//   --interact        Wait for user interaction instead of timer
//   --help, -h        Show help
//   --version, -v     Show version
// ═══════════════════════════════════════════════════════════════════

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

// ─── Argument Parser ────────────────────────────────────────────

interface CliArgs {
  url: string | null;
  duration: number;
  network: string;
  output: string | null;
  format: 'html' | 'json' | 'console';
  session: string | null;
  headless: boolean;
  interact: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: null,
    duration: 30,
    network: 'wifi',
    output: null,
    format: 'console',
    session: null,
    headless: true,
    interact: false,
    help: false,
    version: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--duration': case '-d': args.duration = parseInt(next, 10) || 30; i++; break;
      case '--network': case '-n': args.network = next; i++; break;
      case '--output': case '-o': args.output = next; i++; break;
      case '--format': case '-f': args.format = next as any; i++; break;
      case '--session': case '-s': args.session = next; i++; break;
      case '--no-headless': args.headless = false; break;
      case '--interact': args.interact = true; break;
      case '--help': case '-h': args.help = true; break;
      case '--version': case '-v': args.version = true; break;
      default:
        if (!arg.startsWith('-')) positional.push(arg);
    }
  }

  args.url = positional[0] || null;

  // Auto-detect format from output extension
  if (args.output && args.format === 'console') {
    const ext = extname(args.output).toLowerCase();
    if (ext === '.html') args.format = 'html';
    else if (ext === '.json') args.format = 'json';
  }

  return args;
}

// ─── Help ───────────────────────────────────────────────────────

const HELP = `
╔═══════════════════════════════════════╗
║  ⚡ FluxAPI Scanner CLI               ║
║  Lighthouse for your API calls        ║
╚═══════════════════════════════════════╝

USAGE
  npx flux-scan <url> [options]

EXAMPLES
  Quick scan (headless, 30s, console output):
    npx flux-scan https://myapp.com

  Full report with Jio 4G scoring:
    npx flux-scan https://myapp.com -n jio-4g -o report.html

  Interactive mode (login, browse, then press Enter):
    npx flux-scan https://myapp.com --no-headless --interact

  Longer scan with visible browser:
    npx flux-scan https://myapp.com --no-headless -d 60

  Analyze a saved session file:
    npx flux-scan --session scan-data.json -o report.html

  JSON output for CI/CD:
    npx flux-scan https://staging.myapp.com -f json

  Slow network test:
    npx flux-scan https://myapp.com -n bsnl-2g -o slow-report.html

OPTIONS
  -d, --duration <sec>   Scan duration in seconds (default: 30)
  -n, --network <name>   Network profile for scoring adjustment
                         wifi | jio-4g | airtel-4g | airtel-3g | bsnl-2g | slow-3g
  -o, --output <file>    Output file path (.html or .json)
  -f, --format <fmt>     Output format: console | html | json
  -s, --session <file>   Analyze saved session JSON (skip live scan)
      --no-headless      Show browser window during scan
      --interact         Manual browse mode (press Enter to stop)
  -h, --help             Show this help
  -v, --version          Show version

USE CASES
  Public site audit        npx flux-scan https://myapp.com -o report.html
  Auth site (manual login) npx flux-scan https://myapp.com --no-headless --interact
  CI/CD gate (fail <50)    npx flux-scan https://staging.app.com -f json
  India network test       npx flux-scan https://myapp.com -n jio-4g -o jio.html
  Compare networks         Run twice: -n wifi vs -n bsnl-2g, compare reports

DETECTS
  ⚡ Efficiency
  E1  Request Waterfalls       Sequential calls that could be parallel
  E2  Duplicate Requests       Same endpoint hit from multiple components
  E3  N+1 Pattern              GET /items/1, /items/2 ... x25
  E4  Payload Over-fetching    Responses with unused fields (>60% waste)
  E5  Batchable Requests       Multiple calls to same service in tight window

  💾 Caching
  C1  No Cache Strategy        Missing Cache-Control, ETag, staleTime
  C2  Under-Caching            Near-identical responses not cached
  C3  Over-Caching             Cache TTL longer than data change rate
  C4  Missing Revalidation     Full refetch when 304 would work

  🔄 Patterns
  P1  Missing Prefetch         Predictable navigations with no prefetch
  P2  Unnecessary Polling      Polling faster than data changes
  P3  Missing Error Recovery   Failed requests with no retry logic
  P4  Uncompressed Responses   JSON without gzip/brotli compression

INTELLIGENCE
  Framework Detection    Auto-detects React, Next.js, Vue, Nuxt, Angular, Svelte
  GraphQL Dedup          Detects duplicate GraphQL operations by query + variables
  WebSocket Monitor      Tracks WS connections, message rates, subscriptions
  Smart Fixes            Fix code adapts to your stack (TanStack/SWR/Apollo/Vue/Angular)

SCORING
  90-100  🟢 Excellent — API layer is well optimized
  70-89   🔵 Good — Minor improvements possible
  50-69   🟡 Needs Work — Several optimization opportunities
  0-49    🔴 Poor — Significant API anti-patterns detected

EXIT CODES
  0  Score >= 50 (pass)
  1  Score < 50  (fail — useful for CI/CD)
  2  Fatal error
`;

// ─── Scanner Injection Script ───────────────────────────────────

function generateInjectionScript(duration: number, network: string): string {
  return `
(async function() {
  // FluxAPI Scanner — injected by CLI
  const { FluxScanner } = await import('@fluxiapi/scan');

  const scanner = new FluxScanner({
    duration: ${duration},
    network: '${network}',
    verbose: false,
  });

  window.__FLUXAPI_SCANNER__ = scanner;
  scanner.start();

  return new Promise((resolve) => {
    setTimeout(() => {
      const session = scanner.stop();
      window.__FLUXAPI_SESSION__ = session;
      resolve(session);
    }, ${duration * 1000});
  });
})();
`;
}

// ─── Live Scan (Puppeteer) ──────────────────────────────────────

async function liveScan(url: string, args: CliArgs): Promise<any> {
  let puppeteer: any;

  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.error('');
    console.error('  ❌ Puppeteer is required for live scanning.');
    console.error('');
    console.error('  Install it:');
    console.error('    npm install -g puppeteer');
    console.error('    # or');
    console.error('    npx flux-scan --session saved-session.json');
    console.error('');
    console.error('  To save a session from the browser:');
    console.error('    1. Add <script src="https://unpkg.com/@fluxiapi/scan"></script> to your page');
    console.error('    2. Open DevTools console');
    console.error('    3. Run: const s = new FluxScanner(); s.start();');
    console.error('    4. Browse for 30-60 seconds');
    console.error('    5. Run: copy(JSON.stringify(s.stop()))');
    console.error('    6. Paste into a .json file');
    console.error('    7. Run: npx flux-scan --session file.json');
    console.error('');
    process.exit(1);
  }

  const spinner = createSpinner();
  spinner.start(`Launching browser for ${url}`);

  const browser = await puppeteer.default.launch({
    headless: args.headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
  });

  const page = await browser.newPage();
  const { width, height } = await page.evaluate(() => ({
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  }));
  await page.setViewport({ width, height });

  // Intercept and collect network requests ourselves
  const requests: any[] = [];
  let reqSeq = 0;

  await page.setRequestInterception(true);

  page.on('request', (req: any) => {
    req.continue();
  });

  // Use CDP to capture detailed network timing
  const client = await page.createCDPSession();
  await client.send('Network.enable');

  const pendingRequests = new Map<string, any>();

  client.on('Network.requestWillBeSent', (params: any) => {
    reqSeq++;
    const { requestId, request, timestamp, initiator } = params;

    pendingRequests.set(requestId, {
      id: `fx_cli_${reqSeq}`,
      url: request.url,
      method: request.method,
      urlParts: parseUrlSimple(request.url),
      headers: sanitizeHeaders(request.headers || {}),
      bodySize: request.postData ? request.postData.length : 0,
      bodyHash: null,
      startTime: timestamp * 1000,
      ttfb: null,
      endTime: null,
      duration: null,
      response: null,
      initiator: {
        stackTrace: [],
        componentName: extractComponentFromStack(initiator?.stack?.callFrames),
        componentFile: null,
        rawStack: '',
      },
      navigationContext: {
        currentRoute: new URL(request.url, url).pathname,
        previousRoute: null,
        timeSinceNavigation: 0,
        pageState: 'complete',
      },
      type: classifyUrl(request.url, request.method),
      source: 'fetch' as const,
      error: null,
      sequence: reqSeq,
    });
  });

  client.on('Network.responseReceived', (params: any) => {
    const { requestId, response, timestamp } = params;
    const req = pendingRequests.get(requestId);
    if (!req) return;

    req.ttfb = timestamp * 1000;
    req.response = {
      status: response.status,
      statusText: response.statusText || '',
      headers: response.headers || {},
      bodySize: response.encodedDataLength || 0,
      contentType: response.mimeType || null,
      cacheHeaders: {
        cacheControl: response.headers?.['cache-control'] || null,
        etag: response.headers?.['etag'] || null,
        lastModified: response.headers?.['last-modified'] || null,
        expires: response.headers?.['expires'] || null,
        age: response.headers?.['age'] || null,
        acceptEncoding: false,
        contentEncoding: response.headers?.['content-encoding'] || null,
      },
      bodyHash: `cdp_${requestId.slice(0, 8)}`,
      jsonFieldCount: null,
      fromCache: response.fromDiskCache || response.fromServiceWorker || false,
    };
  });

  client.on('Network.loadingFinished', (params: any) => {
    const { requestId, timestamp, encodedDataLength } = params;
    const req = pendingRequests.get(requestId);
    if (!req) return;

    req.endTime = timestamp * 1000;
    req.duration = req.endTime - req.startTime;
    if (req.response) req.response.bodySize = encodedDataLength || req.response.bodySize;
    requests.push(req);
    pendingRequests.delete(requestId);
  });

  client.on('Network.loadingFailed', (params: any) => {
    const { requestId, errorText, timestamp } = params;
    const req = pendingRequests.get(requestId);
    if (!req) return;

    req.endTime = timestamp * 1000;
    req.duration = req.endTime - req.startTime;
    req.error = errorText;
    requests.push(req);
    pendingRequests.delete(requestId);
  });

  spinner.update(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  spinner.update(`Scanning... (${args.duration}s)`);

  if (args.interact) {
    // Wait for user to press Enter
    spinner.stop();
    console.log('');
    console.log('  🖱️  Browse the app in the opened window.');
    console.log('  Press Enter when done...');
    await waitForEnter();
  } else {
    // Auto-timer with progress bar
    await countdown(args.duration, spinner);
  }

  spinner.update('Closing browser...');
  await browser.close();

  spinner.stop();

  // Build session object
  const apiRequests = requests.filter(r =>
    r.type === 'api-rest' || r.type === 'api-graphql' || r.type === 'api-grpc'
  );

  const session = {
    id: `cli_${Date.now()}`,
    startTime: requests[0]?.startTime || 0,
    endTime: requests[requests.length - 1]?.endTime || 0,
    requests,
    navigations: [],
    stack: { framework: null, dataLibrary: null, apiType: 'rest', backendHints: detectBackend(requests) },
    config: {
      duration: args.duration,
      network: args.network,
      ignore: [],
      captureFields: false,
      maxRequests: 5000,
      minDuration: 0,
      verbose: false,
    },
    metadata: {
      pageUrl: url,
      userAgent: 'FluxAPI CLI',
      scanDuration: args.duration * 1000,
      totalRequests: requests.length,
      apiRequests: apiRequests.length,
      uniqueEndpoints: new Set(requests.map((r: any) => r.urlParts.pathPattern)).size,
      uniqueHosts: [...new Set(requests.map((r: any) => r.urlParts.host))],
    },
  };

  return session;
}

// ─── Session Loader ─────────────────────────────────────────────

function loadSession(path: string): any {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    console.error(`  ❌ Session file not found: ${abs}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf-8'));
  } catch (e) {
    console.error(`  ❌ Invalid JSON in session file: ${abs}`);
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log('flux-scan v0.3.0');
    process.exit(0);
  }

  if (args.help || (!args.url && !args.session)) {
    console.log(HELP);
    process.exit(0);
  }

  // Import @fluxapi/scan
  const { FluxAnalyzer, generateHtmlReport, exportReportJson, printReport } = await import('@fluxiapi/scan');

  // Get session data
  let session: any;

  if (args.session) {
    console.log(`  📂 Loading session from ${args.session}`);
    session = loadSession(args.session);
  } else {
    session = await liveScan(args.url!, args);
  }

  console.log(`  📊 Analyzing ${session.metadata?.apiRequests || 0} API requests...`);

  // Run analysis
  const analyzer = new FluxAnalyzer({
    network: args.network as any,
  });
  const report = analyzer.analyze(session);

  // Output results
  if (args.format === 'console' || !args.output) {
    console.log(printReport(report));
  }

  if (args.output) {
    const outPath = resolve(args.output);
    const ext = extname(outPath).toLowerCase();

    if (ext === '.html' || args.format === 'html') {
      const html = generateHtmlReport(report);
      writeFileSync(outPath, html, 'utf-8');
      console.log(`  📄 HTML report: ${outPath}`);
    } else if (ext === '.json' || args.format === 'json') {
      const json = exportReportJson(report);
      writeFileSync(outPath, json, 'utf-8');
      console.log(`  📄 JSON report: ${outPath}`);
    }
  }

  // Exit code based on score
  const exitCode = report.score.overall < 50 ? 1 : 0;
  if (exitCode === 1) {
    console.log('  ⚠️  Score below 50 — exiting with code 1 (CI failure)');
  }
  process.exit(exitCode);
}

// ─── Utility Helpers ────────────────────────────────────────────

function parseUrlSimple(rawUrl: string) {
  try {
    const u = new URL(rawUrl);
    const segments = u.pathname.split('/').filter(Boolean);
    const pattern = '/' + segments.map(s => {
      if (/^\d+$/.test(s)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)) return ':uuid';
      if (/^[a-f0-9]{24}$/.test(s)) return ':objectId';
      return s;
    }).join('/');
    return { protocol: u.protocol, host: u.host, pathSegments: segments, pathPattern: pattern, queryParams: Object.fromEntries(u.searchParams), pathname: u.pathname };
  } catch {
    return { protocol: '', host: '', pathSegments: [], pathPattern: rawUrl, queryParams: {}, pathname: rawUrl };
  }
}

function classifyUrl(url: string, method: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('/graphql')) return 'api-graphql';
  if (lower.includes('grpc')) return 'api-grpc';
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)(\?|$)/.test(lower)) return 'static';
  if (/\.(html?)(\?|$)/.test(lower)) return 'document';
  if (lower.includes('/api/') || method !== 'GET' || lower.includes('.json')) return 'api-rest';
  return 'other';
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  const sensitive = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
  for (const [k, v] of Object.entries(headers)) {
    clean[k] = sensitive.includes(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return clean;
}

function extractComponentFromStack(frames: any[] | undefined): string | null {
  if (!frames) return null;
  for (const frame of frames) {
    const name = frame.functionName || '';
    if (/^[A-Z][a-zA-Z]+$/.test(name) && !['Error', 'Promise', 'Object'].includes(name)) {
      return name;
    }
  }
  return null;
}

function detectBackend(requests: any[]) {
  let poweredBy = null;
  let server = null;
  for (const r of requests) {
    if (r.response?.headers) {
      if (r.response.headers['x-powered-by']) poweredBy = r.response.headers['x-powered-by'];
      if (r.response.headers['server']) server = r.response.headers['server'];
    }
  }
  return { poweredBy, server, detectedFramework: null };
}

// ─── Terminal UI ────────────────────────────────────────────────

function createSpinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let timer: any = null;
  let msg = '';

  return {
    start(text: string) {
      msg = text;
      timer = setInterval(() => {
        process.stdout.write(`\r  ${frames[i++ % frames.length]} ${msg}`);
      }, 80);
    },
    update(text: string) { msg = text; },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    },
  };
}

async function countdown(seconds: number, spinner: ReturnType<typeof createSpinner>) {
  for (let s = seconds; s > 0; s--) {
    const pct = ((seconds - s) / seconds) * 100;
    const filled = Math.round(pct / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    spinner.update(`Scanning [${bar}] ${s}s remaining`);
    await new Promise(r => setTimeout(r, 1000));
  }
}

function waitForEnter(): Promise<void> {
  return new Promise(resolve => {
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

// ─── Run ────────────────────────────────────────────────────────

main().catch(err => {
  console.error('  ❌ Fatal error:', err.message);
  process.exit(2);
});
