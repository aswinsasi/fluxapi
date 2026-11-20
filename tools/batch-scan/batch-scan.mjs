#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// FluxAPI 50-URL test harness  (Week 1, task #5)
//
// Runs the fixed CLI against a list of public URLs, TWICE each, and
// answers the two questions the growth decision hinges on:
//
//   Q1  Does the scanner produce MEANINGFUL findings on real sites?
//   Q2  Are the SCORES REPRODUCIBLE across two runs of the same URL?
//
// If Q1 is yes and Q2 is tight, the public "scan any URL" page is the
// one evidence-backed growth bet. If not, FluxAPI's value stays inside
// the logged-in app (SDK / agent skill / "who fired it").
//
// Results are written locally and are meant to stay PRIVATE — do not
// publish a named ranking of these sites.
//
// Usage:
//   node tools/batch-scan/batch-scan.mjs [options]
//
// Options:
//   --urls <file>        URL list, one per line (# comments ok)
//                        default: tools/batch-scan/urls.sample.txt
//   --duration <sec>     Per-scan capture time         (default: 10)
//   --network <profile>  Network profile for scoring   (default: wifi)
//   --runs <n>           Runs per URL                   (default: 2)
//   --concurrency <n>    Parallel scans                 (default: 1)
//   --out <dir>          Output dir  (default: tools/batch-scan/results)
//   --cli <path>         CLI entry (default: packages/cli/dist/cli.js)
//   --limit <n>          Only scan the first n URLs (for a smoke test)
//   --help
// ═══════════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// ─── Args ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {
    urls: join(__dirname, 'urls.sample.txt'),
    duration: 10,
    network: 'wifi',
    runs: 2,
    concurrency: 1,
    out: join(__dirname, 'results'),
    cli: join(REPO_ROOT, 'packages', 'cli', 'dist', 'cli.js'),
    limit: Infinity,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = [argv[i], argv[i + 1]];
    switch (k) {
      case '--urls': a.urls = v; i++; break;
      case '--duration': a.duration = parseInt(v, 10) || 10; i++; break;
      case '--network': a.network = v; i++; break;
      case '--runs': a.runs = Math.max(1, parseInt(v, 10) || 2); i++; break;
      case '--concurrency': a.concurrency = Math.max(1, parseInt(v, 10) || 1); i++; break;
      case '--out': a.out = v; i++; break;
      case '--cli': a.cli = v; i++; break;
      case '--limit': a.limit = Math.max(1, parseInt(v, 10) || Infinity); i++; break;
      case '--help': case '-h': a.help = true; break;
    }
  }
  return a;
}

const HELP = `
FluxAPI 50-URL test harness

  node tools/batch-scan/batch-scan.mjs [--urls f] [--duration 10]
       [--network wifi] [--runs 2] [--concurrency 1] [--limit n]

Reads a URL list, scans each URL --runs times, and writes:
  results/raw/<slug>__run<k>.json   raw CLI reports
  results/results.csv               per-run metrics
  results/summary.json              machine-readable summary
  results/summary.md                human-readable verdict

Answers:  Q1 meaningful findings?   Q2 reproducible scores?
`;

// ─── Helpers ────────────────────────────────────────────────────

function slugify(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '').slice(0, 60);
}

