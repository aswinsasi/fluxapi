// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Stack Trace Capture
// Captures and parses stack traces to identify which component
// triggered each API request. Supports React, Vue, Svelte, Angular.
// ═══════════════════════════════════════════════════════════════════

import type { RequestInitiator, StackFrame } from '../types';

// ─── Internal Frames to Skip ────────────────────────────────────

const INTERNAL_PATTERNS = [
  // FluxAPI internals
  /fluxFetch/,
  /fluxXHR/,
  /interceptor\.(ts|js)/,
  /observer\//,
  /flux.*scan/i,

  // Browser internals
  /^native code$/,
  /^<anonymous>$/,

  // Framework internals (we want the component, not the framework plumbing)
  /node_modules\/react-dom/,
  /node_modules\/react\/cjs/,
  /node_modules\/scheduler/,
  /node_modules\/vue\/dist/,
  /node_modules\/@vue\/runtime/,
  /node_modules\/svelte\/internal/,
  /node_modules\/@angular\/core/,
  /node_modules\/@tanstack\/query/,
  /node_modules\/swr/,
  /node_modules\/apollo-client/,

  // Build tools
  /webpack-internal/,
  /webpack:\/\//,
  /turbopack-internal/,
  /__webpack_require__/,
];

// ─── Component Name Detection ───────────────────────────────────

