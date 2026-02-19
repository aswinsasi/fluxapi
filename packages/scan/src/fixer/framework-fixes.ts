// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Framework-Aware Fix Generator
// Generates fix code tailored to the detected frontend stack.
// Supports React+TanStack, Vue+composables, SWR, Apollo, Angular.
//
// Stage 3: Smarter Scanner
// ═══════════════════════════════════════════════════════════════════

import type { DetectedStack } from '../types';

export type FixFramework = 'react-tanstack' | 'react-swr' | 'vue-tanstack' | 'vue-composable' | 'apollo' | 'angular' | 'vanilla';

/**
 * Determine best fix framework based on detected stack.
 */
export function detectFixFramework(stack: DetectedStack | null): FixFramework {
  if (!stack) return 'react-tanstack'; // default

  const fw = stack.framework?.name || 'unknown';
  const lib = stack.dataLibrary?.name || 'none';

  if (lib === 'apollo') return 'apollo';
  if (lib === 'swr') return 'react-swr';

  if (fw === 'vue') return lib === 'tanstack-query' ? 'vue-tanstack' : 'vue-composable';
  if (fw === 'angular') return 'angular';
  if (fw === 'react') return 'react-tanstack';

  return 'react-tanstack';
}

// ─── Dedup / Cache Fix Templates ────────────────────────────────

export function generateDedupFix(
  framework: FixFramework,
  endpoint: string,
  hookName: string,
  keyName: string,
  staleTime: number,
): { code: string; language: string; deps: string[] } {
  switch (framework) {
    case 'react-tanstack':
      return {
        code: `import { useQuery } from '@tanstack/react-query';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: () => fetch('${endpoint}').then(r => r.json()),
    staleTime: ${staleTime},
  });
}`,
        language: 'tsx',
        deps: ['@tanstack/react-query'],
      };

    case 'vue-tanstack':
      return {
        code: `import { useQuery } from '@tanstack/vue-query';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: () => fetch('${endpoint}').then(r => r.json()),
    staleTime: ${staleTime},
  });
}`,
        language: 'typescript',
        deps: ['@tanstack/vue-query'],
      };

    case 'vue-composable':
      return {
        code: `import { ref, onMounted } from 'vue';

export function ${hookName}() {
  const data = ref(null);
  const error = ref(null);
  const loading = ref(false);

  let cache = { data: null, fetchedAt: 0 };

  async function fetchData() {
    if (cache.data && Date.now() - cache.fetchedAt < ${staleTime}) {
      data.value = cache.data;
      return;
    }
    loading.value = true;
    try {
      const res = await fetch('${endpoint}');
      const json = await res.json();
      cache = { data: json, fetchedAt: Date.now() };
      data.value = json;
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

  onMounted(fetchData);
  return { data, error, loading, refetch: fetchData };
}`,
        language: 'typescript',
        deps: [],
      };

    case 'react-swr':
      return {
        code: `import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function ${hookName}() {
  return useSWR('${endpoint}', fetcher, {
    dedupingInterval: ${staleTime},
    revalidateOnFocus: false,
  });
}`,
        language: 'tsx',
        deps: ['swr'],
      };

    case 'apollo':
      return {
        code: `import { useQuery, gql } from '@apollo/client';

const GET_DATA = gql\`
  query GetData {
    # Replace with your actual query
    data { id name }
  }
\`;

export function ${hookName}() {
  return useQuery(GET_DATA, {
    fetchPolicy: 'cache-first',
    pollInterval: 0,
  });
}`,
        language: 'tsx',
        deps: ['@apollo/client'],
      };

    case 'angular':
      return {
        code: `import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { shareReplay } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class DataService {
  private cache$ = this.http.get('${endpoint}').pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(private http: HttpClient) {}

  getData() {
    return this.cache$;
  }
}`,
        language: 'typescript',
        deps: ['@angular/common'],
      };

    default:
      return {
        code: `// Simple fetch with dedup cache
const cache = new Map();

export async function fetchData(url = '${endpoint}') {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && now - cached.time < ${staleTime}) return cached.data;

  const res = await fetch(url);
  const data = await res.json();
  cache.set(url, { data, time: now });
  return data;
}`,
        language: 'typescript',
        deps: [],
      };
  }
}

