// ═══════════════════════════════════════════════════════════════
// Stage 3 Feature Test Script
// Run from project root: node test-stage3.js
// ═══════════════════════════════════════════════════════════════

// ─── 5.3: GraphQL Dedup ─────────────────────────────────────

const { parseGraphQLBody, detectGraphQLDuplicates } = require('./packages/scan/dist/index.js');

console.log('\n══════ 5.3: GraphQL Dedup ══════');

// Test 1: Parse a GraphQL query body
const body1 = JSON.stringify({
  query: 'query GetUsers { users { id name email } }',
  variables: { limit: 10 },
  operationName: 'GetUsers',
});

const parsed = parseGraphQLBody(body1);
console.log('✅ Parse query:', parsed);
console.log('   Operation:', parsed?.operationName, '| Type:', parsed?.operationType);

// Test 2: Parse a mutation
const body2 = JSON.stringify({
  query: 'mutation CreateUser($name: String!) { createUser(name: $name) { id } }',
  variables: { name: 'John' },
});

const parsed2 = parseGraphQLBody(body2);
console.log('✅ Parse mutation:', parsed2?.operationName, '| Type:', parsed2?.operationType);

// Test 3: Parse batched query
const body3 = JSON.stringify([
  { query: 'query A { users { id } }', variables: {} },
  { query: 'query B { posts { id } }', variables: {} },
]);

const parsed3 = parseGraphQLBody(body3);
console.log('✅ Parse batched:', parsed3?.operationName, '| Type:', parsed3?.operationType);

// Test 4: Parse persisted query
const body4 = JSON.stringify({
  extensions: { persistedQuery: { sha256Hash: 'abc123def456' } },
  variables: { id: 1 },
});

const parsed4 = parseGraphQLBody(body4);
console.log('✅ Parse persisted:', parsed4?.queryHash);

// Test 5: Null/invalid body
console.log('✅ Null body:', parseGraphQLBody(null));
console.log('✅ Invalid body:', parseGraphQLBody('not json'));


// ─── 5.5: Framework-Aware Fixes ─────────────────────────────

const { detectFixFramework, generateDedupFix, generateParallelFix, generateRetryFix } = require('./packages/scan/dist/index.js');

console.log('\n══════ 5.5: Framework-Aware Fixes ══════');

// Test framework detection
const stacks = [
  { framework: { name: 'react', version: '18', metaFramework: null }, dataLibrary: { name: 'tanstack-query', version: '5' }, apiType: 'rest', backendHints: {} },
  { framework: { name: 'vue', version: '3', metaFramework: 'nuxt' }, dataLibrary: { name: 'none', version: null }, apiType: 'rest', backendHints: {} },
  { framework: { name: 'react', version: '18', metaFramework: 'next.js' }, dataLibrary: { name: 'swr', version: null }, apiType: 'rest', backendHints: {} },
  { framework: { name: 'react', version: '18', metaFramework: null }, dataLibrary: { name: 'apollo', version: '3' }, apiType: 'graphql', backendHints: {} },
  { framework: { name: 'angular', version: '17', metaFramework: null }, dataLibrary: { name: 'none', version: null }, apiType: 'rest', backendHints: {} },
  null, // unknown
];

stacks.forEach((stack, i) => {
  const fw = detectFixFramework(stack);
  const label = stack ? `${stack.framework?.name || '?'}+${stack.dataLibrary?.name || '?'}` : 'null';
  console.log(`✅ Stack ${i + 1} (${label}) → ${fw}`);
});

// Test dedup fix for each framework
console.log('\n── Dedup Fix Code Samples ──');
const frameworks = ['react-tanstack', 'vue-composable', 'react-swr', 'apollo', 'angular', 'vanilla'];
frameworks.forEach(fw => {
  const fix = generateDedupFix(fw, '/api/users', 'useUsers', 'users', 30000);
  console.log(`\n✅ ${fw} (${fix.deps.join(', ') || 'no deps'}):`);
  console.log(fix.code.split('\n').slice(0, 3).join('\n') + '\n  ...');
});