function loadUrls(file, limit) {
  const txt = readFileSync(file, 'utf-8');
  const urls = txt.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => (/^https?:\/\//.test(l) ? l : `https://${l}`));
  return urls.slice(0, limit);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(nums) { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; }
function percentile(nums, p) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const round1 = n => (n == null ? null : Math.round(n * 10) / 10);

// ─── Run one scan ───────────────────────────────────────────────

function runOnce(cli, url, outFile, { duration, network }) {
  return new Promise((done) => {
    const started = Date.now();
    // -t 0 so a low score never makes the CLI exit non-zero (we classify
    // exit codes ourselves; only a fatal error / timeout counts as failure).
    const args = [cli, url, '-d', String(duration), '-n', network, '-f', 'json', '-o', outFile, '-t', '0'];
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });

    // Generous guard: nav timeout (30s) + capture + buffer.
    const killAfter = (duration + 70) * 1000;
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, killAfter);

    child.on('close', (code) => {
      clearTimeout(timer);
      const wallMs = Date.now() - started;
      if (!existsSync(outFile)) {
        return done({ ok: false, error: stderr.trim().split('\n').pop() || `no output (exit ${code})`, wallMs });
      }
      try {
        const report = JSON.parse(readFileSync(outFile, 'utf-8'));
        done({ ok: true, report, wallMs });
      } catch (e) {
        done({ ok: false, error: `parse failed: ${e.message}`, wallMs });
      }
    });
    child.on('error', (e) => { clearTimeout(timer); done({ ok: false, error: e.message, wallMs: Date.now() - started }); });
  });
}

// Extract the metrics we care about from a raw report.
function metrics(report) {
  const audits = report.audits || [];
  const fired = audits.filter(a => (a.violationCount || 0) > 0);
  const topRule = [...fired].sort((a, b) => (b.violationCount || 0) - (a.violationCount || 0))[0];
  return {
    overall: report.score?.overall ?? null,
    adjusted: report.score?.networkAdjustedScore ?? null,
    grade: report.score?.grade ?? null,
    totalViolations: report.summary?.totalViolations ?? 0,
    critical: report.summary?.criticalCount ?? 0,
    warning: report.summary?.warningCount ?? 0,
    info: report.summary?.infoCount ?? 0,
    apiRequests: report.session?.apiRequests ?? 0,
    uniqueEndpoints: report.session?.uniqueEndpoints ?? 0,
    firedRules: fired.map(a => a.ruleId),
    topRule: topRule?.ruleId ?? null,
    framework: report.session?.stack?.framework?.name ?? report.session?.stack?.framework ?? null,
  };
}

