// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Tests
// Week 1 Core Scanner Engine Tests
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseUrl,
  classifyRequest,
  fastHash,
  requestSignature,
  matchesPattern,
  shouldIgnore,
  sanitizeHeaders,
  estimateBodySize,
  formatDuration,
  formatBytes,
  generateId,
  nextSequence,
  resetSequence,
  headersToObject,
} from '../utils';

// ─── URL Parsing Tests ──────────────────────────────────────────

describe('parseUrl', () => {
  it('should parse a simple REST API URL', () => {
    const result = parseUrl('https://api.example.com/api/users/123');
    expect(result.host).toBe('api.example.com');
    expect(result.pathSegments).toEqual(['api', 'users', '123']);
    expect(result.pathPattern).toBe('/api/users/:id');
    expect(result.pathname).toBe('/api/users/123');
  });

  it('should replace UUID segments with :uuid', () => {
    const result = parseUrl('https://api.example.com/api/users/550e8400-e29b-41d4-a716-446655440000');
    expect(result.pathPattern).toBe('/api/users/:uuid');
  });

  it('should replace MongoDB ObjectId with :objectId', () => {
    const result = parseUrl('https://api.example.com/api/users/507f1f77bcf86cd799439011');
    expect(result.pathPattern).toBe('/api/users/:objectId');
  });

  it('should preserve non-dynamic segments', () => {
    const result = parseUrl('https://api.example.com/api/v2/users/settings');
    expect(result.pathPattern).toBe('/api/v2/users/settings');
  });

  it('should parse query parameters', () => {
    const result = parseUrl('https://api.example.com/api/users?page=1&limit=20');
    expect(result.queryParams).toEqual({ page: '1', limit: '20' });
  });

  it('should handle relative URLs gracefully', () => {
    const result = parseUrl('/api/users/123');
    expect(result.pathSegments).toEqual(['api', 'users', '123']);
  });
});

// ─── Request Classification Tests ───────────────────────────────

describe('classifyRequest', () => {
  it('should classify REST API calls', () => {
    expect(classifyRequest('https://api.example.com/api/users', 'GET', 'application/json', null)).toBe('api-rest');
  });

  it('should classify GraphQL calls', () => {
    expect(classifyRequest('https://api.example.com/graphql', 'POST', 'application/json', '{"query":"..."}')).toBe('api-graphql');
  });

  it('should classify static assets', () => {
    expect(classifyRequest('https://cdn.example.com/app.js', 'GET', null, null)).toBe('static');
    expect(classifyRequest('https://cdn.example.com/style.css', 'GET', null, null)).toBe('static');
    expect(classifyRequest('https://cdn.example.com/logo.png', 'GET', null, null)).toBe('static');
    expect(classifyRequest('https://cdn.example.com/font.woff2', 'GET', null, null)).toBe('static');
  });

  it('should classify documents', () => {
    expect(classifyRequest('https://example.com/', 'GET', 'text/html', null)).toBe('document');
  });

  it('should classify POST/PUT/PATCH/DELETE as API', () => {
    expect(classifyRequest('https://example.com/submit', 'POST', null, null)).toBe('api-rest');
    expect(classifyRequest('https://example.com/update', 'PUT', null, null)).toBe('api-rest');
  });

  it('should classify gRPC-Web calls', () => {
    expect(classifyRequest('https://api.example.com/service', 'POST', 'application/grpc-web+proto', null)).toBe('api-grpc');
  });
});

// ─── Hashing Tests ──────────────────────────────────────────────

describe('fastHash', () => {
  it('should produce consistent hashes', () => {
    expect(fastHash('hello')).toBe(fastHash('hello'));
  });

  it('should produce different hashes for different inputs', () => {
    expect(fastHash('hello')).not.toBe(fastHash('world'));
  });

  it('should handle empty strings', () => {
    expect(fastHash('')).toBeDefined();
  });

  it('should handle large strings', () => {
    const large = 'x'.repeat(100000);
    expect(fastHash(large)).toBeDefined();
  });
});

