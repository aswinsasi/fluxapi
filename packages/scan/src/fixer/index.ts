// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Fix Code Generator
// Generates copy-pasteable code fixes for each violation type.
// Outputs React + TanStack Query (v5) code since that's the most
// common modern stack. Also generates vanilla fetch alternatives.
//
// Each fix generator:
//   1. Reads the violation metadata
//   2. Produces a code snippet tailored to the specific issue
//   3. Returns both the code and a human explanation
// ═══════════════════════════════════════════════════════════════════

import type { RuleViolation, RuleId } from '../analyzer/types';

// ─── Fix Output ─────────────────────────────────────────────────

export interface CodeFix {
  /** Which rule this fixes */
  ruleId: RuleId;
  /** Short title of the fix */
  title: string;
  /** Human explanation of what the fix does and why */
  explanation: string;
  /** Primary code snippet (React + TanStack Query) */
  code: string;
  /** Language for syntax highlighting */
  language: 'typescript' | 'tsx' | 'javascript';
  /** Alternative vanilla fetch version */
  alternativeCode: string | null;
  /** Filename suggestion for the fix */
  suggestedFilename: string;
  /** npm packages needed (if any beyond what's expected) */
  dependencies: string[];
}

// ─── Main Generator ─────────────────────────────────────────────

export function generateFix(violation: RuleViolation): CodeFix | null {
  const generator = FIX_GENERATORS[violation.ruleId];
  if (!generator) return null;

  try {
    return generator(violation);
  } catch {
    return null;
  }
}

export function generateFixes(violations: RuleViolation[]): CodeFix[] {
  return violations.map(generateFix).filter((f): f is CodeFix => f !== null);
}

// ─── Fix Generators ─────────────────────────────────────────────

type FixGenerator = (violation: RuleViolation) => CodeFix;

const FIX_GENERATORS: Partial<Record<RuleId, FixGenerator>> = {
  E1: fixWaterfall,
  E2: fixDuplicates,
  E3: fixNPlus1,
  E4: fixOverfetching,
  E5: fixBatchable,
  C1: fixNoCache,
  C2: fixUnderCaching,
  C3: fixOverCaching,
  C4: fixMissingRevalidation,
  P1: fixMissingPrefetch,
  P2: fixUnnecessaryPolling,
  P3: fixMissingRecovery,
  P4: fixUncompressed,
};

// ─── E1: Waterfall → Promise.all ────────────────────────────────

function fixWaterfall(v: RuleViolation): CodeFix {
  const endpoints = v.affectedEndpoints;
  const component = v.affectedComponents[0] || 'MyComponent';
  const timeline = v.metadata.requestTimeline || [];

  // Build the parallel fetching code
  const hookNames = endpoints.map((ep, i) => {
    const name = endpointToHookName(ep);
    return { name, endpoint: ep, method: timeline[i]?.method || 'GET' };
  });

  const queryHooks = hookNames.map(h =>
    `  const ${h.name} = useQuery({
    queryKey: ['${endpointToKey(h.endpoint)}'],
    queryFn: () => fetch('${h.endpoint}').then(r => r.json()),
  });`
  ).join('\n\n');

  const suspenseQueries = hookNames.map(h =>
    `    { queryKey: ['${endpointToKey(h.endpoint)}'], queryFn: () => fetch('${h.endpoint}').then(r => r.json()) },`
  ).join('\n');

  const code = `// ✅ FIX: Use useSuspenseQueries to fetch in parallel
// Before: ${endpoints.length} sequential requests (${Math.round(v.metadata.totalSequentialTime || 0)}ms)
// After:  All parallel (${Math.round(v.metadata.parallelTime || 0)}ms)
// Saves:  ~${Math.round(v.impact.timeSavedMs)}ms per page load

import { useSuspenseQueries } from '@tanstack/react-query';

function ${component}() {
  const results = useSuspenseQueries({
    queries: [
${suspenseQueries}
    ],
  });

  const [${hookNames.map(h => h.name + 'Data').join(', ')}] = results.map(r => r.data);

  return (
    <div>
      {/* Use ${hookNames.map(h => h.name + 'Data').join(', ')} here */}
    </div>
  );
}`;

  const alternativeCode = `// ✅ FIX: Use Promise.all to fetch in parallel (vanilla)
async function fetchDashboardData() {
  const [${hookNames.map(h => h.name).join(', ')}] = await Promise.all([
${hookNames.map(h => `    fetch('${h.endpoint}').then(r => r.json()),`).join('\n')}
  ]);

  return { ${hookNames.map(h => h.name).join(', ')} };
}`;

  return {
    ruleId: 'E1',
    title: `Parallelize ${endpoints.length} sequential requests`,
    explanation:
      `These ${endpoints.length} API calls fire one after another, each waiting for the previous to complete. ` +
      `Since they don't depend on each other's data, they can all fire simultaneously using \`useSuspenseQueries\` ` +
      `(TanStack Query) or \`Promise.all\` (vanilla). This saves ~${Math.round(v.impact.timeSavedMs)}ms per page load.`,
    code,
    language: 'tsx',
    alternativeCode,
    suggestedFilename: `${component}.tsx`,
    dependencies: ['@tanstack/react-query'],
  };
}