// ─── Parallel / Waterfall Fix Templates ─────────────────────────

export function generateParallelFix(
  framework: FixFramework,
  endpoints: string[],
): { code: string; language: string; deps: string[] } {
  switch (framework) {
    case 'react-tanstack':
      return {
        code: `import { useQueries } from '@tanstack/react-query';

export function useParallelData() {
  return useQueries({
    queries: [
${endpoints.map(ep => `      { queryKey: ['${ep.replace(/\//g, '-').replace(/^-/, '')}'], queryFn: () => fetch('${ep}').then(r => r.json()) },`).join('\n')}
    ],
  });
}`,
        language: 'tsx',
        deps: ['@tanstack/react-query'],
      };

    case 'vue-tanstack':
      return {
        code: `import { useQueries } from '@tanstack/vue-query';

export function useParallelData() {
  return useQueries({
    queries: [
${endpoints.map(ep => `      { queryKey: ['${ep.replace(/\//g, '-').replace(/^-/, '')}'], queryFn: () => fetch('${ep}').then(r => r.json()) },`).join('\n')}
    ],
  });
}`,
        language: 'typescript',
        deps: ['@tanstack/vue-query'],
      };

    case 'react-swr':
      return {
        code: `import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

// SWR auto-deduplicates. Just call each at top level:
${endpoints.map((ep, i) => `const { data: data${i} } = useSWR('${ep}', fetcher);`).join('\n')}

// Or use Promise.all for non-hook usage:
const results = await Promise.all([
${endpoints.map(ep => `  fetch('${ep}').then(r => r.json()),`).join('\n')}
]);`,
        language: 'tsx',
        deps: ['swr'],
      };

    default:
      return {
        code: `// Fetch all in parallel with Promise.all
const results = await Promise.all([
${endpoints.map(ep => `  fetch('${ep}').then(r => r.json()),`).join('\n')}
]);`,
        language: 'typescript',
        deps: [],
      };
  }
}

// ─── Retry Fix Templates ────────────────────────────────────────

export function generateRetryFix(
  framework: FixFramework,
  endpoint: string,
  hookName: string,
  keyName: string,
): { code: string; language: string; deps: string[] } {
  switch (framework) {
    case 'react-tanstack':
    case 'vue-tanstack':
      return {
        code: `import { useQuery } from '${framework === 'vue-tanstack' ? '@tanstack/vue-query' : '@tanstack/react-query'}';

export function ${hookName}() {
  return useQuery({
    queryKey: ['${keyName}'],
    queryFn: async () => {
      const res = await fetch('${endpoint}');
      if (!res.ok) throw new Error(\`\${res.status}: \${res.statusText}\`);
      return res.json();
    },
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30000),
    placeholderData: (prev) => prev,
  });
}`,
        language: framework === 'vue-tanstack' ? 'typescript' : 'tsx',
        deps: [framework === 'vue-tanstack' ? '@tanstack/vue-query' : '@tanstack/react-query'],
      };

    case 'react-swr':
      return {
        code: `import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(\`\${r.status}\`);
  return r.json();
});

export function ${hookName}() {
  return useSWR('${endpoint}', fetcher, {
    errorRetryCount: 3,
    errorRetryInterval: 2000,
    shouldRetryOnError: true,
  });
}`,
        language: 'tsx',
        deps: ['swr'],
      };

    case 'apollo':
      return {
        code: `import { useQuery, gql } from '@apollo/client';

export function ${hookName}() {
  return useQuery(YOUR_QUERY, {
    errorPolicy: 'all',
    notifyOnNetworkStatusChange: true,
    context: {
      fetchOptions: { retryDelay: 2000, retries: 3 },
    },
  });
}`,
        language: 'tsx',
        deps: ['@apollo/client'],
      };

    default:
      return {
        code: `async function fetchWithRetry(url: string, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(\`\${res.status}\`);
      return res.json();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}`,
        language: 'typescript',
        deps: [],
      };
  }
}