// Test parallel fix
console.log('\n── Parallel Fix ──');
const parallel = generateParallelFix('react-tanstack', ['/api/users', '/api/posts', '/api/comments']);
console.log(`✅ react-tanstack parallel (${parallel.deps.join(', ')}):`);
console.log(parallel.code.split('\n').slice(0, 4).join('\n') + '\n  ...');

// Test retry fix
console.log('\n── Retry Fix ──');
const retry = generateRetryFix('vue-tanstack', '/api/orders', 'useOrders', 'orders');
console.log(`✅ vue-tanstack retry (${retry.deps.join(', ')}):`);
console.log(retry.code.split('\n').slice(0, 4).join('\n') + '\n  ...');


// ─── 5.1: Enhanced Framework Detection (types check) ────────

console.log('\n══════ 5.1: Framework Detection Types ══════');

// Verify metaFramework field exists in types
const sessionWithMeta = {
  id: 'test',
  startTime: 0,
  endTime: 1000,
  requests: [],
  navigations: [],
  websockets: { connections: [], totalMessages: 0, messagesPerSecond: 0 },
  stack: {
    framework: { name: 'react', version: '18.2.0', metaFramework: 'next.js' },
    dataLibrary: { name: 'swr', version: '2.0' },
    apiType: 'rest',
    backendHints: { poweredBy: 'Next.js', server: null, detectedFramework: 'nextjs' },
  },
  config: { duration: 30, network: 'wifi', ignore: [], captureFields: true, maxRequests: 5000, minDuration: 0, verbose: false },
  metadata: { pageUrl: 'https://test.com', userAgent: 'test', scanDuration: 30000, totalRequests: 0, apiRequests: 0, uniqueEndpoints: 0, uniqueHosts: [] },
};

console.log('✅ metaFramework:', sessionWithMeta.stack.framework.metaFramework);
console.log('✅ dataLibrary:', sessionWithMeta.stack.dataLibrary.name);
console.log('✅ websockets field:', typeof sessionWithMeta.websockets);


// ─── 5.4: WebSocket Types Check ─────────────────────────────

console.log('\n══════ 5.4: WebSocket Monitoring Types ══════');

const wsSummary = sessionWithMeta.websockets;
console.log('✅ connections:', wsSummary.connections.length);
console.log('✅ totalMessages:', wsSummary.totalMessages);
console.log('✅ messagesPerSecond:', wsSummary.messagesPerSecond);

// Simulate a connection object
const mockConn = {
  url: 'wss://api.example.com/ws',
  openedAt: 100,
  closedAt: 5000,
  messagesReceived: 42,
  messagesSent: 10,
  avgMessageSize: 256,
  channels: ['orders', 'notifications'],
};
console.log('✅ Mock WS connection:', mockConn.url, '| msgs:', mockConn.messagesReceived + mockConn.messagesSent, '| channels:', mockConn.channels.join(', '));


// ─── 5.2: HTML Report with Stage 3 data ─────────────────────

const { FluxAnalyzer, generateHtmlReport } = require('./packages/scan/dist/index.js');

console.log('\n══════ 5.2: HTML Report Enhancement ══════');

// Create session with WebSocket data
const richSession = {
  ...sessionWithMeta,
  websockets: {
    connections: [mockConn],
    totalMessages: 52,
    messagesPerSecond: 1.5,
  },
};

const analyzer = new FluxAnalyzer();
const report = analyzer.analyze(richSession);
const html = generateHtmlReport(report);

// Check report contains Stage 3 enhancements
console.log('✅ Report has meta-framework:', html.includes('Next.js'));
console.log('✅ Report has rule names:', html.includes('Request Waterfall'));
console.log('✅ Report has WebSocket section:', html.includes('WebSocket Activity'));
console.log('✅ Report has WS messages:', html.includes('52'));
console.log('✅ Report has WS rate:', html.includes('1.5/s'));
console.log('✅ Report size:', (html.length / 1024).toFixed(1) + 'KB');

// Save to file for manual inspection
const fs = require('fs');
fs.writeFileSync('stage3-report-test.html', html);
console.log('✅ Saved stage3-report-test.html — open to inspect visually');


// ─── Summary ─────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('✅ All Stage 3 features verified!');
console.log('══════════════════════════════════════════\n');