// ─── E2: Duplicates → Shared Query ─────────────────────────────

function fixDuplicates(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const components = v.metadata.components || v.affectedComponents;
  const hookName = `use${endpointToHookName(endpoint).replace(/^get/, '')}`;
  const keyName = endpointToKey(endpoint);

  const code = `// ✅ FIX: Extract shared query hook — called from ${components.length} components
// Before: ${v.metadata.duplicateCount || components.length} duplicate requests to ${endpoint}
// After:  1 request, shared via TanStack Query cache
// Saves:  ${v.impact.requestsEliminated} requests, ~${Math.round(v.impact.bandwidthSavedBytes / 1024)}KB bandwidth

import { useQuery } from '@tanstack/react-query';

// Shared hook — use this in all components that need this data
export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: async () => {
      const res = await fetch('${endpoint}');
      if (!res.ok) throw new Error('Failed to fetch ${keyName}');
      return res.json();
    },
    staleTime: 30 * 1000,  // 30 seconds — prevents refetch across components
    gcTime: 5 * 60 * 1000, // 5 minutes in cache
  });
}

// Usage in each component:
${components.map((c: string) => `// ${c}.tsx → const { data } = ${hookName}();`).join('\n')}`;

  const alternativeCode = `// ✅ FIX: Use a simple cache/singleton pattern (vanilla)
let _cache = { data: null, timestamp: 0 };
const STALE_TIME = 30000; // 30 seconds

async function fetch${endpointToHookName(endpoint).replace(/^get/, '')}() {
  if (_cache.data && Date.now() - _cache.timestamp < STALE_TIME) {
    return _cache.data;
  }
  const res = await fetch('${endpoint}');
  const data = await res.json();
  _cache = { data, timestamp: Date.now() };
  return data;
}`;

  return {
    ruleId: 'E2',
    title: `Deduplicate ${endpoint} across ${components.length} components`,
    explanation:
      `${components.length} different components (${components.join(', ')}) each independently fetch "${endpoint}". ` +
      `TanStack Query automatically deduplicates requests with the same query key, so extracting a shared hook ` +
      `means only 1 network request fires regardless of how many components call it.`,
    code,
    language: 'tsx',
    alternativeCode,
    suggestedFilename: `hooks/${hookName}.ts`,
    dependencies: ['@tanstack/react-query'],
  };
}

// ─── E3: N+1 → Batch Fetch ─────────────────────────────────────

