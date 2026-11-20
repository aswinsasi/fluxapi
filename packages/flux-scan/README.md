# flux-scan

Unscoped alias for **[@fluxiapi/cli](https://www.npmjs.com/package/@fluxiapi/cli)** so you can run:

```bash
npx flux-scan https://your-app.com -o report.html
```

This package forwards every argument straight to `@fluxiapi/cli`. It exists
only so the short, unscoped command works. For full docs, options, and the
canonical package, see:

- **Repo:** https://github.com/aswinsasi/fluxapi
- **Canonical CLI:** `npx @fluxiapi/cli <url>`

FluxAPI scans your web app's network layer and reports API anti-patterns —
waterfalls, duplicate fetches, N+1 patterns, caching gaps, and more.
