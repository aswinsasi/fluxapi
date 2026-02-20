# @fluxiapi/vue

Drop-in Vue DevTools for [FluxAPI](https://github.com/aswinsasi/fluxapi). Live API health monitoring for Vue 3 and Nuxt apps with TanStack Vue Query integration.

## Installation

```bash
npm install @fluxiapi/vue
```

### Requirements

- **Vue >= 3.3** (Composition API required)
- **@fluxiapi/scan** — installed automatically as a dependency

### Optional

```bash
# For TanStack Vue Query integration
npm install @tanstack/vue-query
```

---

## Quick Start

### Option 1: Just add the component (simplest)

```vue
<script setup>
import { FluxDevTools } from '@fluxiapi/vue';
</script>

<template>
  <RouterView />
  <FluxDevTools />
</template>
```

That's it. A floating badge appears in the corner showing your live API health score. Click to expand the full panel.

### Option 2: Use the Vue Plugin (recommended for larger apps)

```ts
// main.ts
import { createApp } from 'vue';
import { FluxPlugin } from '@fluxiapi/vue';
import App from './App.vue';

const app = createApp(App);
app.use(FluxPlugin, { network: 'jio-4g', autoStart: true, verbose: true });
app.mount('#app');
```

Then in any component:

```vue
<script setup>
import { FluxDevTools } from '@fluxiapi/vue';
</script>

<template>
  <FluxDevTools />
</template>
```

### Option 3: With TanStack Vue Query

```ts
// main.ts
import { createApp } from 'vue';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { FluxPlugin, wrapQueryClient } from '@fluxiapi/vue';

const queryClient = wrapQueryClient(new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
}));

const app = createApp(App);
app.use(VueQueryPlugin, { queryClient });
app.use(FluxPlugin);
app.mount('#app');
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

## Composables

Use composables in your own components to access scan data:

```vue
<script setup>
import { useFluxScore, useFluxViolations, useFluxScanning } from '@fluxiapi/vue';

const score = useFluxScore();
const violations = useFluxViolations({ severity: 'critical' });
const { scanning, elapsed, start, stop } = useFluxScanning();
</script>

<template>
  <div :style="{ color: score.color }">
    Score: {{ score.overall }} ({{ score.grade }})
    · {{ violations.length }} critical issues
    · {{ elapsed }}s elapsed
  </div>
  <button @click="scanning ? stop() : start()">
    {{ scanning ? 'Stop' : 'Start' }} Scan
  </button>
</template>
```

### Available Composables

| Composable | Returns | Description |
|------------|---------|-------------|
| `useFluxScore()` | `ComputedRef<{ overall, grade, efficiency, caching, patterns, color }>` | Current API health score |
| `useFluxViolations(filter?)` | `ComputedRef<RuleViolation[]>` | Active violations |
| `useFluxRequests(filter?)` | `ComputedRef<FluxRequestRecord[]>` | Captured requests |
| `useFluxReport()` | `ComputedRef<FluxReport \| null>` | Full analysis report |
| `useFluxScanning()` | `{ scanning, elapsed, requestCount, start, stop, reset }` | Scan lifecycle control |
| `useFluxState()` | `{ state: Ref<FluxState>, bridge }` | Full reactive state + bridge |
| `useFluxBridge()` | `ScannerBridge` | Low-level bridge access |

---

## Usage with Nuxt

### Plugin file

```ts
// plugins/fluxapi.client.ts
import { FluxPlugin } from '@fluxiapi/vue';

export default defineNuxtPlugin((nuxtApp) => {
  if (process.dev) {
    nuxtApp.vueApp.use(FluxPlugin, {
      network: 'jio-4g',
      verbose: true,
    });
  }
});
```

### In your layout

```vue
<!-- layouts/default.vue -->
<script setup>
import { FluxDevTools } from '@fluxiapi/vue';
</script>

<template>
  <slot />
  <FluxDevTools v-if="$config.public.dev" />
</template>
```

---

## Usage with iTax V2 / Laravel + Vue

Add to your main Vue entry:

```ts
// resources/js/app.ts
import { createApp } from 'vue';
import { FluxPlugin } from '@fluxiapi/vue';
import App from './App.vue';

const app = createApp(App);

// Only in development
if (import.meta.env.DEV) {
  app.use(FluxPlugin, {
    network: 'jio-4g',  // Test with Indian network conditions
    verbose: true,
  });
}

app.mount('#app');
```

Then in your root component:

```vue
<!-- App.vue -->
<script setup>
import { FluxDevTools } from '@fluxiapi/vue';
const isDev = import.meta.env.DEV;
</script>

<template>
  <RouterView />
  <FluxDevTools v-if="isDev" force-show />
</template>
```

Now when you browse iTax — every Axios/fetch call to your Laravel API gets captured and scored in real-time.

---

## What the Panel Shows

### Overview Tab
- API health score gauge (0-100) with A+/B/C/F grade
- Category breakdown: ⚡ Efficiency / 💾 Caching / 🔄 Patterns
- Stats cards: critical issues, warnings, total API calls
- Impact banner: time saveable, requests eliminable
- Top 3 issues at a glance

### Violations Tab
- All violations with severity indicators (🔴 critical, 🟡 warning, 🔵 info)
- Rule ID badges (E1, E2, E3, C1, P1, etc.)
- Impact pills showing time/requests/bandwidth savings
- Expandable: description, affected endpoints, fix code

### Requests Tab
- Live request feed (newest first)
- Method badges (GET/POST/PUT/DELETE)
- Status codes with color coding
- Duration with performance coloring (green < 200ms < orange < 500ms < red)

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