function fixNPlus1(v: RuleViolation): CodeFix {
  const pattern = v.metadata.pattern || '/api/items/:id';
  const count = v.metadata.requestCount || 10;
  const sampleUrls = v.metadata.sampleUrls || [];
  const component = v.affectedComponents[0] || 'ListComponent';
  const basePath = pattern.replace(/\/:id$|\/:\w+$/, '');
  const resourceName = basePath.split('/').pop() || 'items';

  const code = `// ✅ FIX: Replace ${count} individual requests with 1 batch request
// Before: GET ${pattern} × ${count} (${Math.round(v.metadata.totalTimeMs || 0)}ms total)
// After:  GET ${basePath}?ids=1,2,3... × 1 (~${Math.round(v.metadata.estimatedBatchTimeMs || 0)}ms)
// Saves:  ${v.impact.requestsEliminated} requests, ~${Math.round(v.impact.timeSavedMs)}ms

import { useQuery } from '@tanstack/react-query';

// Option A: If your API supports batch endpoint
function use${capitalize(resourceName)}Batch(ids: string[]) {
  return useQuery({
    queryKey: ['${resourceName}', 'batch', ids],
    queryFn: async () => {
      const res = await fetch(\`${basePath}?ids=\${ids.join(',')}\`);
      if (!res.ok) throw new Error('Batch fetch failed');
      return res.json();
    },
    enabled: ids.length > 0,
  });
}

// Option B: If no batch endpoint exists, use Promise.all with dedup
function use${capitalize(resourceName)}ByIds(ids: string[]) {
  return useQuery({
    queryKey: ['${resourceName}', 'multi', ids],
    queryFn: () => Promise.all(
      ids.map(id =>
        fetch(\`${basePath}/\${id}\`).then(r => r.json())
      )
    ),
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
  });
}

// Usage in ${component}:
function ${component}({ itemIds }: { itemIds: string[] }) {
  const { data: ${resourceName} } = use${capitalize(resourceName)}Batch(itemIds);

  return (
    <ul>
      {${resourceName}?.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}`;

  const alternativeCode = `// ✅ FIX: Batch fetch with Promise.all (vanilla)
async function fetch${capitalize(resourceName)}Batch(ids) {
  // Option A: Batch endpoint
  const res = await fetch(\`${basePath}?ids=\${ids.join(',')}\`);
  return res.json();

  // Option B: Parallel individual (still better than sequential)
  // return Promise.all(ids.map(id => fetch(\`${basePath}/\${id}\`).then(r => r.json())));
}`;

  return {
    ruleId: 'E3',
    title: `Batch ${count} individual ${resourceName} requests`,
    explanation:
      `The ${component} component fires ${count} separate requests to "${pattern}", one per list item. ` +
      `This is the classic N+1 problem. The fix is either a batch endpoint (\`?ids=1,2,3\`) or ` +
      `\`Promise.all\` for parallel fetching. This eliminates ${v.impact.requestsEliminated} requests ` +
      `and saves ~${Math.round(v.impact.timeSavedMs)}ms.`,
    code,
    language: 'tsx',
    alternativeCode,
    suggestedFilename: `hooks/use${capitalize(resourceName)}.ts`,
    dependencies: ['@tanstack/react-query'],
  };
}

// ─── C1: No Cache → Add staleTime + Cache-Control ──────────────

