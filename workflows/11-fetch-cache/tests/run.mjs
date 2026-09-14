// Offline test suite for workflow 11.
//
// The code under test is not copied here: every test pulls the jsCode straight out of
// workflow.json and runs it. A test that passed against a copy would prove nothing about
// the file that actually ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(join(here, '..', 'workflow.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function codeOf(name) {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('no node named ' + name);
  if (node.type !== 'n8n-nodes-base.code') throw new Error(name + ' is not a Code node');
  return node.parameters.jsCode;
}

// A Code node in "run once for all items" mode sees $input, $() and the globals n8n
// injects. Nothing else is provided, so nothing else may be relied on.
function run(nodeName, { input = [], nodes = {} } = {}) {
  const wrap = (arr) => ({
    all: () => arr.map((j) => ({ json: j })),
    first: () => ({ json: arr[0] }),
    last: () => ({ json: arr[arr.length - 1] }),
  });
  const $input = wrap(input);
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('test did not stub node "' + name + '"');
    return wrap(nodes[name]);
  };
  const fn = new AsyncFunction('$input', '$', 'crypto', 'TextEncoder', codeOf(nodeName));
  return fn($input, $, webcrypto, TextEncoder);
}

// The shipped file has SUPABASE_URL blank on purpose, so it cannot run against someone
// else's project by accident. The tests fill it in the same way a user would.
const SUPABASE = 'https://example.supabase.co';
function configured(nodeName) {
  return codeOf(nodeName).replace("const SUPABASE_URL = '';", `const SUPABASE_URL = '${SUPABASE}';`);
}
function runPrepare(json, opts = {}) {
  const wrap = (arr) => ({ all: () => arr.map((j) => ({ json: j })), first: () => ({ json: arr[0] }) });
  // noBuffer stands in for a host that has btoa but not Buffer. The node has to work on
  // both, so both are exercised.
  const fn = new AsyncFunction('$input', 'TextEncoder', 'Buffer', 'btoa', configured('Prepare batch'));
  const b = (s) => Buffer.from(s, 'binary').toString('base64');
  return fn(wrap([json]), TextEncoder, opts.noBuffer ? undefined : Buffer, b);
}

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    const r = fn();
    return Promise.resolve(r).then(
      () => { pass++; console.log('  ok   ' + name); },
      (e) => { failures.push([name, e.message]); console.log('  FAIL ' + name + ' -- ' + e.message); },
    );
  } catch (e) {
    failures.push([name, e.message]);
    console.log('  FAIL ' + name + ' -- ' + e.message);
    return Promise.resolve();
  }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || 'value') + ': got ' + a + ', wanted ' + b);
}
function ok(cond, what) { if (!cond) throw new Error(what); }
async function throws(fn, fragment) {
  try { await fn(); } catch (e) {
    if (!e.message.includes(fragment)) throw new Error('threw "' + e.message + '", wanted "' + fragment + '"');
    return;
  }
  throw new Error('did not throw, wanted "' + fragment + '"');
}


console.log('\nPrepare batch');
await check('rejects urls that is not an array', () => throws(() => runPrepare({ urls: 'http://a.com' }), 'must be an array'));
await check('rejects an empty list', () => throws(() => runPrepare({ urls: [] }), 'is empty'));
await check('rejects more than 200 urls', () => throws(
  () => runPrepare({ urls: Array.from({ length: 201 }, (_, i) => 'https://a.com/' + i) }), 'cap of 200'));
