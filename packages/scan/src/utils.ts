// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Utilities
// URL parsing, hashing, pattern matching, ID generation
// ═══════════════════════════════════════════════════════════════════

import type { ParsedUrl, RequestType } from './types';

let _sequence = 0;

/** Generate a unique ID for requests/events */
export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `fx_${ts}_${rand}`;
}

/** Get next sequence number */
export function nextSequence(): number {
  return ++_sequence;
}

/** Reset sequence counter (for testing) */
export function resetSequence(): void {
  _sequence = 0;
}

// ─── URL Parsing ────────────────────────────────────────────────

/** UUID regex pattern */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Numeric ID pattern */
const NUMERIC_ID_PATTERN = /^\d+$/;
/** MongoDB ObjectId pattern */
const OBJECTID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * Parse a URL into components useful for pattern matching.
 * Replaces dynamic segments (IDs, UUIDs) with :param placeholders.
 */
export function parseUrl(urlStr: string): ParsedUrl {
  try {
    const url = new URL(urlStr);
    const pathSegments = url.pathname
      .split('/')
      .filter(Boolean);

    // Build path pattern by replacing dynamic segments
    const patternSegments = pathSegments.map(seg => {
      if (NUMERIC_ID_PATTERN.test(seg)) return ':id';
      if (UUID_PATTERN.test(seg)) return ':uuid';
      if (OBJECTID_PATTERN.test(seg)) return ':objectId';
      return seg;
    });

    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    return {
      protocol: url.protocol,
      host: url.host,
      pathSegments,
      pathPattern: '/' + patternSegments.join('/'),
      queryParams,
      pathname: url.pathname,
    };
  } catch {
    // Relative URL or malformed - do best effort
    return {
      protocol: '',
      host: '',
      pathSegments: urlStr.split('/').filter(Boolean),
      pathPattern: urlStr,
      queryParams: {},
      pathname: urlStr,
    };
  }
}

// ─── Request Classification ─────────────────────────────────────

const STATIC_EXTENSIONS = new Set([
  'js', 'mjs', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif',
  'ico', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'map', 'mp4', 'webm',
]);

/**
 * Classify a request based on URL, headers, and content type.
 */
export function classifyRequest(
  url: string,
  method: string,
  contentType: string | null,
  requestBody: string | null,
): RequestType {
  const parsed = parseUrl(url);

  // Check for static assets
  const lastSegment = parsed.pathSegments[parsed.pathSegments.length - 1] || '';
  const ext = lastSegment.split('.').pop()?.toLowerCase() || '';
  if (STATIC_EXTENSIONS.has(ext)) return 'static';

  // Check for GraphQL
  if (
    parsed.pathname.includes('/graphql') ||
    (contentType?.includes('application/json') && requestBody?.includes('"query"'))
  ) {
    return 'api-graphql';
  }

  // Check for gRPC-Web
  if (
    contentType?.includes('application/grpc-web') ||
    contentType?.includes('application/grpc')
  ) {
    return 'api-grpc';
  }

  // Check for document
  if (
    contentType?.includes('text/html') ||
    parsed.pathname === '/' ||
    parsed.pathname.endsWith('.html')
  ) {
    return 'document';
  }

  // Check for API calls (common patterns)
  if (
    parsed.pathname.startsWith('/api/') ||
    parsed.pathname.startsWith('/v1/') ||
    parsed.pathname.startsWith('/v2/') ||
    parsed.pathname.startsWith('/v3/') ||
    contentType?.includes('application/json') ||
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())
  ) {
    return 'api-rest';
  }

  return 'other';
}

// ─── Hashing ────────────────────────────────────────────────────

/**
 * Fast, non-cryptographic string hash for dedup detection.
 * Uses djb2 algorithm - good enough for comparing request/response bodies.
 */
export function fastHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Hash for URL + method + params combo (for duplicate detection).
 */
export function requestSignature(url: string, method: string, body?: string | null): string {
  const parsed = parseUrl(url);
  const sortedParams = Object.keys(parsed.queryParams)
    .sort()
    .map(k => `${k}=${parsed.queryParams[k]}`)
    .join('&');
  const sig = `${method.toUpperCase()}:${parsed.host}${parsed.pathPattern}?${sortedParams}`;
  return body ? `${sig}|${fastHash(body)}` : sig;
}

// ─── Pattern Matching ───────────────────────────────────────────

/**
 * Match URL against glob-like ignore patterns.
 * Supports: * (any single segment), ** (any path), ? (any char)
 */
export function matchesPattern(url: string, pattern: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regexStr}$`).test(url) ||
         new RegExp(regexStr).test(url);
}

/**
 * Check if a URL should be ignored based on config patterns.
 */
export function shouldIgnore(url: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchesPattern(url, pattern));
}

// ─── Header Utilities ───────────────────────────────────────────

/** List of headers to redact for privacy */
const REDACT_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  'x-auth-token', 'x-csrf-token', 'x-xsrf-token',
]);

/**
 * Sanitize headers - redact sensitive values.
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (REDACT_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Extract headers from a Headers object into a plain object.
 */
export function headersToObject(headers: Headers | Record<string, string>): Record<string, string> {
  const obj: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      obj[key.toLowerCase()] = value;
    });
  } else {
    for (const [key, value] of Object.entries(headers)) {
      obj[key.toLowerCase()] = value;
    }
  }
  return obj;
}

// ─── Size Estimation ────────────────────────────────────────────

/**
 * Estimate body size from various input types.
 */
export function estimateBodySize(body: BodyInit | null | undefined): number {
  if (!body) return 0;
  if (typeof body === 'string') return new Blob([body]).size;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (body instanceof FormData) {
    // Rough estimate for FormData
    let size = 0;
    body.forEach((value, key) => {
      size += key.length + 2; // key + "="
      if (typeof value === 'string') size += value.length;
      else if (value instanceof Blob) size += value.size;
    });
    return size;
  }
  return 0;
}

// ─── Time Formatting ────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