function fixNoCache(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const hookName = `use${endpointToHookName(endpoint).replace(/^get/, '')}`;
  const keyName = endpointToKey(endpoint);
  const reqCount = v.metadata.requestCount || 2;
  const avgSize = Math.round((v.metadata.avgResponseSize || 2048) / 1024);

  const code = `// ✅ FIX: Add caching strategy to ${endpoint}
// Before: ${reqCount} uncached requests (${avgSize}KB each, every time)
// After:  Cached with staleTime + gcTime
// Saves:  ${v.impact.requestsEliminated} requests, ~${Math.round(v.impact.bandwidthSavedBytes / 1024)}KB bandwidth

import { useQuery } from '@tanstack/react-query';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: async () => {
      const res = await fetch('${endpoint}');
      if (!res.ok) throw new Error('Failed to fetch ${keyName}');
      return res.json();
    },
    // ✅ Cache configuration
    staleTime: 5 * 60 * 1000,  // Consider fresh for 5 minutes
    gcTime: 30 * 60 * 1000,    // Keep in cache for 30 minutes
    refetchOnWindowFocus: false, // Don't refetch on tab switch
    refetchOnMount: 'always',    // But do fetch on component mount if stale
  });
}

// 💡 Also ask your backend team to add Cache-Control headers:
//
// Express.js:
//   res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
//   res.set('ETag', generateETag(data));
//
// Laravel:
//   return response()->json($data)
//     ->header('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
//     ->header('ETag', md5(json_encode($data)));
//
// Django:
//   from django.utils.cache import patch_cache_control
//   patch_cache_control(response, public=True, max_age=300)`;

  const alternativeCode = `// ✅ FIX: Manual cache wrapper (vanilla)
const cache = new Map();

async function fetchWithCache(url, ttlMs = 300000) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < ttlMs) {
    return cached.data;
  }
  const res = await fetch(url);
  const data = await res.json();
  cache.set(url, { data, time: Date.now() });
  return data;
}

// Usage: const data = await fetchWithCache('${endpoint}', 5 * 60 * 1000);`;

  return {
    ruleId: 'C1',
    title: `Add cache strategy for ${endpoint}`,
    explanation:
      `"${endpoint}" has no caching at all — no Cache-Control, no ETag, no client-side staleTime. ` +
      `Every component mount triggers a fresh network request. Adding \`staleTime: 5min\` in TanStack Query ` +
      `means repeated accesses serve from memory. Backend Cache-Control headers enable browser-level caching too.`,
    code,
    language: 'tsx',
    alternativeCode,
    suggestedFilename: `hooks/${hookName}.ts`,
    dependencies: ['@tanstack/react-query'],
  };
}

// ─── C2: Under-Caching → Increase staleTime ────────────────────

function fixUnderCaching(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const hookName = `use${endpointToHookName(endpoint).replace(/^get/, '')}`;
  const keyName = endpointToKey(endpoint);
  const redundancyPct = Math.round((v.metadata.redundancyRate || 0.9) * 100);
  const recommendedMs = v.metadata.recommendedStaleTimeMs || 300000;
  const recommendedSecs = Math.round(recommendedMs / 1000);
  const currentTtl = v.metadata.currentCacheTtlMs || 0;

  const code = `// ✅ FIX: Increase staleTime for ${endpoint}
// ${redundancyPct}% of fetches return identical data — heavily under-cached
// Before: staleTime = ${currentTtl ? Math.round(currentTtl / 1000) + 's' : '0 (no cache)'}
// After:  staleTime = ${recommendedSecs}s (based on observed data change frequency)
// Saves:  ${v.impact.requestsEliminated} redundant requests

import { useQuery } from '@tanstack/react-query';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: async () => {
      const res = await fetch('${endpoint}');
      if (!res.ok) throw new Error('Failed to fetch ${keyName}');
      return res.json();
    },
    // ✅ Optimized cache timing based on observed data change rate
    staleTime: ${recommendedMs}, // ${recommendedSecs}s — data changes ~${Math.round(100 - redundancyPct)}% of the time
    gcTime: ${recommendedMs * 3},     // ${Math.round(recommendedMs * 3 / 1000)}s in cache
    refetchOnWindowFocus: false,
    // Optionally enable background refetch:
    // refetchInterval: ${recommendedMs * 2}, // Refresh every ${Math.round(recommendedMs * 2 / 1000)}s in background
  });
}`;

  return {
    ruleId: 'C2',
    title: `Increase cache TTL for ${endpoint} (${redundancyPct}% redundant)`,
    explanation:
      `This endpoint returns identical data ${redundancyPct}% of the time, but is fetched on every access. ` +
      `Based on the observed change frequency, a staleTime of ${recommendedSecs}s would eliminate ` +
      `${v.impact.requestsEliminated} unnecessary network requests while still keeping data reasonably fresh.`,
    code,
    language: 'tsx',
    alternativeCode: null,
    suggestedFilename: `hooks/${hookName}.ts`,
    dependencies: ['@tanstack/react-query'],
  };
}

