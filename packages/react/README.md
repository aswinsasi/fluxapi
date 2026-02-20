# @fluxiapi/react

Drop-in React DevTools for [FluxAPI](https://github.com/aswinsasi/fluxapi). Live API health monitoring with TanStack Query & SWR integration.

## Installation

```bash
npm install @fluxiapi/react
```

### Requirements

- **React >= 17** (hooks required)
- **@fluxiapi/scan** — installed automatically as a dependency

### Optional Peer Dependencies

```bash
# For TanStack Query integration
npm install @tanstack/react-query

# For SWR integration
npm install swr
```

---

## Quick Start

### 1. Add `<FluxDevTools />`

```jsx
import { FluxDevTools } from '@fluxiapi/react';

function App() {
  return (
    <>
      <YourApp />
      <FluxDevTools />
    </>
  );
}
```

That's it. A floating badge appears in the corner showing your live API health score. Click to expand the full panel.

- Only renders in `development` mode
- Auto-starts scanning on mount
- Toggle with `Ctrl+Shift+F`

### 2. With TanStack Query (optional)

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluxDevTools, wrapQueryClient } from '@fluxiapi/react';

const queryClient = wrapQueryClient(new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
}));

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <YourApp />
      <FluxDevTools />
    </QueryClientProvider>
  );
}
```

`wrapQueryClient` instruments the QueryClient to capture query keys, staleTime, gcTime, refetch patterns for richer analysis.

### 3. With SWR (optional)

```jsx
import { SWRConfig } from 'swr';
import { FluxDevTools, fluxSWRMiddleware } from '@fluxiapi/react';

function App() {
  return (
    <SWRConfig value={{ use: [fluxSWRMiddleware] }}>
      <YourApp />
      <FluxDevTools />
    </SWRConfig>
  );
}
```

---

## `<FluxDevTools />` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `position` | `'bottom-right'` \| `'bottom-left'` \| `'top-right'` \| `'top-left'` | `'bottom-right'` | Badge position |
| `network` | `string` | `'wifi'` | Network profile for scoring |
| `analysisInterval` | `number` | `3000` | Re-analysis interval (ms) |
| `autoStart` | `boolean` | `true` | Auto-start scanning on mount |
| `defaultOpen` | `boolean` | `false` | Start with panel expanded |
| `verbose` | `boolean` | `false` | Console debug logging |
| `forceShow` | `boolean` | `false` | Show in production mode |
| `shortcut` | `string \| null` | `'ctrl+shift+f'` | Keyboard toggle shortcut |

---

## Hooks

Use hooks to access scan data in your own components:

```jsx
import {
  useFluxScore,
  useFluxViolations,
  useFluxRequests,
  useFluxReport,
  useFluxScanning,
} from '@fluxiapi/react';

function MyStatusBar() {
  const { overall, grade, color } = useFluxScore();
  const violations = useFluxViolations({ severity: 'critical' });
  const { scanning, elapsed, start, stop } = useFluxScanning();

  return (
    <div style={{ color }}>
      Score: {overall} ({grade}) · {violations.length} critical issues
      {scanning ? <span>Scanning... {elapsed}s</span> : null}
    </div>
  );
}
```

### Available Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useFluxScore()` | `{ overall, grade, efficiency, caching, patterns, color }` | Current API health score |
| `useFluxViolations(filter?)` | `RuleViolation[]` | Active violations, filterable by severity/category/ruleId |
| `useFluxRequests(filter?)` | `FluxRequestRecord[]` | Captured requests, filterable by type/method/duration |
| `useFluxReport()` | `FluxReport \| null` | Full analysis report |
| `useFluxScanning()` | `{ scanning, elapsed, requestCount, start, stop, reset }` | Scan lifecycle control |

---

## Advanced: Custom Provider

For shared state across components without `<FluxDevTools />`:

```jsx
import { FluxProvider, useFluxScore } from '@fluxiapi/react';

function App() {
  return (
    <FluxProvider network="jio-4g" analysisInterval={5000}>
      <Dashboard />
    </FluxProvider>
  );
}

function Dashboard() {
  const { overall } = useFluxScore();
  return <h1>API Score: {overall}</h1>;
}
```

---

## Advanced: Scanner Bridge

For full control over the scan engine:

```jsx
import { ScannerBridge } from '@fluxiapi/react';

const bridge = new ScannerBridge({
  network: 'jio-4g',
  analysisInterval: 5000,
  verbose: true,
});

// Subscribe to state changes
bridge.subscribe((state) => {
  console.log('Score:', state.score, 'Violations:', state.violations.length);
});

// Start/stop
await bridge.start();
const report = bridge.stop();

// Pass to FluxDevTools
<FluxDevTools bridge={bridge} />
```

---

## What the DevTools Panel Shows

### Overview Tab
- API health score gauge (0-100)
- Category breakdown (Efficiency / Caching / Patterns)
- Stats cards (critical, warnings, API calls)
- Impact banner (time saved, requests eliminated)
- Top 3 issues

### Violations Tab
- All violations with severity dots
- Rule ID badges (E1, C1, P2, etc.)
- Impact pills (time, requests, bandwidth)
- Expandable details with endpoints and fix code

### Requests Tab
- Live request feed (newest first)
- Method badges (GET/POST/PUT/DELETE)
- Status codes with color coding
- Duration with performance coloring

---

## 13 Rules Detected

| Category | Rules |
|----------|-------|
| ⚡ Efficiency | E1 Waterfalls, E2 Duplicates, E3 N+1, E4 Over-fetching, E5 Batchable |
| 💾 Caching | C1 No Cache, C2 Under-Caching, C3 Over-Caching, C4 Missing Revalidation |
| 🔄 Patterns | P1 Missing Prefetch, P2 Unnecessary Polling, P3 No Error Recovery, P4 Uncompressed |

---

## License

MIT
