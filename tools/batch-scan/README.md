# FluxAPI 50-URL test harness

The Week-1 go/no-go for the **public "scan any URL" page**. It runs the fixed
CLI against a list of public URLs **twice each** and answers two questions:

- **Q1 — Meaningful findings?** Does the scanner surface real issues on real sites,
  or do logged-out homepages produce empty/low-signal reports?
- **Q2 — Reproducible scores?** Does the same URL score the same across two runs?
  A shareable permalink grade only works if the number is stable.

> Keep the results **private**. Do not publish a named ranking of these sites.

## Prerequisites

```bash
# 1. Build the CLI (the harness runs the built dist)
npm run build --workspace=@fluxiapi/cli

# 2. Puppeteer needs a Chrome binary
npx puppeteer browsers install chrome
```

You also need **real internet access** — this cannot run in a sandbox.

## Run it

```bash
# Full default list (~50 URLs, 2 runs each). Takes a while — run it in the
# background or overnight. Estimate is printed at start.
node tools/batch-scan/batch-scan.mjs

# Quick smoke test first (first 3 URLs, short capture):
node tools/batch-scan/batch-scan.mjs --limit 3 --duration 6

# India-network scoring, your own list, 2 parallel scans:
node tools/batch-scan/batch-scan.mjs --urls my-urls.txt --network jio-4g --concurrency 2
```

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--urls <file>` | `urls.sample.txt` | URL list, one per line (`#` comments ok) |
| `--duration <sec>` | `10` | Capture time per scan |
| `--network <profile>` | `wifi` | Scoring profile (`wifi`, `jio-4g`, `airtel-3g`, `bsnl-2g`, …) |
| `--runs <n>` | `2` | Runs per URL (keep ≥2 to measure reproducibility) |
| `--concurrency <n>` | `1` | Parallel scans (raise cautiously; each is a full browser) |
| `--limit <n>` | all | Only the first n URLs |
| `--out <dir>` | `results/` | Output directory |
| `--cli <path>` | `packages/cli/dist/cli.js` | CLI entry point |

## Output (`results/`, git-ignored)

- **`summary.md`** — the verdict: Q1/Q2 answers, counts, and a per-URL table
  sorted by worst reproducibility. **Read this first.**
- `summary.json` — same, machine-readable.
- `results.csv` — every run's raw metrics (score, violations, API count, top rule, timing).
- `raw/` — the full CLI JSON report for each run.

## How to read it

- **Low signal** (no API captured) on many sites is expected logged-out — it's
  evidence the public page may need authenticated scans or interactive mode to
  be useful, which pushes value toward the in-app SDK path.
- **Unstable scores** (large Δ between the two runs) are expected on ad/analytics-heavy
  sites, because each load captures different requests. If the median Δ is large,
  a shareable permalink grade isn't trustworthy yet.

The printed verdict is a **heuristic** to orient you — the decision is yours,
based on the numbers.