// ─── E4: Over-fetching → Field selection ─────────────────────

function fixOverfetching(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const totalFields = v.metadata.avgFieldCount || 50;
  const bodyKB = Math.round((v.metadata.avgResponseSize || 10240) / 1024);
  const resource = endpoint.split('/').pop() || 'data';

  const code = `// ✅ FIX: Reduce payload — only subset of ${totalFields} fields is used
// Before: GET ${endpoint} → ${bodyKB}KB (${totalFields} fields)
// After:  Sparse fieldset or lightweight endpoint

// Option A: Sparse fieldsets (if API supports it)
const res = await fetch('${endpoint}?fields=id,name,email,status');

// Option B: GraphQL query (return only what you need)
const QUERY = \`query { ${resource} { id name email status } }\`;

// Option C: Create a dedicated lightweight endpoint
// Backend: GET ${endpoint}/summary → returns only needed fields
// Express:
//   app.get('${endpoint}/summary', (req, res) => {
//     const full = await getData();
//     res.json({ id: full.id, name: full.name, email: full.email });
//   });`;

  return {
    ruleId: 'E4',
    title: `Reduce ${endpoint} payload (~${totalFields} fields)`,
    explanation:
      `"${endpoint}" returns ~${bodyKB}KB with ~${totalFields} fields per response. ` +
      `If your app only uses a handful of these fields, the rest is wasted bandwidth and parse time. ` +
      `Use sparse fieldsets, GraphQL, or a dedicated summary endpoint.`,
    code, language: 'typescript', alternativeCode: null,
    suggestedFilename: `api/${resource}.ts`, dependencies: [],
  };
}

// ─── E5: Batchable → Batch endpoint ─────────────────────────

function fixBatchable(v: RuleViolation): CodeFix {
  const endpoints = v.affectedEndpoints || [];
  const host = v.metadata.host || 'api';
  const count = v.metadata.requestCount || endpoints.length;

  const code = `// ✅ FIX: Batch ${count} requests to ${host} into a single call
// Before: ${count} separate requests
// After:  1 batch request
// Saves:  ~${Math.round(v.impact.timeSavedMs)}ms, ${v.impact.requestsEliminated} fewer requests

// Option A: Batch endpoint
const res = await fetch('/api/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    requests: [
${endpoints.slice(0, 5).map(ep => `      { method: 'GET', path: '${ep}' },`).join('\n')}
    ]
  })
});
const results = await res.json();

// Option B: DataLoader pattern (auto-batches within event loop tick)
import DataLoader from 'dataloader';

const apiLoader = new DataLoader(async (paths) => {
  const res = await fetch('/api/batch', {
    method: 'POST',
    body: JSON.stringify({ requests: paths.map(p => ({ method: 'GET', path: p })) })
  });
  return res.json();
});

// Usage: const data = await apiLoader.load('${endpoints[0] || '/api/resource'}');`;

  return {
    ruleId: 'E5',
    title: `Batch ${count} requests to ${host}`,
    explanation:
      `${count} separate requests fire to "${host}" within a tight window. ` +
      `A batch endpoint combines them into one network round-trip, reducing overhead.`,
    code, language: 'typescript', alternativeCode: null,
    suggestedFilename: `api/batch.ts`, dependencies: [],
  };
}

// ─── C3: Over-Caching → Reduce TTL ─────────────────────────

