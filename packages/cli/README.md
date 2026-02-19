# @fluxiapi/cli

CLI for [FluxAPI](https://github.com/aswinsasi/fluxapi) — scan any URL for API anti-patterns.

```bash
npx flux-scan https://myapp.com -o report.html
```

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
```

## Use Cases

| Scenario | Command |
|----------|---------|
| Public site audit | `npx flux-scan https://myapp.com -o report.html` |
| Auth site (manual login) | `npx flux-scan https://myapp.com --no-headless --interact` |
| CI/CD gate | `npx flux-scan https://staging.app.com -f json` |
| India network test | `npx flux-scan https://myapp.com -n jio-4g -o jio.html` |
| Compare networks | Run twice: `-n wifi` vs `-n bsnl-2g` |

## Exit codes

- `0` — Score >= 50 (pass)
- `1` — Score < 50 (fail — useful for CI/CD)
- `2` — Fatal error

## License

MIT