describe('requestSignature', () => {
  it('should create consistent signatures for same requests', () => {
    const sig1 = requestSignature('https://api.example.com/api/users/123', 'GET');
    const sig2 = requestSignature('https://api.example.com/api/users/456', 'GET');
    // Different IDs should normalize to same pattern
    expect(sig1).toBe(sig2);
  });

  it('should differentiate methods', () => {
    const sig1 = requestSignature('https://api.example.com/api/users', 'GET');
    const sig2 = requestSignature('https://api.example.com/api/users', 'POST');
    expect(sig1).not.toBe(sig2);
  });

  it('should include body hash for POST requests', () => {
    const sig1 = requestSignature('https://api.example.com/api/users', 'POST', '{"name":"a"}');
    const sig2 = requestSignature('https://api.example.com/api/users', 'POST', '{"name":"b"}');
    expect(sig1).not.toBe(sig2);
  });
});

// ─── Pattern Matching Tests ─────────────────────────────────────

describe('matchesPattern', () => {
  it('should match exact strings', () => {
    expect(matchesPattern('/api/health', '/api/health')).toBe(true);
  });

  it('should match wildcard patterns', () => {
    expect(matchesPattern('/api/users/123', '/api/users/*')).toBe(true);
  });

  it('should match double wildcard patterns', () => {
    expect(matchesPattern('/cdn/assets/js/app.js', '**/*.js')).toBe(true);
    expect(matchesPattern('/cdn/assets/style.css', '**/*.css')).toBe(true);
  });

  it('should not match non-matching patterns', () => {
    expect(matchesPattern('/api/users', '**/*.js')).toBe(false);
  });
});

describe('shouldIgnore', () => {
  it('should ignore matching patterns', () => {
    const patterns = ['**/*.js', '**/*.css', '**/analytics*'];
    expect(shouldIgnore('/cdn/app.js', patterns)).toBe(true);
    expect(shouldIgnore('/tracking/analytics/event', patterns)).toBe(true);
  });

  it('should not ignore API calls', () => {
    const patterns = ['**/*.js', '**/*.css'];
    expect(shouldIgnore('/api/users/123', patterns)).toBe(false);
  });
});

// ─── Header Utilities ───────────────────────────────────────────

describe('sanitizeHeaders', () => {
  it('should redact sensitive headers', () => {
    const headers = {
      'authorization': 'Bearer secret123',
      'content-type': 'application/json',
      'cookie': 'session=abc',
      'x-api-key': 'key123',
    };
    const sanitized = sanitizeHeaders(headers);
    expect(sanitized['authorization']).toBe('[REDACTED]');
    expect(sanitized['cookie']).toBe('[REDACTED]');
    expect(sanitized['x-api-key']).toBe('[REDACTED]');
    expect(sanitized['content-type']).toBe('application/json');
  });
});

// ─── Formatting Tests ───────────────────────────────────────────

describe('formatDuration', () => {
  it('should format milliseconds', () => {
    expect(formatDuration(150)).toBe('150ms');
    expect(formatDuration(0.5)).toBe('<1ms');
  });

  it('should format seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(30000)).toBe('30.0s');
  });

  it('should format minutes', () => {
    expect(formatDuration(90000)).toBe('1.5m');
  });
});

describe('formatBytes', () => {
  it('should format bytes', () => {
    expect(formatBytes(500)).toBe('500B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1572864)).toBe('1.5MB');
  });
});

// ─── ID Generation Tests ────────────────────────────────────────

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });

  it('should start with fx_ prefix', () => {
    expect(generateId()).toMatch(/^fx_/);
  });
});

describe('sequence', () => {
  beforeEach(() => resetSequence());

  it('should increment monotonically', () => {
    expect(nextSequence()).toBe(1);
    expect(nextSequence()).toBe(2);
    expect(nextSequence()).toBe(3);
  });

  it('should reset properly', () => {
    nextSequence();
    nextSequence();
    resetSequence();
    expect(nextSequence()).toBe(1);
  });
});