function fixOverCaching(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const hookName = `use${endpointToHookName(endpoint).replace(/^get/, '')}`;
  const keyName = endpointToKey(endpoint);
  const cacheSecs = Math.round((v.metadata.cacheTtlMs || 600000) / 1000);
  const changeSecs = Math.round((v.metadata.observedChangeIntervalMs || 60000) / 1000);
  const recommendedSecs = Math.max(Math.round(changeSecs * 0.5), 5);

  const code = `// ✅ FIX: Reduce cache TTL — data changes faster than cache expires
// Before: max-age=${cacheSecs}s, but data changes every ~${changeSecs}s
// After:  max-age=${recommendedSecs}s + stale-while-revalidate
// Risk:   Users were seeing stale data ~${v.metadata.staleDataRisk ? Math.round(v.metadata.staleDataRisk * 100) : '?'}% of the time

import { useQuery } from '@tanstack/react-query';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: () => fetch('${endpoint}').then(r => r.json()),
    staleTime: ${recommendedSecs * 1000}, // ${recommendedSecs}s — matches change rate
    refetchOnWindowFocus: true,
  });
}

// Backend: Add stale-while-revalidate
// Cache-Control: max-age=${recommendedSecs}, stale-while-revalidate=30`;

  return {
    ruleId: 'C3',
    title: `Reduce cache TTL for ${endpoint} (${cacheSecs}s → ${recommendedSecs}s)`,
    explanation:
      `Cache TTL (${cacheSecs}s) is much longer than data change interval (~${changeSecs}s). ` +
      `Reduce to ${recommendedSecs}s and use stale-while-revalidate for seamless background updates.`,
    code, language: 'tsx', alternativeCode: null,
    suggestedFilename: `hooks/${hookName}.ts`, dependencies: ['@tanstack/react-query'],
  };
}

// ─── C4: Missing Revalidation → Conditional requests ────────

function fixMissingRevalidation(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const hookName = `use${endpointToHookName(endpoint).replace(/^get/, '')}`;
  const keyName = endpointToKey(endpoint);
  const avgSize = Math.round((v.metadata.avgResponseSize || 5120) / 1024);

  const code = `// ✅ FIX: Use conditional requests (ETag / If-Modified-Since)
// Before: Full ${avgSize}KB download every time
// After:  304 Not Modified (~0.2KB) when data hasn't changed

import { useQuery } from '@tanstack/react-query';

let lastEtag = '';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      if (lastEtag) headers['If-None-Match'] = lastEtag;

      const res = await fetch('${endpoint}', { headers });

      if (res.status === 304) {
        return undefined; // TanStack Query keeps previous data
      }

      lastEtag = res.headers.get('ETag') || '';
      return res.json();
    },
    staleTime: 60_000,
  });
}

// Backend must return ETag or Last-Modified headers:
// Express:
//   const etag = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
//   res.set('ETag', \`"\${etag}"\`);
//
// Laravel:
//   return response()->json($data)->header('ETag', '"'.md5(json_encode($data)).'"');`;

  return {
    ruleId: 'C4',
    title: `Add ETag revalidation for ${endpoint}`,
    explanation:
      `"${endpoint}" returns ETag/Last-Modified but the client never sends conditional headers. ` +
      `This means full ${avgSize}KB responses even when data hasn't changed. ` +
      `Conditional requests would return 304 (~200 bytes) for unchanged data.`,
    code, language: 'tsx', alternativeCode: null,
    suggestedFilename: `hooks/${hookName}.ts`, dependencies: ['@tanstack/react-query'],
  };
}

// ─── P1: Missing Prefetch → prefetchQuery ───────────────────