await check('rejects a non-http scheme', () => throws(() => runPrepare({ urls: ['ftp://a.com'] }), 'not an http url'));
await check('rejects an empty entry', () => throws(() => runPrepare({ urls: ['https://a.com', '  '] }), 'empty entry'));
await check('rejects a negative ttl', () => throws(() => runPrepare({ urls: ['https://a.com'], ttl_hours: -1 }), 'ttl_hours'));
await check('rejects a ttl that is not a number', () => throws(() => runPrepare({ urls: ['https://a.com'], ttl_hours: 'day' }), 'ttl_hours'));
await check('rejects a timeout under 1s', () => throws(() => runPrepare({ urls: ['https://a.com'], timeout_ms: 500 }), 'timeout_ms'));
await check('rejects a timeout over 120s', () => throws(() => runPrepare({ urls: ['https://a.com'], timeout_ms: 200000 }), 'timeout_ms'));
await check('accepts ttl 0, which means never serve from cache', async () => {
  const [o] = await runPrepare({ urls: ['https://a.com'], ttl_hours: 0 });
  eq(o.json.ttlHours, 0, 'ttlHours');
});
await check('the same url twice is fetched once', async () => {
  const [o] = await runPrepare({ urls: ['https://a.com/x', 'https://a.com/x', 'https://b.com'] });
  eq(o.json.requested, 3, 'requested');
  eq(o.json.unique, 2, 'unique');
});
await check('keys are url-safe and differ per url', async () => {
  const [o] = await runPrepare({ urls: ['https://a.com', 'https://b.com'] });
  for (const t of o.json.targets) ok(/^[A-Za-z0-9_-]+$/.test(t.urlHash), 'not url-safe: ' + t.urlHash);
  ok(o.json.targets[0].urlHash !== o.json.targets[1].urlHash, 'two urls produced the same key');
});
await check('the key is deterministic across runs', async () => {
  const a = (await runPrepare({ urls: ['https://a.com/x?q=1&r=2'] }))[0].json.targets[0].urlHash;
  const b = (await runPrepare({ urls: ['https://a.com/x?q=1&r=2'] }))[0].json.targets[0].urlHash;
  eq(a, b, 'key');
});
await check('the key round-trips back to the url', async () => {
  // Collision-free is the property that matters; decodability is how it is proven here.
  const [o] = await runPrepare({ urls: ['https://a.com/\u00e9\u00e8?q=a/b+c'] });
  const k = o.json.targets[0].urlHash.replace(/-/g, '+').replace(/_/g, '/');
  eq(Buffer.from(k, 'base64').toString('utf8'), 'https://a.com/\u00e9\u00e8?q=a/b+c', 'decoded url');
});
await check('the key needs no crypto, which this sandbox does not have', () => {
  // Probed against the live instance: crypto is undefined and require('crypto') is
  // refused. A key that depended on either would crash on the very first node.
  const code = codeOf('Prepare batch');
  ok(!/\bcrypto\b\s*\./.test(code), 'the code still calls into crypto');
  ok(!/require\(/.test(code), 'the code still calls require()');
});
await check('the key works with no Buffer either', async () => {
  const [o] = await runPrepare({ urls: ['https://a.com', 'https://b.com'] }, { noBuffer: true });
  const [a, b] = o.json.targets;
  ok(/^[A-Za-z0-9_-]+$/.test(a.urlHash), 'not url-safe: ' + a.urlHash);
  ok(a.urlHash !== b.urlHash, 'two urls produced the same key');
});
await check('the lookup sends keys in the body, not the url', async () => {
  const [o] = await runPrepare({ urls: ['https://a.com', 'https://b.com'] });
  eq(o.json.cacheKeys, o.json.targets.map((t) => t.urlHash), 'cacheKeys');
  ok(o.json.cacheUrl.endsWith('/rest/v1/rpc/page_cache_lookup'), 'cacheUrl: ' + o.json.cacheUrl);
  ok(!o.json.cacheUrl.includes('in.('), 'keys leaked into the query string');
});
await check('a full batch of 200 keeps the url short', async () => {
  // The whole reason the lookup is an RPC: 200 keys in a query string is tens of
  // kilobytes of url, which proxies truncate or reject.
  const urls = Array.from({ length: 200 }, (_, i) => 'https://example.com/some/fairly/long/path/' + i);
  const [o] = await runPrepare({ urls });
  eq(o.json.cacheKeys.length, 200, 'cacheKeys');
  ok(o.json.cacheUrl.length < 200, 'cacheUrl is ' + o.json.cacheUrl.length + ' characters');
});
await check('defaults are 24h ttl and 15s timeout', async () => {
  const [o] = await runPrepare({ urls: ['https://a.com'] });
  eq(o.json.ttlHours, 24, 'ttlHours');
  eq(o.json.timeoutMs, 15000, 'timeoutMs');
});
await check('the shipped file has no project url baked in', () => {
  ok(codeOf('Prepare batch').includes("const SUPABASE_URL = '';"), 'a supabase url was left in the file');
});
await check('refuses to run unconfigured', () => throws(
  async () => {
    const wrap = (a) => ({ all: () => a.map((j) => ({ json: j })), first: () => ({ json: a[0] }) });
    const fn = new AsyncFunction('$input', 'TextEncoder', 'Buffer', codeOf('Prepare batch'));
    return fn(wrap([{ urls: ['https://a.com'] }]), TextEncoder, Buffer);
  }, 'SUPABASE_URL is not configured'));

console.log('\nSplit cache hits');
const prep = async (json) => (await runPrepare(json))[0].json;
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();

await check('an empty cache still produces one item and every url pending', async () => {
  const state = await prep({ urls: ['https://a.com', 'https://b.com'] });
  // fullResponse means PostgREST's [] arrives as one item with an empty body.
  const [o] = await run('Split cache hits', { input: [{ body: [] }], nodes: { 'Prepare batch': [state] } });
  eq(o.json.pendingCount, 2, 'pendingCount');
  eq(o.json.hitCount, 0, 'hitCount');
  eq(o.json.hasPending, true, 'hasPending');
});
await check('a fresh row is served from cache', async () => {
  const state = await prep({ urls: ['https://a.com'], ttl_hours: 24 });
  const row = { url_hash: state.targets[0].urlHash, url: 'https://a.com', status: 200, content: 'hi', content_type: 'text/html', fetched_at: iso(1) };
  const [o] = await run('Split cache hits', { input: [{ body: [row] }], nodes: { 'Prepare batch': [state] } });
  eq(o.json.hitCount, 1, 'hitCount');
  eq(o.json.pendingCount, 0, 'pendingCount');
  eq(o.json.hits[0].from_cache, true, 'from_cache');
  eq(o.json.hits[0].content, 'hi', 'content');
});
await check('a row older than the ttl is refetched', async () => {
  const state = await prep({ urls: ['https://a.com'], ttl_hours: 6 });
  const row = { url_hash: state.targets[0].urlHash, url: 'https://a.com', status: 200, content: 'old', fetched_at: iso(7) };
  const [o] = await run('Split cache hits', { input: [{ body: [row] }], nodes: { 'Prepare batch': [state] } });
  eq(o.json.hitCount, 0, 'hitCount');
  eq(o.json.pendingCount, 1, 'pendingCount');
});
await check('ttl 0 ignores a row written one second ago', async () => {
  const state = await prep({ urls: ['https://a.com'], ttl_hours: 0 });
  const row = { url_hash: state.targets[0].urlHash, url: 'https://a.com', status: 200, content: 'fresh', fetched_at: iso(0) };
  const [o] = await run('Split cache hits', { input: [{ body: [row] }], nodes: { 'Prepare batch': [state] } });
  eq(o.json.hitCount, 0, 'ttl 0 served a cache hit');
  eq(o.json.pendingCount, 1, 'pendingCount');
});
await check('a cache row for some other url is not matched', async () => {
  const state = await prep({ urls: ['https://a.com'] });
  const row = { url_hash: 'f'.repeat(64), url: 'https://elsewhere.com', status: 200, content: 'x', fetched_at: iso(0) };
  const [o] = await run('Split cache hits', { input: [{ body: [row] }], nodes: { 'Prepare batch': [state] } });
  eq(o.json.pendingCount, 1, 'a foreign row was served as a hit');
});
await check('the accumulator starts empty and travels in the item', async () => {
  const state = await prep({ urls: ['https://a.com'] });
  const [o] = await run('Split cache hits', { input: [{ body: [] }], nodes: { 'Prepare batch': [state] } });
  eq(o.json.acc, { fetched: [], errors: [] }, 'acc');
});
await check('no node reads or writes workflow static data', () => {
  const bad = wf.nodes.filter((n) => (n.parameters.jsCode || '').includes('getWorkflowStaticData'));
  eq(bad.map((n) => n.name), [], 'nodes using static data');
});

console.log('\nFan out misses');
await check('one item per pending url, with the state each needs', async () => {
  const state = await prep({ urls: ['https://a.com', 'https://b.com'] });
  const [split] = await run('Split cache hits', { input: [{ body: [] }], nodes: { 'Prepare batch': [state] } });
  const out = await run('Fan out misses', { input: [split.json] });
  eq(out.length, 2, 'item count');
  for (const i of out) { eq(i.json.timeoutMs, 15000, 'timeoutMs'); ok(i.json.userAgent, 'no user agent'); }
});
await check('the accumulator rides on the first item only', async () => {
  const state = await prep({ urls: ['https://a.com', 'https://b.com'] });
  const [split] = await run('Split cache hits', { input: [{ body: [] }], nodes: { 'Prepare batch': [state] } });
  const out = await run('Fan out misses', { input: [split.json] });
  ok(out[0].json.carry, 'first item has no carry');
  eq(out[1].json.carry, undefined, 'carry was duplicated onto a later item');
});
await check('nothing pending fans out to nothing', async () => {
  const out = await run('Fan out misses', { input: [{ pending: [] }] });
  eq(out.length, 0, 'item count');
});

console.log('\nClassify responses');
// Builds the three inputs the classifier reads: the split state, the requests that were
// fanned out, and the responses that came back.
async function classify(responses, { attempt = 0, ttl = 24, acc = { fetched: [], errors: [] }, hits = [] } = {}) {
  const urls = responses.map((_, i) => 'https://site' + i + '.com');
  const state = await prep({ urls, ttl_hours: ttl });
  const [split] = await run('Split cache hits', { input: [{ body: [] }], nodes: { 'Prepare batch': [state] } });
  const requests = split.json.pending.map((p, i) => ({
    url: p.url, urlHash: p.urlHash, attempt,
    carry: i === 0 ? { acc, hits } : undefined,
  }));
  const [o] = await run('Classify responses', {
    input: responses,
    nodes: { 'Split cache hits': [split.json], 'Fan out misses': requests },
  });
  return o.json;
}
const res = (statusCode, body = 'body', headers = {}) => ({ statusCode, body, headers });

await check('a 200 is kept with its body and content type', async () => {
  const r = await classify([res(200, '<html>', { 'content-type': 'text/html' })]);
  eq(r.acc.fetched.length, 1, 'fetched');
  eq(r.acc.fetched[0].content, '<html>', 'content');
  eq(r.acc.fetched[0].content_type, 'text/html', 'content_type');
  eq(r.hasPending, false, 'hasPending');
});
await check('a 404 is a permanent error, never a retry', async () => {
  const r = await classify([res(404, 'nope')]);
  eq(r.pending.length, 0, 'a 404 was queued for retry');
  eq(r.acc.errors.length, 1, 'errors');
  eq(r.acc.errors[0].status, 404, 'status');
});
await check('a 500 is a permanent error, never a retry', async () => {
  const r = await classify([res(500, 'boom')]);
  eq(r.pending.length, 0, 'a 500 was queued for retry');
  eq(r.acc.errors[0].error, 'http 500', 'error');
});
for (const s of [429, 502, 503, 504]) {
  await check('a ' + s + ' is retried', async () => {
    const r = await classify([res(s)]);
    eq(r.pending.length, 1, 'pending');
    eq(r.pending[0].attempt, 1, 'attempt');
    eq(r.hasPending, true, 'hasPending');
  });
}
await check('a missing response is retried as a timeout', async () => {
  const r = await classify([{ error: 'ETIMEDOUT' }]);
  eq(r.pending.length, 1, 'pending');
  eq(r.pending[0].reason, 'no response', 'reason');
});
await check('a timeout on the last attempt becomes an error, not an endless loop', async () => {
  const r = await classify([{ error: 'ETIMEDOUT' }], { attempt: 2 });
  eq(r.pending.length, 0, 'still pending after the cap');
  eq(r.acc.errors[0].status, null, 'status');
});
await check('three attempts is the cap', async () => {
  const r = await classify([res(503)], { attempt: 2 });
  eq(r.pending.length, 0, 'a fourth attempt was queued');
  eq(r.acc.errors.length, 1, 'errors');
  ok(r.acc.errors[0].error.includes('after 3 attempts'), 'error text: ' + r.acc.errors[0].error);
});
await check('the pause ladder is 2, then 8, then 30 seconds', async () => {
  eq((await classify([res(503)], { attempt: 0 })).waitSeconds, 2, 'first pause');
  eq((await classify([res(503)], { attempt: 1 })).waitSeconds, 8, 'second pause');
});
await check('Retry-After wins when it asks for longer', async () => {
  const r = await classify([res(429, 'slow down', { 'retry-after': '45' })]);
  eq(r.waitSeconds, 45, 'waitSeconds');
});
await check('Retry-After does not shorten the ladder', async () => {
  const r = await classify([res(429, 'x', { 'retry-after': '1' })], { attempt: 1 });
  eq(r.waitSeconds, 8, 'waitSeconds');
});
await check('a garbage Retry-After is ignored, not treated as zero', async () => {
  const r = await classify([res(429, 'x', { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })]);
  eq(r.waitSeconds, 2, 'waitSeconds');
});
await check('one bad url does not take the good ones down with it', async () => {
  const r = await classify([res(200, 'good'), res(404, 'bad'), res(200, 'also good')]);
  eq(r.acc.fetched.length, 2, 'fetched');
  eq(r.acc.errors.length, 1, 'errors');
  eq(r.hasPending, false, 'hasPending');
});
await check('results from earlier attempts are carried forward, not lost', async () => {
  const earlier = { fetched: [{ url: 'https://old.com', urlHash: 'a'.repeat(64), status: 200, content: 'kept', content_type: null }], errors: [] };
  const r = await classify([res(200, 'new')], { acc: earlier });
  eq(r.acc.fetched.length, 2, 'fetched');
  eq(r.acc.fetched[0].content, 'kept', 'the earlier result was dropped');
});
await check('cache hits survive the retry loop', async () => {
  const r = await classify([res(503)], { hits: [{ url: 'https://cached.com', status: 200, from_cache: true, content: 'c' }] });
  eq(r.hits.length, 1, 'hits');
});
await check('a body that is not a string is stringified, not dropped', async () => {
  const r = await classify([res(200, { a: 1 }, { 'content-type': 'application/json' })]);
  eq(r.acc.fetched[0].content, '{"a":1}', 'content');
});
await check('content is truncated to the cap', async () => {
  const r = await classify([res(200, 'x'.repeat(300000))]);
  eq(r.acc.fetched[0].content.length, 200000, 'content length');
});

console.log('\nBuild result');
const built = async (state) => (await run('Build result', { input: [state] }))[0].json;
const baseState = {
  requested: 3, unique: 3, ratePerSecond: 3, storeUrl: 'https://example.supabase.co/rest/v1/page_cache',
};
await check('cache hits and fresh fetches land in one list', async () => {
  const r = await built({
    ...baseState,
    hits: [{ url: 'https://a.com', status: 200, from_cache: true, content: 'a' }],
    acc: { fetched: [{ url: 'https://b.com', urlHash: 'b'.repeat(64), status: 200, content: 'b', content_type: 'text/html' }], errors: [] },
  });
  eq(r.results.length, 2, 'results');
  eq(r.results.map((x) => x.from_cache), [true, false], 'from_cache flags');
});
await check('only fetched rows are written to the cache', async () => {
  const r = await built({
    ...baseState,
    hits: [{ url: 'https://a.com', status: 200, from_cache: true, content: 'a' }],
    acc: { fetched: [{ url: 'https://b.com', urlHash: 'b'.repeat(64), status: 200, content: 'b', content_type: null }], errors: [] },
  });
  eq(r.rows.length, 1, 'a cache hit was written back to the cache');
  eq(r.rows[0].url, 'https://b.com', 'url');
});
await check('a failure is never cached', async () => {
  const r = await built({
    ...baseState, hits: [],
    acc: { fetched: [], errors: [{ url: 'https://a.com', status: 404, error: 'http 404' }] },
  });
  eq(r.rows.length, 0, 'a failure was cached');
  eq(r.hasRows, false, 'hasRows');
  eq(r.errors.length, 1, 'errors');
});
await check('stats add up', async () => {
  const r = await built({
    ...baseState,
    hits: [{ url: 'https://a.com', status: 200, from_cache: true, content: 'a' }],
    acc: {
      fetched: [{ url: 'https://b.com', urlHash: 'b'.repeat(64), status: 200, content: 'b', content_type: null }],
      errors: [{ url: 'https://c.com', status: 404, error: 'http 404' }],
    },
  });
  eq(r.stats, { requested: 3, unique: 3, from_cache: 1, fetched: 1, failed: 1, rate_per_second: 3 }, 'stats');
  eq(r.stats.from_cache + r.stats.fetched + r.stats.failed, r.stats.unique, 'stats do not account for every url');
});
await check('every cache row carries a fresh timestamp', async () => {
  const r = await built({
    ...baseState, hits: [],
    acc: { fetched: [{ url: 'https://b.com', urlHash: 'b'.repeat(64), status: 200, content: 'b', content_type: null }], errors: [] },
  });
  const age = Date.now() - Date.parse(r.rows[0].fetched_at);
  ok(age >= 0 && age < 5000, 'fetched_at is not now: ' + r.rows[0].fetched_at);
});

console.log('\nWorkflow file');
await check('the declared pace matches the fetch node batching', () => {
  const prepared = codeOf('Prepare batch');
  const rate = Number(/RATE_PER_SECOND = (\d+)/.exec(prepared)[1]);
  const batch = wf.nodes.find((n) => n.name === 'Fetch pages').parameters.options.batching.batch;
  eq(batch.batchSize, rate, 'batchSize does not match RATE_PER_SECOND');
  eq(batch.batchInterval, 1000, 'batchInterval');
});
await check('the fetch node never throws on a status code', () => {
  const o = wf.nodes.find((n) => n.name === 'Fetch pages').parameters.options.response.response;
  eq(o.neverError, true, 'neverError');
  eq(o.fullResponse, true, 'fullResponse');
});
await check('a network error keeps the batch alive', () => {
  eq(wf.nodes.find((n) => n.name === 'Fetch pages').onError, 'continueRegularOutput', 'onError');
});
await check('the cache read posts its keys in the body', () => {
  const n = wf.nodes.find((x) => x.name === 'Read cache');
  eq(n.parameters.method, 'POST', 'method');
  ok(n.parameters.jsonBody.includes('cacheKeys'), 'body does not carry the keys');
  // The url itself is built in "Prepare batch"; the node just takes it.
  eq(n.parameters.url, '={{ $json.cacheUrl }}', 'url');
  ok(codeOf('Prepare batch').includes('/rest/v1/rpc/page_cache_lookup'), 'no rpc url in the code');
});
await check('the rpc the workflow calls is the one schema.sql creates', () => {
  const sql = readFileSync(join(here, '..', 'schema.sql'), 'utf8');
  ok(/create or replace function page_cache_lookup\(keys text\[\]\)/.test(sql), 'no matching function in schema.sql');
});
await check('the cache read always emits an item', () => {
  const o = wf.nodes.find((n) => n.name === 'Read cache').parameters.options;
  eq(o.response.response.fullResponse, true, 'fullResponse on Read cache');
});
await check('the cache write merges instead of duplicating', () => {
  const h = wf.nodes.find((n) => n.name === 'Write cache').parameters.headerParameters.parameters;
  ok(h.some((p) => p.name === 'Prefer' && p.value.includes('merge-duplicates')), 'no merge-duplicates header');
});
await check('every wait node is a plain number, not an expression', () => {
  for (const n of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.wait')) {
    ok(typeof n.parameters.amount === 'number', n.name + ' uses ' + typeof n.parameters.amount);
  }
});
await check('the three pauses match the ladder in the classifier', () => {
  const amounts = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.wait').map((n) => n.parameters.amount).sort((a, b) => a - b);
  eq(amounts, [2, 8, 30], 'wait amounts');
});
await check('every wait node leads back into the loop', () => {
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.wait')) {
    eq(wf.connections[n.name].main[0][0].node, 'Fan out misses', n.name + ' does not loop back');
  }
});
await check('the switch has an output for every wait node', () => {
  const sw = wf.nodes.find((n) => n.name === 'Which pause?');
  eq(sw.parameters.rules.values.length + 1, 3, 'switch outputs');
  eq(wf.connections['Which pause?'].main.length, 3, 'switch connections');
});
await check('the workflow ships inactive', () => eq(wf.active, false, 'active'));
await check('no credentials are bundled', () => {
  const withCreds = wf.nodes.filter((n) => n.credentials).map((n) => n.name);
  eq(withCreds, [], 'nodes carrying credentials');
});
await check('nothing in the file is written in anything but English', () => {
  // Escaped rather than written literally, so this file does not itself trip the scan.
  const cyrillic = JSON.stringify(wf).match(/[\u0400-\u04FF]/g);
  eq(cyrillic, null, 'cyrillic characters found');
});
await check('every node is reachable from the trigger', () => {
  const seen = new Set(['When called by another workflow']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, conn] of Object.entries(wf.connections)) {
      if (!seen.has(from)) continue;
      for (const branch of conn.main) for (const c of branch || []) if (!seen.has(c.node)) { seen.add(c.node); grew = true; }
    }
  }
  eq(wf.nodes.filter((n) => !seen.has(n.name)).map((n) => n.name), [], 'orphan nodes');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
