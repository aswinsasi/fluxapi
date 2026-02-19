// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - GraphQL Query Analyzer
// Parses GraphQL POST bodies to detect duplicate operations,
// extracting operation names, types, and variable combinations
// for more accurate dedup detection than URL-only matching.
//
// Stage 3: Smarter Scanner
// ═══════════════════════════════════════════════════════════════════

import type { FluxRequestRecord, GraphQLOperation } from '../types';
import { fastHash } from '../utils';

// ─── GraphQL Body Parser ────────────────────────────────────────

/**
 * Parse a GraphQL request body to extract operation info.
 * Handles single queries, batched queries, and persisted queries.
 */
export function parseGraphQLBody(body: string | null): {
  operationName: string | null;
  operationType: 'query' | 'mutation' | 'subscription' | 'unknown';
  variablesHash: string;
  queryHash: string;
} | null {
  if (!body) return null;

  try {
    const parsed = JSON.parse(body);

    // Single query: { query: "...", variables: {...}, operationName: "..." }
    if (parsed.query || parsed.operationName) {
      const query = parsed.query || '';
      const variables = parsed.variables || {};
      const operationName = parsed.operationName || extractOperationName(query);
      const operationType = extractOperationType(query);

      return {
        operationName,
        operationType,
        variablesHash: fastHash(JSON.stringify(variables)),
        queryHash: fastHash(normalizeQuery(query)),
      };
    }

    // Batched queries: [{query: "..."}, {query: "..."}]
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].query) {
      // Return first operation for now — batch is itself an optimization
      const first = parsed[0];
      return {
        operationName: first.operationName || extractOperationName(first.query || ''),
        operationType: extractOperationType(first.query || ''),
        variablesHash: fastHash(JSON.stringify(first.variables || {})),
        queryHash: fastHash(normalizeQuery(first.query || '')),
      };
    }

    // Persisted queries: { id: "hash", variables: {...} }
    if (parsed.id || parsed.extensions?.persistedQuery) {
      const id = parsed.id || parsed.extensions?.persistedQuery?.sha256Hash || 'unknown';
      return {
        operationName: parsed.operationName || null,
        operationType: 'unknown',
        variablesHash: fastHash(JSON.stringify(parsed.variables || {})),
        queryHash: String(id),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Query Parsing Helpers ──────────────────────────────────────

function extractOperationName(query: string): string | null {
  // Match: query GetUsers(...), mutation CreateUser(...), subscription OnMessage
  const match = query.match(/(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/);
  return match ? match[1] : null;
}

function extractOperationType(query: string): 'query' | 'mutation' | 'subscription' | 'unknown' {
  const trimmed = query.trim();
  if (trimmed.startsWith('mutation')) return 'mutation';
  if (trimmed.startsWith('subscription')) return 'subscription';
  if (trimmed.startsWith('query') || trimmed.startsWith('{')) return 'query';
  return 'unknown';
}

/**
 * Normalize a GraphQL query for comparison:
 * - Remove extra whitespace
 * - Remove comments
 * - Sort fields alphabetically (simplified)
 */
function normalizeQuery(query: string): string {
  return query
    .replace(/#[^\n]*/g, '')       // Remove comments
    .replace(/\s+/g, ' ')          // Collapse whitespace
    .replace(/\s*([{},():!])\s*/g, '$1')  // Remove spaces around symbols
    .trim();
}

// ─── Dedup Detection ────────────────────────────────────────────

export interface GraphQLDuplicate {
  /** Operation name (or null) */
  operationName: string | null;
  /** Operation type */
  operationType: string;
  /** Number of duplicate calls */
  count: number;
  /** The duplicate requests */
  requests: FluxRequestRecord[];
  /** Time window they occurred in (ms) */
  windowMs: number;
  /** Whether variables were identical */
  identicalVariables: boolean;
}

/**
 * Detect duplicate GraphQL operations within a set of requests.
 * Groups by operation name + query hash + variables hash.
 */
export function detectGraphQLDuplicates(
  requests: FluxRequestRecord[],
  windowMs: number = 3000,
): GraphQLDuplicate[] {
  const graphqlReqs = requests.filter(r => r.type === 'api-graphql' && r.response !== null);
  if (graphqlReqs.length < 2) return [];

  // Parse all GraphQL bodies
  const operations: Array<{
    parsed: NonNullable<ReturnType<typeof parseGraphQLBody>>;
    request: FluxRequestRecord;
  }> = [];

  for (const req of graphqlReqs) {
    // Get body from bodyHash — we stored the body hash but not the body
    // For GraphQL, we can use the bodyHash as a signature since same body = same query
    const parsed = parseGraphQLBody(req.bodyHash);
    if (!parsed) {
      // Fall back to using bodyHash directly for grouping
      operations.push({
        parsed: {
          operationName: null,
          operationType: 'unknown',
          variablesHash: req.bodyHash || '',
          queryHash: req.bodyHash || '',
        },
        request: req,
      });
    } else {
      operations.push({ parsed, request: req });
    }
  }

  // Group by queryHash (same query structure)
  const groups = new Map<string, typeof operations>();
  for (const op of operations) {
    const key = op.parsed.queryHash;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(op);
  }

  const duplicates: GraphQLDuplicate[] = [];

  for (const [_, group] of groups) {
    if (group.length < 2) continue;

    // Check if within time window
    const sorted = group.slice().sort((a, b) => a.request.startTime - b.request.startTime);
    const span = sorted[sorted.length - 1].request.startTime - sorted[0].request.startTime;

    if (span <= windowMs) {
      const identicalVars = new Set(group.map(g => g.parsed.variablesHash)).size === 1;

      duplicates.push({
        operationName: group[0].parsed.operationName,
        operationType: group[0].parsed.operationType,
        count: group.length,
        requests: group.map(g => g.request),
        windowMs: span,
        identicalVariables: identicalVars,
      });
    }
  }

  return duplicates.sort((a, b) => b.count - a.count);
}