function fixMissingPrefetch(v: RuleViolation): CodeFix {
  const fromRoute = v.metadata.fromRoute || '/dashboard';
  const toRoute = v.metadata.toRoute || '/orders';
  const probability = v.metadata.probability || 0.85;
  const endpoints = v.metadata.prefetchEndpoints || v.affectedEndpoints || ['/api/orders'];
  const savingsMs = Math.round(v.impact.timeSavedMs);

  const code = `// ✅ FIX: Prefetch data for likely next navigation
// ${Math.round(probability * 100)}% of users navigate ${fromRoute} → ${toRoute}
// Prefetching saves ~${savingsMs}ms on navigation

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

function usePrefetch${capitalize(toRoute.split('/').pop() || 'Next')}() {
  const queryClient = useQueryClient();

  useEffect(() => {
${endpoints.map((ep: string) => `    queryClient.prefetchQuery({
      queryKey: ['${endpointToKey(ep)}'],
      queryFn: () => fetch('${ep}').then(r => r.json()),
      staleTime: 60_000,
    });`).join('\n')}
  }, [queryClient]);
}

// Use in the source page component:
// function DashboardPage() {
//   usePrefetch${capitalize(toRoute.split('/').pop() || 'Next')}(); // Starts prefetching
//   return <Dashboard />;
// }

// Alternative: prefetch on hover
// <Link to="${toRoute}" onMouseEnter={() => queryClient.prefetchQuery({...})}>`;

  return {
    ruleId: 'P1',
    title: `Prefetch ${toRoute} data from ${fromRoute} (${Math.round(probability * 100)}% nav probability)`,
    explanation:
      `${Math.round(probability * 100)}% of users navigate from ${fromRoute} to ${toRoute}. ` +
      `The destination page makes API calls that take ~${savingsMs}ms. ` +
      `Prefetching this data while the user is still on ${fromRoute} eliminates the wait.`,
    code, language: 'tsx', alternativeCode: null,
    suggestedFilename: `hooks/usePrefetch.ts`, dependencies: ['@tanstack/react-query'],
  };
}

// ─── P2: Unnecessary Polling → Reduce interval / SSE ────────

function fixUnnecessaryPolling(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const hookName = `use${endpointToHookName(endpoint).replace(/^get/, '')}`;
  const keyName = endpointToKey(endpoint);
  const currentIntervalMs = v.metadata.pollingIntervalMs || 2000;
  const changeRate = v.metadata.identicalResponseRate || 0.95;
  const recommendedMs = v.metadata.recommendedIntervalMs || 60000;

  const code = `// ✅ FIX: Reduce polling frequency — ${Math.round(changeRate * 100)}% of polls return identical data
// Before: refetchInterval: ${currentIntervalMs}ms (${Math.round(changeRate * 100)}% wasted)
// After:  refetchInterval: ${recommendedMs}ms or WebSocket/SSE

import { useQuery } from '@tanstack/react-query';

// Option A: Reduced polling (simple)
export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: () => fetch('${endpoint}').then(r => r.json()),
    refetchInterval: ${recommendedMs}, // ${Math.round(recommendedMs / 1000)}s instead of ${Math.round(currentIntervalMs / 1000)}s
    refetchIntervalInBackground: false, // Don't poll when tab is hidden
  });
}

// Option B: Server-Sent Events (real-time without polling)
// function ${hookName}SSE() {
//   const [data, setData] = useState(null);
//   useEffect(() => {
//     const es = new EventSource('${endpoint}/stream');
//     es.onmessage = (e) => setData(JSON.parse(e.data));
//     return () => es.close();
//   }, []);
//   return data;
// }`;

  return {
    ruleId: 'P2',
    title: `Reduce polling for ${endpoint} (${Math.round(changeRate * 100)}% wasted)`,
    explanation:
      `"${endpoint}" is polled every ${Math.round(currentIntervalMs / 1000)}s but ` +
      `${Math.round(changeRate * 100)}% of responses are identical. ` +
      `Increase interval to ${Math.round(recommendedMs / 1000)}s or switch to SSE/WebSocket.`,
    code, language: 'tsx', alternativeCode: null,
    suggestedFilename: `hooks/${hookName}.ts`, dependencies: ['@tanstack/react-query'],
  };
}

// ─── P3: Missing Error Recovery → Retry config ──────────────

