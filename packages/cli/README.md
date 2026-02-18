# @fluxiapi/cli

CLI for [FluxAPI](https://github.com/AswanthManoj/fluxapi) — scan any URL for API anti-patterns.

```bash
npx flux-scan https://myapp.com -o report.html
```

## Usage

```bash
# Basic scan
npx flux-scan https://myapp.com

# Jio 4G network scoring + HTML report
npx flux-scan https://myapp.com --network jio-4g -o report.html

# Analyze a saved session
npx flux-scan --session scan-data.json -o report.json

# Show browser window during scan
npx flux-scan https://myapp.com --no-headless
```

## Options

```
-d, --duration <sec>    Scan duration (default: 30)
-n, --network <profile> Network profile: wifi | jio-4g | airtel-3g | bsnl-2g
-o, --output <file>     Output file (.html or .json)
-f, --format <fmt>      console | html | json
-s, --session <file>    Analyze saved session JSON
    --no-headless       Show browser window
    --interact          Manual browsing mode (press Enter to stop)
-h, --help              Show help
```

## Exit codes

- `0` — Score >= 50
- `1` — Score < 50 (useful for CI/CD)
- `2` — Fatal error

## Requirements

- Node.js >= 18
- Puppeteer (installed automatically as optional dependency)

## License

MIT