// ─── Concurrency pool ───────────────────────────────────────────

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  if (!existsSync(args.cli)) {
    console.error(`\n  ❌ CLI not found at ${args.cli}`);
    console.error(`     Build it first:  npm run build --workspace=@fluxiapi/cli\n`);
    process.exit(1);
  }
  const urls = loadUrls(args.urls, args.limit);
  if (!urls.length) { console.error(`  ❌ No URLs in ${args.urls}`); process.exit(1); }

  const rawDir = join(args.out, 'raw');
  if (existsSync(rawDir)) rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });

  console.log(`\n⚡ FluxAPI 50-URL test`);
  console.log(`   urls=${urls.length}  runs=${args.runs}  duration=${args.duration}s  network=${args.network}  concurrency=${args.concurrency}`);
  console.log(`   est. time: ~${Math.ceil(urls.length * args.runs * (args.duration + 12) / args.concurrency / 60)} min\n`);

  const perUrl = await pool(urls, args.concurrency, async (url, idx) => {
    const slug = slugify(url);
    const runs = [];
    for (let k = 0; k < args.runs; k++) {
      const outFile = join(rawDir, `${slug}__run${k + 1}.json`);
      const res = await runOnce(args.cli, url, outFile, args);
      runs.push(res.ok ? { ok: true, ...metrics(res.report), wallMs: res.wallMs } : { ok: false, error: res.error, wallMs: res.wallMs });
    }
    const okRuns = runs.filter(r => r.ok);
    const allOk = okRuns.length === args.runs;

    // Determinism across the first two ok runs.
    let scoreDelta = null, violationsDelta = null, sameTopRule = null;
    if (okRuns.length >= 2) {
      scoreDelta = Math.abs((okRuns[0].overall ?? 0) - (okRuns[1].overall ?? 0));
      violationsDelta = Math.abs((okRuns[0].totalViolations ?? 0) - (okRuns[1].totalViolations ?? 0));
      sameTopRule = okRuns[0].topRule === okRuns[1].topRule;
    }
    const minApi = okRuns.length ? Math.min(...okRuns.map(r => r.apiRequests)) : 0;
    const minViol = okRuns.length ? Math.min(...okRuns.map(r => r.totalViolations)) : 0;
    const meaningful = allOk && minApi > 0 && minViol > 0;
    const lowSignal = allOk && minApi === 0;
    const stability = scoreDelta == null ? 'n/a' : scoreDelta <= 2 ? 'stable' : scoreDelta <= 10 ? 'minor' : 'unstable';

    const line = allOk
      ? `${(stability === 'stable' ? '🟢' : stability === 'minor' ? '🟡' : stability === 'unstable' ? '🔴' : '⚪')} [${idx + 1}/${urls.length}] ${url}  score ${okRuns.map(r => r.overall).join('/')}  Δ${round1(scoreDelta)}  api ${minApi}  viol ${okRuns.map(r => r.totalViolations).join('/')}`
      : `❌ [${idx + 1}/${urls.length}] ${url}  (${runs.find(r => !r.ok)?.error || 'failed'})`;
    console.log(line);

    return { url, slug, runs, allOk, scoreDelta, violationsDelta, sameTopRule, minApi, minViol, meaningful, lowSignal, stability };
  });

  // ─── Aggregate ────────────────────────────────────────────────
  const succeeded = perUrl.filter(u => u.allOk);
  const failed = perUrl.filter(u => !u.allOk);
  const meaningful = succeeded.filter(u => u.meaningful);
  const lowSignal = succeeded.filter(u => u.lowSignal);
  const deltas = succeeded.filter(u => u.scoreDelta != null).map(u => u.scoreDelta);
  const stabilityDist = {
    stable: succeeded.filter(u => u.stability === 'stable').length,
    minor: succeeded.filter(u => u.stability === 'minor').length,
    unstable: succeeded.filter(u => u.stability === 'unstable').length,
  };
  const sameTop = succeeded.filter(u => u.sameTopRule).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    config: { urls: urls.length, runs: args.runs, duration: args.duration, network: args.network },
    counts: {
      total: perUrl.length,
      succeeded: succeeded.length,
      failed: failed.length,
      meaningfulFindings: meaningful.length,
      lowSignal_noApi: lowSignal.length,
    },
    reproducibility: {
      scoreDelta_mean: round1(mean(deltas)),
      scoreDelta_median: round1(median(deltas)),
      scoreDelta_p90: round1(percentile(deltas, 90)),
      scoreDelta_max: round1(deltas.length ? Math.max(...deltas) : null),
      stability: stabilityDist,
      sameTopRule_of_succeeded: `${sameTop}/${succeeded.length}`,
    },
    failures: failed.map(u => ({ url: u.url, error: u.runs.find(r => !r.ok)?.error })),
  };

  // ─── Write outputs ────────────────────────────────────────────
  writeFileSync(join(args.out, 'summary.json'), JSON.stringify(summary, null, 2));

  const csvRows = [['url', 'run', 'ok', 'overall', 'adjusted', 'grade', 'totalViolations', 'critical', 'apiRequests', 'uniqueEndpoints', 'topRule', 'firedRules', 'framework', 'wallMs', 'error']];
  for (const u of perUrl) {
    u.runs.forEach((r, k) => {
      csvRows.push([
        u.url, k + 1, r.ok, r.overall ?? '', r.adjusted ?? '', r.grade ?? '',
        r.totalViolations ?? '', r.critical ?? '', r.apiRequests ?? '', r.uniqueEndpoints ?? '',
        r.topRule ?? '', (r.firedRules || []).join('|'), r.framework ?? '', r.wallMs ?? '', (r.error || '').replace(/[\n,]/g, ' '),
      ]);
    });
  }
  writeFileSync(join(args.out, 'results.csv'), csvRows.map(r => r.join(',')).join('\n'));

  const md = buildMarkdown(summary, perUrl);
  writeFileSync(join(args.out, 'summary.md'), md);

  // ─── Print verdict ────────────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log(md.split('\n').slice(0, 40).join('\n'));
  console.log('─'.repeat(64));
  console.log(`\n  Full results: ${args.out}`);
  console.log(`    summary.md · summary.json · results.csv · raw/\n`);
}