function fixMissingRecovery(v: RuleViolation): CodeFix {
  const endpoint = v.affectedEndpoints[0] || '/api/data';
  const hookName = `use${endpointToHookName(endpoint).replace(/^get/, '')}`;
  const keyName = endpointToKey(endpoint);
  const failCount = v.metadata.failedRequestCount || 1;
  const statusCodes = v.metadata.statusCodes || [500];

  const code = `// ✅ FIX: Add retry + error recovery for ${endpoint}
// ${failCount} failed request(s) with no retry detected (status: ${statusCodes.join(', ')})

import { useQuery } from '@tanstack/react-query';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: async () => {
      const res = await fetch('${endpoint}');
      if (!res.ok) throw new Error(\`\${res.status}: \${res.statusText}\`);
      return res.json();
    },
    // ✅ Retry configuration
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30000),
    // ✅ Keep showing stale data while retrying
    placeholderData: (previousData) => previousData,
    // ✅ Don't retry on 4xx (client errors)
    retryOnMount: true,
    meta: { errorHandler: 'toast' },
  });
}

// For mutations, use onError callback:
// const mutation = useMutation({
//   mutationFn: (data) => fetch('${endpoint}', { method: 'POST', body: JSON.stringify(data) }),
//   retry: 2,
//   onError: (error) => toast.error('Failed: ' + error.message),
// });`;

  return {
    ruleId: 'P3',
    title: `Add retry logic for ${endpoint} (${failCount} unrecovered failures)`,
    explanation:
      `${failCount} request(s) to "${endpoint}" failed (${statusCodes.join(', ')}) with no retry attempt. ` +
      `Adding exponential backoff retry prevents intermittent failures from breaking the UI.`,
    code, language: 'tsx', alternativeCode: null,
    suggestedFilename: `hooks/${hookName}.ts`, dependencies: ['@tanstack/react-query'],
  };
}

// ─── P4: Uncompressed → Enable compression ──────────────────

function fixUncompressed(v: RuleViolation): CodeFix {
  const endpoints = v.affectedEndpoints || ['/api/data'];
  const totalWasted = Math.round((v.impact.bandwidthSavedBytes || 0) / 1024);
  const count = v.metadata.endpointCount || endpoints.length;

  const code = `// ✅ FIX: Enable compression — ${count} endpoints sending uncompressed responses
// Estimated savings: ~${totalWasted}KB per page load (60-80% reduction)

// ── Express.js ──
import compression from 'compression';
app.use(compression()); // Adds gzip/brotli to all responses

// ── Nginx (recommended for production) ──
// http {
//   gzip on;
//   gzip_types application/json application/javascript text/css;
//   gzip_min_length 1024;
//   gzip_comp_level 6;
//
//   # Brotli (if module installed)
//   brotli on;
//   brotli_types application/json application/javascript text/css;
// }

// ── Laravel ──
// Add to app/Http/Kernel.php middleware:
// \\Illuminate\\Http\\Middleware\\SetCacheHeaders::class,
// Or use nginx-level compression (preferred)

// ── Next.js ──
// next.config.js: { compress: true } // enabled by default

// ── Client-side: Ensure Accept-Encoding header ──
// fetch('${endpoints[0]}', {
//   headers: { 'Accept-Encoding': 'gzip, deflate, br' }
// });`;

  return {
    ruleId: 'P4',
    title: `Enable compression for ${count} endpoint(s) (~${totalWasted}KB savings)`,
    explanation:
      `${count} API endpoints return uncompressed JSON responses. ` +
      `Enabling gzip/brotli compression typically reduces payload size by 60-80%, ` +
      `saving ~${totalWasted}KB per page load. This is a server-side configuration change.`,
    code, language: 'typescript', alternativeCode: null,
    suggestedFilename: `server/compression.ts`, dependencies: ['compression'],
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function endpointToHookName(endpoint: string): string {
  // /api/users/:id → getUsersById, /api/dashboard/stats → getDashboardStats
  const parts = endpoint
    .replace(/^\/api\//, '')
    .replace(/:\w+/g, '')
    .split('/')
    .filter(Boolean);

  return 'get' + parts.map(capitalize).join('');
}

function endpointToKey(endpoint: string): string {
  return endpoint
    .replace(/^\/api\//, '')
    .replace(/:\w+/g, '')
    .split('/')
    .filter(Boolean)
    .join('-');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