/** React component name patterns in stack traces */
const REACT_COMPONENT_PATTERNS = [
  // Function components: at ComponentName (file.tsx:10:5)
  /at\s+([A-Z][a-zA-Z0-9_]*)\s+\(/,
  // Hook calls: at useEffect / useState wrapping component
  /at\s+(use[A-Z][a-zA-Z0-9_]*)\s+\(/,
];

/** Vue component patterns */
const VUE_COMPONENT_PATTERNS = [
  /at\s+setup\s+\(.*\/([A-Z][a-zA-Z0-9_]*)\.(vue|ts|js)/,
  /at\s+Proxy\.<computed>.*\/([A-Z][a-zA-Z0-9_]*)\.(vue|ts|js)/,
];

/**
 * Extract component name from a stack trace string.
 * Tries React patterns first, then Vue, then falls back to filename.
 */
function extractComponentName(stack: string): string | null {
  // Try React patterns
  for (const pattern of REACT_COMPONENT_PATTERNS) {
    const lines = stack.split('\n');
    for (const line of lines) {
      // Skip internal frames
      if (INTERNAL_PATTERNS.some(p => p.test(line))) continue;

      const match = line.match(pattern);
      if (match && match[1]) {
        // Filter out hooks - we want the component that called the hook
        if (match[1].startsWith('use')) continue;
        return match[1];
      }
    }
  }

  // Try Vue patterns
  for (const pattern of VUE_COMPONENT_PATTERNS) {
    const match = stack.match(pattern);
    if (match && match[1]) return match[1];
  }

  // Fallback: try to find any PascalCase function name
  const lines = stack.split('\n');
  for (const line of lines) {
    if (INTERNAL_PATTERNS.some(p => p.test(line))) continue;
    const pascalMatch = line.match(/at\s+([A-Z][a-zA-Z0-9]{2,})\s*[(\s]/);
    if (pascalMatch) return pascalMatch[1];
  }

  return null;
}

/**
 * Extract the component file path from a stack trace.
 */
function extractComponentFile(stack: string): string | null {
  const lines = stack.split('\n');
  for (const line of lines) {
    if (INTERNAL_PATTERNS.some(p => p.test(line))) continue;

    // Match file paths: (filename.tsx:10:5) or at file.js:10:5
    const fileMatch = line.match(/\(?([^\s()]+\.(tsx?|jsx?|vue|svelte)):(\d+):(\d+)\)?/);
    if (fileMatch) {
      let filePath = fileMatch[1];
      // Clean up webpack paths
      filePath = filePath.replace(/^webpack(-internal)?:\/\/\//, '');
      filePath = filePath.replace(/^\.\//, '');
      return filePath;
    }
  }
  return null;
}

// ─── Stack Frame Parsing ────────────────────────────────────────

/**
 * Parse a raw Error stack string into structured StackFrame objects.
 * Handles Chrome/V8, Firefox, and Safari formats.
 */
function parseStack(rawStack: string): StackFrame[] {
  const lines = rawStack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'Error') continue;

    let frame: StackFrame | null = null;

    // Chrome/V8 format: "    at functionName (file.js:10:5)"
    const chromeMatch = trimmed.match(
      /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/
    );
    if (chromeMatch) {
      frame = {
        functionName: chromeMatch[1] || '<anonymous>',
        fileName: chromeMatch[2],
        lineNumber: parseInt(chromeMatch[3], 10),
        columnNumber: parseInt(chromeMatch[4], 10),
        isInternal: false,
      };
    }

    // Firefox format: "functionName@file.js:10:5"
    if (!frame) {
      const firefoxMatch = trimmed.match(
        /^(.+?)@(.+?):(\d+):(\d+)$/
      );
      if (firefoxMatch) {
        frame = {
          functionName: firefoxMatch[1] || '<anonymous>',
          fileName: firefoxMatch[2],
          lineNumber: parseInt(firefoxMatch[3], 10),
          columnNumber: parseInt(firefoxMatch[4], 10),
          isInternal: false,
        };
      }
    }

    if (frame) {
      // Mark internal frames
      frame.isInternal = INTERNAL_PATTERNS.some(p =>
        p.test(frame!.fileName) || p.test(frame!.functionName)
      );
      frames.push(frame);
    }
  }

  return frames;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Capture the initiator context for the current call.
 * Creates an Error to capture the stack trace, then parses it
 * to identify the originating component.
 */
export function captureInitiator(): RequestInitiator {
  const err = new Error();
  const rawStack = err.stack || '';

  const allFrames = parseStack(rawStack);

  // Filter out internal frames and limit to top 10 useful frames
  const userFrames = allFrames
    .filter(f => !f.isInternal)
    .slice(0, 10);

  const componentName = extractComponentName(rawStack);
  const componentFile = extractComponentFile(rawStack);

  return {
    stackTrace: userFrames.slice(0, 5), // Top 5 for storage efficiency
    componentName,
    componentFile,
    rawStack,
  };
}

/**
 * Attempt to detect the frontend framework from the global scope.
 * Supports React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Angular.
 */
export function detectFramework(): { name: string; version: string | null; metaFramework: string | null } | null {
  if (typeof window === 'undefined') return null;

  const w = window as any;
  const doc = typeof document !== 'undefined' ? document : null;

  // ─── Next.js (check before React — Next.js apps also have React) ──
  if (w.__NEXT_DATA__ || w.__next) {
    const nextVersion = doc?.querySelector('meta[name="next-version"]')?.getAttribute('content') || null;
    return { name: 'react', version: null, metaFramework: nextVersion ? `next.js ${nextVersion}` : 'next.js' };
  }

  // ─── Nuxt (check before Vue — Nuxt apps also have Vue) ──
  if (w.__NUXT__ || w.__NUXT_ASYNC_DATA__ || w.$nuxt) {
    const nuxtVersion = w.__NUXT__?.config?.version || null;
    return { name: 'vue', version: null, metaFramework: nuxtVersion ? `nuxt ${nuxtVersion}` : 'nuxt' };
  }

  // ─── React ──
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    const renderers = w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers;
    let version: string | null = null;
    if (renderers) {
      renderers.forEach((renderer: any) => {
        if (renderer.version) version = renderer.version;
      });
    }
    // Check for Remix
    if (w.__remixContext || w.__REMIX_DEV_TOOLS) {
      return { name: 'react', version, metaFramework: 'remix' };
    }
    return { name: 'react', version, metaFramework: null };
  }

  // ─── Vue 3 ──
  if (w.__VUE__) {
    return { name: 'vue', version: w.__VUE__?.version || null, metaFramework: null };
  }

  // ─── Vue 2 ──
  if (w.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    return { name: 'vue', version: null, metaFramework: null };
  }

  // ─── SvelteKit ──
  if (w.__sveltekit) {
    return { name: 'svelte', version: null, metaFramework: 'sveltekit' };
  }

  // ─── Svelte ──
  if (doc?.querySelector('[class*="svelte-"]') || doc?.querySelector('[data-svelte]')) {
    return { name: 'svelte', version: null, metaFramework: null };
  }

  // ─── Angular ──
  if (w.ng?.probe || w.getAllAngularRootElements || doc?.querySelector('[ng-version]')) {
    const version = doc?.querySelector('[ng-version]')?.getAttribute('ng-version') || null;
    return { name: 'angular', version, metaFramework: null };
  }

  return null;
}

/**
 * Attempt to detect the data fetching library.
 */
export function detectDataLibrary(): { name: string; version: string | null } | null {
  if (typeof window === 'undefined') return null;

  const w = window as any;

  // TanStack Query (v4/v5)
  if (w.__REACT_QUERY_DEVTOOLS__ || w.__TANSTACK_QUERY_DEVTOOLS__ || w.__REACT_QUERY_GLOBAL_CACHE__) {
    return { name: 'tanstack-query', version: null };
  }

  // SWR
  if (w.__SWR_DEVTOOLS_NEXT__ || w.__SWR_STORE__) {
    return { name: 'swr', version: null };
  }

  // Apollo Client
  if (w.__APOLLO_CLIENT__) {
    const version = w.__APOLLO_CLIENT__?.version || null;
    return { name: 'apollo', version };
  }

  // RTK Query (part of Redux Toolkit)
  if (w.__REDUX_DEVTOOLS_EXTENSION__ && w.__RTK_QUERY__) {
    return { name: 'rtk-query', version: null };
  }

  // urql
  if (w.__URQL_DEVTOOLS__) {
    return { name: 'urql', version: null };
  }

  return null;
}