function buildMarkdown(s, perUrl) {
  const c = s.counts, r = s.reproducibility;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  // Heuristic read (clearly labeled — the human decides).
  const q1 = c.succeeded
    ? `${c.meaningfulFindings}/${c.succeeded} succeeded URLs produced findings (${pct(c.meaningfulFindings, c.succeeded)}%); ${c.lowSignal_noApi} had no captured API traffic (low signal — typical of logged-out/static pages).`
    : 'No URLs succeeded.';
  const q2 = r.scoreDelta_median == null
    ? 'Not enough paired runs to judge.'
    : `Median score delta between the two runs = ${r.scoreDelta_median} pts (mean ${r.scoreDelta_mean}, p90 ${r.scoreDelta_p90}, max ${r.scoreDelta_max}). Stability: ${r.stability.stable} stable (Δ≤2), ${r.stability.minor} minor (Δ≤10), ${r.stability.unstable} unstable (Δ>10).`;

  const lean =
    (c.succeeded >= 10 && pct(c.meaningfulFindings, c.succeeded) >= 50 && (r.scoreDelta_median ?? 99) <= 5)
      ? '🟢 Leans GO: meaningful findings on a majority of sites AND tight reproducibility. The public scan page is worth prototyping.'
      : (c.succeeded >= 10 && (r.scoreDelta_median ?? 99) > 10)
        ? '🔴 Leans NO-GO on reproducibility: scores swing too much between runs for a shareable permalink grade. Fix determinism first, or keep value inside the logged-in app.'
        : '🟡 Mixed / inconclusive: read the numbers below. Low signal or few successes means the public-page bet is unproven — lean toward the in-app path.';

  const rows = perUrl
    .filter(u => u.allOk)
    .sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0))
    .map(u => {
      const r0 = u.runs[0], r1 = u.runs[1] || {};
      const icon = u.stability === 'stable' ? '🟢' : u.stability === 'minor' ? '🟡' : '🔴';
      return `| ${icon} | ${u.url} | ${r0.overall}/${r1.overall ?? '-'} | ${u.scoreDelta ?? '-'} | ${u.minApi} | ${r0.totalViolations}/${r1.totalViolations ?? '-'} | ${r0.topRule ?? '-'} |`;
    }).join('\n');

  return `# FluxAPI 50-URL test — results

_Generated ${s.generatedAt}. Config: ${s.config.urls} URLs × ${s.config.runs} runs, ${s.config.duration}s, network=${s.config.network}._
_Keep private — do not publish a named ranking of these sites._

## Verdict (heuristic — you decide)

${lean}

**Q1 — Meaningful findings?**  ${q1}

**Q2 — Reproducible scores?**  ${q2}

Same top rule across both runs: ${r.sameTopRule_of_succeeded} succeeded URLs.

## Counts

| | |
|---|---|
| URLs scanned | ${c.total} |
| Succeeded (all runs) | ${c.succeeded} |
| Failed | ${c.failed} |
| With findings | ${c.meaningfulFindings} |
| Low signal (no API captured) | ${c.lowSignal_noApi} |

## Per-URL (succeeded, worst reproducibility first)

| | URL | score r1/r2 | Δ | api | viol r1/r2 | top rule |
|---|---|---|---|---|---|---|
${rows || '| | _none_ | | | | | |'}

${s.failures.length ? `## Failures\n\n${s.failures.map(f => `- \`${f.url}\` — ${f.error}`).join('\n')}` : ''}
`;
}

main().catch(e => { console.error('\n  ❌ Harness error:', e); process.exit(1); });
