// Offline test suite for workflow 14. Code is read out of workflow.json, never copied.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DateTime } from 'luxon';

const here = dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(join(here, '..', 'workflow.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const nodeOf = (name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error('no node named ' + name);
  return n;
};
const codeOf = (name) => nodeOf(name).parameters.jsCode;
const configured = (name) => codeOf(name)
  .replace("const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://example.supabase.co';")
  .replace("const ALERT_CHAT_ID = '';", "const ALERT_CHAT_ID = '-1001234567890';");

const wrap = (arr) => ({ all: () => arr.map((j) => ({ json: j })), first: () => ({ json: arr[0] }) });
function run(name, { input = [{}], nodes = {}, raw = false } = {}) {
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('Referenced node is unexecuted: ' + n);
    return wrap(nodes[n]);
  };
  return new AsyncFunction('$input', '$', 'DateTime', raw ? codeOf(name) : configured(name))(wrap(input), $, DateTime);
}

let pass = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { failures.push(name); console.log('  FAIL ' + name + ' -- ' + e.message); }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((what || 'value') + ': got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b));
};
const ok = (c, what) => { if (!c) throw new Error(what); };
async function throws(fn, frag) {
  try { await fn(); } catch (e) { if (!e.message.includes(frag)) throw new Error('threw "' + e.message + '"'); return; }
  throw new Error('did not throw');
}

const prepared = async () => (await run('Prepare'))[0].json;

// A week of executions built so every metric is known in advance.
function at(state, hoursAfterSince) {
  return new Date(Date.parse(state.since) + hoursAfterSince * 3600e3).toISOString();
}
function exec(state, workflowId, h, durMs, status = 'success') {
  const start = at(state, h);
  return { id: Math.random().toString(36).slice(2), workflowId, status, finished: status === 'success',
           startedAt: start, stoppedAt: new Date(Date.parse(start) + durMs).toISOString() };
}
async function aggregate({ workflows, execs, pages, snapshot = null, snapshotMissing = false }) {
  const state = await prepared();
  const list = typeof workflows === 'function' ? workflows(state) : workflows;
  const ex = typeof execs === 'function' ? execs(state) : execs;
  const nodes = {
    Prepare: [state],
    'List workflows': [{ data: list }],
    'Read executions': pages || [{ data: ex }],
  };
  if (!snapshotMissing) nodes['Read last snapshot'] = [{ body: snapshot ? [snapshot] : [], statusCode: 200 }];
  const [o] = await run('Aggregate', { nodes });
  return o.json;
}
const W = (id, name, active = true) => ({ id, name, active });
const row = (r, id) => r.rows.find((x) => x.id === id);

// 200 executions: A has 100 runs (20 errors), B has 80 runs, C has 20 runs (10 errors).
function fixture200(state) {
  const out = [];
  for (let i = 0; i < 100; i++) out.push(exec(state, 'A', 1 + i, 1000 + i * 10, i < 20 ? 'error' : 'success'));
  for (let i = 0; i < 80; i++) out.push(exec(state, 'B', 2 + i, 500, 'success'));
  for (let i = 0; i < 20; i++) out.push(exec(state, 'C', 3 + i, 3000 + i * 100, i % 2 ? 'crashed' : 'success'));
  return out;
}
const fixtureWfs = [W('A', 'Alpha'), W('B', 'Beta'), W('C', 'Gamma'), W('D', 'Delta (silent)'), W('E', 'Epsilon', false)];

console.log('\nPrepare');
await check('refuses to run without a project url', () => throws(() => run('Prepare', { raw: true }), 'SUPABASE_URL'));
await check('the shipped file carries no url and no chat id', () => {
  ok(codeOf('Prepare').includes("const SUPABASE_URL = '';"), 'url baked in');
  ok(codeOf('Prepare').includes("const ALERT_CHAT_ID = '';"), 'chat id baked in');
});
await check('the window is exactly seven days', async () => {
  const s = await prepared();
  eq((Date.parse(s.until) - Date.parse(s.since)) / 86400e3, 7, 'days');
});
await check('the snapshot key is a monday', async () => {
  eq(DateTime.fromISO((await prepared()).weekStart).weekday, 1, 'weekday');
});
await check('last week is read strictly before this week', async () => {
  const s = await prepared();
  ok(s.prevSnapshotUrl.includes('week_start=lt.' + s.weekStart), s.prevSnapshotUrl);
  ok(s.prevSnapshotUrl.includes('order=week_start.desc') && s.prevSnapshotUrl.includes('limit=1'), s.prevSnapshotUrl);
});
await check('executions are listed without their data', async () => {
  ok((await prepared()).executionsUrl.includes('includeData=false'), 'includeData');
});

console.log('\nAggregate, the 200-execution fixture');
const f = await aggregate({ workflows: fixtureWfs, execs: fixture200 });
await check('all 200 executions are counted', () => eq(f.totals.runs, 200, 'runs'));
await check('errors include crashed runs', () => eq(f.totals.errors, 30, 'errors'));
await check('error rate per workflow', () => {
  eq([row(f, 'A').errorRate, row(f, 'B').errorRate, row(f, 'C').errorRate], [0.2, 0, 0.5], 'rates');
});
await check('median of an even count averages the middle pair', () => {
  // A: 1000..1990 in steps of 10, 100 values -> (1490 + 1500) / 2
  eq(row(f, 'A').p50Ms, 1495, 'p50 A');
});
await check('median of a constant series is that constant', () => eq(row(f, 'B').p50Ms, 500, 'p50 B'));
await check('worst duration is the maximum', () => {
  eq([row(f, 'A').maxMs, row(f, 'C').maxMs], [1990, 4900], 'max');
});
await check('exactly twenty percent is not flagged, only above it', () => {
  ok(!row(f, 'A').flags.includes('error_rate'), 'A flagged at exactly 20%');
  ok(row(f, 'C').flags.includes('error_rate'), 'C not flagged at 50%');
});
await check('an active workflow that never ran is in the report', () => {
  const d = row(f, 'D');
  ok(d, 'the silent workflow has no row');
  eq(d.runs, 0, 'runs');
  ok(d.flags.includes('never_ran_this_week'), 'not flagged');
});
await check('an inactive workflow is counted, not flagged', () => {
  eq(row(f, 'E'), undefined, 'inactive workflow got a row');
  eq(f.totals.inactiveWorkflows, 1, 'inactive count');
});
await check('the last success is the latest successful stop', async () => {
  const r = await aggregate({ workflows: [W('X', 'X')], execs: (s) => [
    exec(s, 'X', 1, 100), exec(s, 'X', 50, 100), exec(s, 'X', 60, 100, 'error')] });
  // The window comes from the same run, not a fresh clock read, or the test drifts by a millisecond.
  eq(row(r, 'X').lastSuccessAt, new Date(Date.parse(at(r, 50)) + 100).toISOString(), 'lastSuccessAt');
});
await check('flagged rows come first', () => {
  eq(f.rows.slice(0, 2).map((r) => r.id).sort(), ['C', 'D'], 'first rows');
});

console.log('\nAggregate, edges');
await check('executions outside the window are ignored', async () => {
  const r = await aggregate({ workflows: [W('X', 'X')], execs: (s) => [exec(s, 'X', -5, 100), exec(s, 'X', 200, 100), exec(s, 'X', 10, 100)] });
  eq(row(r, 'X').runs, 1, 'runs');
});
await check('pages are merged', async () => {
  const s = await prepared();
  const r = await aggregate({ workflows: [W('X', 'X')], pages: [
    { data: [exec(s, 'X', 1, 100)], nextCursor: 'c1' }, { data: [exec(s, 'X', 2, 100), exec(s, 'X', 3, 100)] }] });
  eq(row(r, 'X').runs, 3, 'runs');
});
await check('a running execution counts as a run but not a duration', async () => {
  const r = await aggregate({ workflows: [W('X', 'X')], execs: (s) => [
    { workflowId: 'X', status: 'running', startedAt: at(s, 1), stoppedAt: null }, exec(s, 'X', 2, 300)] });
  eq([row(r, 'X').runs, row(r, 'X').p50Ms], [2, 300], 'runs and p50');
});
await check('an execution with no status is read from finished', async () => {
  const r = await aggregate({ workflows: [W('X', 'X')], execs: (s) => [
    { workflowId: 'X', finished: false, startedAt: at(s, 1), stoppedAt: at(s, 1.1) }] });
  eq(row(r, 'X').errors, 1, 'errors');
});
await check('a deleted workflow still gets a named row', async () => {
  const r = await aggregate({ workflows: [], execs: (s) => [exec(s, 'gone', 1, 100)] });
  eq(row(r, 'gone').name, '(deleted workflow gone)', 'name');
});
await check('a canceled run is not an error', async () => {
  const r = await aggregate({ workflows: [W('X', 'X')], execs: (s) => [exec(s, 'X', 1, 100, 'canceled')] });
  eq([row(r, 'X').errors, row(r, 'X').canceled], [0, 1], 'errors, canceled');
});
await check('hitting the page cap inside the week says partial', async () => {
  const s = await prepared();
  const pages = Array.from({ length: 40 }, (_, i) => ({ data: [exec(s, 'X', 100 + i, 10)], nextCursor: 'c' + i }));
  eq((await aggregate({ workflows: [W('X', 'X')], pages })).truncated.executions, true, 'truncated');
});
await check('reaching the start of the week is not partial', async () => {
  eq(f.truncated.executions, false, 'truncated');
});
await check('a paginated workflow list says partial', async () => {
  const state = await prepared();
  const [o] = await run('Aggregate', { nodes: { Prepare: [state], 'List workflows': [{ data: [], nextCursor: 'x' }],
    'Read executions': [{ data: [] }], 'Read last snapshot': [{ body: [] }] } });
  eq(o.json.truncated.workflows, true, 'truncated');
});

console.log('\nAggregate, week on week');
const snap = (stats) => ({ week_start: '2026-01-05', stats });
await check('no snapshot at all does not fail', async () => {
  const r = await aggregate({ workflows: fixtureWfs, execs: fixture200, snapshot: null });
  eq(r.prevWeek, null, 'prevWeek');
  ok(r.rows.every((x) => !x.flags.includes('slowdown')), 'slowdown flagged without a baseline');
});
await check('a snapshot read that never happened does not fail either', async () => {
  const r = await aggregate({ workflows: fixtureWfs, execs: fixture200, snapshotMissing: true });
  eq(r.prevWeek, null, 'prevWeek');
});
await check('a doubled median over a second is a slowdown', async () => {
  const r = await aggregate({ workflows: fixtureWfs, execs: fixture200, snapshot: snap({ C: { p50Ms: 1000 } }) });
  ok(row(r, 'C').flags.includes('slowdown'), 'C p50 ~3950 vs 1000 not flagged');
  eq(r.prevWeek, '2026-01-05', 'prevWeek');
});
await check('a doubled median of a few milliseconds is noise, not a slowdown', async () => {
  const r = await aggregate({ workflows: fixtureWfs, execs: fixture200, snapshot: snap({ B: { p50Ms: 200 } }) });
  ok(!row(r, 'B').flags.includes('slowdown'), '200ms to 500ms flagged');
});
await check('a slower but not doubled median is not a slowdown', async () => {
  const r = await aggregate({ workflows: fixtureWfs, execs: fixture200, snapshot: snap({ A: { p50Ms: 1000 } }) });
  ok(!row(r, 'A').flags.includes('slowdown'), '1000 to 1495 flagged');
});
await check('last success carries over from last week when none this week', async () => {
  const r = await aggregate({ workflows: fixtureWfs, execs: fixture200,
    snapshot: snap({ D: { p50Ms: 100, lastSuccessAt: '2026-01-07T10:00:00.000Z' } }) });
  eq(row(r, 'D').lastSuccessAt, '2026-01-07T10:00:00.000Z', 'lastSuccessAt');
});
await check('the snapshot row carries every workflow and the totals', () => {
  eq(Object.keys(f.snapshot.stats).sort(), ['A', 'B', 'C', 'D'], 'stats keys');
  eq(f.snapshot.totals.runs, 200, 'totals');
  ok(f.snapshot.taken_at, 'no taken_at');
});

console.log('\nAggregate, the summary request');
await check('only flagged workflows reach the model', () => {
  const sent = JSON.parse(f.llmRequest.user).flagged.map((x) => x.workflow).sort();
  eq(sent, ['Delta (silent)', 'Gamma'], 'sent');
});
await check('the schema is the one the spec asked for', () => {
  eq(f.llmRequest.schema.required, ['summary_ru', 'top_issues'], 'required');
  eq(f.llmRequest.schema.properties.top_issues.items.required, ['workflow', 'issue', 'suggested_check'], 'issue fields');
});
await check('the prompt names the report language', () => ok(f.llmRequest.system.includes('Russian'), 'language'));
await check('a clean week asks the model nothing', async () => {
  const r = await aggregate({ workflows: [W('B', 'Beta')], execs: (s) => [exec(s, 'B', 1, 100)] });
  eq(r.hasFlags, false, 'hasFlags');
});

console.log('\nBuild report');
async function report(agg, llm) {
  const nodes = { Aggregate: [agg] };
  if (llm !== undefined) nodes['Ask for a summary'] = [llm];
  return (await run('Build report', { nodes }))[0].json;
}
const goodLlm = { ok: true, data: { summary_ru: 'Two workflows need attention.', top_issues: [
  { workflow: 'Gamma', issue: 'half the runs fail', suggested_check: 'check the upstream api' },
  { workflow: 'Beta', issue: 'invented', suggested_check: 'invented' }] } };
await check('the report names every flagged workflow', async () => {
  const r = await report(f, goodLlm);
  ok(r.message.includes('Gamma') && r.message.includes('Delta (silent)'), r.message);
  ok(r.message.includes('did not run'), 'never-ran wording missing');
});
await check('an issue about a healthy workflow is dropped', async () => {
  const r = await report(f, goodLlm);
  eq(r.droppedIssues, 1, 'dropped');
  ok(!r.message.includes('invented'), 'the invented issue reached the message');
});
await check('the model summary is used when it came back', async () => {
  const r = await report(f, goodLlm);
  eq(r.summaryUsed, true, 'summaryUsed');
});
await check('a failed summary leaves the numbers intact', async () => {
  const r = await report(f, { ok: false, errors: ['overloaded'] });
  eq([r.summaryUsed, r.summaryFailed], [false, true], 'flags');
  ok(r.message.includes('Summary unavailable') && r.message.includes('Gamma'), r.message);
});
await check('a summary call that errored out entirely does not break the report', async () => {
  const r = await report(f, undefined);
  eq(r.summaryFailed, true, 'summaryFailed');
});
await check('a clean week says so and never looks for a summary', async () => {
  const agg = await aggregate({ workflows: [W('B', 'Beta')], execs: (s) => [exec(s, 'B', 1, 100)] });
  const r = await report(agg, undefined);
  ok(r.message.includes('Nothing flagged'), r.message);
  eq(r.summaryFailed, false, 'summaryFailed');
});
await check('the first week says there is nothing to compare with', async () => {
  ok((await report(f, goodLlm)).message.includes('No earlier snapshot'), 'missing');
});
await check('a partial week is said out loud', async () => {
  const r = await report({ ...f, truncated: { executions: true, workflows: false } }, goodLlm);
  ok(r.message.includes('Partial'), r.message);
});
await check('a hundred flagged workflows still fit one telegram message', async () => {
  const wfs = Array.from({ length: 100 }, (_, i) => W('w' + i, 'A workflow with a fairly long descriptive name number ' + i));
  const agg = await aggregate({ workflows: wfs, execs: [] });
  const r = await report(agg, { ok: true, data: { summary_ru: 'x'.repeat(2000), top_issues: [] } });
  ok(r.messageLength <= 4096, 'message is ' + r.messageLength + ' characters');
  ok(r.omitted > 0 && r.message.includes('more lines'), 'nothing says lines were left out');
});
await check('the summary is capped so it cannot crowd out the numbers', async () => {
  const r = await report(f, { ok: true, data: { summary_ru: 'y'.repeat(3000), top_issues: [] } });
  ok(!r.message.includes('y'.repeat(701)), 'summary not capped');
  ok(r.message.includes('Gamma'), 'flag lines crowded out');
});
await check('the snapshot is passed through for saving', async () => {
  const r = await report(f, goodLlm);
  eq(r.snapshot.week_start, f.weekStart, 'week_start');
});

console.log('\nWorkflow file');
await check('it runs on sunday at 20:00', () => {
  const r = nodeOf('Every Sunday at 20:00').parameters.rule.interval[0];
  eq([r.field, r.triggerAtDay, r.triggerAtHour], ['weeks', [0], 20], 'schedule');
});
await check('the snapshot read runs once however many pages came before it', () => {
  eq(nodeOf('Read last snapshot').executeOnce, true, 'executeOnce');
  eq(nodeOf('Read executions').executeOnce, true, 'executeOnce');
});
await check('executions are paginated with a cap', () => {
  const p = nodeOf('Read executions').parameters.options.pagination.pagination;
  eq([p.limitPagesFetched, p.maxRequests], [true, 40], 'cap');
  ok(p.completeExpression.includes('since'), 'pagination does not stop at the start of the week');
});
await check('the page cap matches what the code believes it is', async () => {
  eq((await prepared()).maxPages, nodeOf('Read executions').parameters.options.pagination.pagination.maxRequests, 'maxPages');
});
await check('a failed summary call cannot stop the report', () => {
  eq(nodeOf('Ask for a summary').onError, 'continueRegularOutput', 'onError');
});
await check('the summary goes through workflow 03', () => {
  ok(nodeOf('Ask for a summary').parameters.workflowId.cachedResultName.startsWith('[03]'), 'not 03');
});
await check('the snapshot is saved before the message is sent', () => {
  eq(wf.connections['Build report'].main[0][0].node, 'Save snapshot', 'order');
  eq(wf.connections['Save snapshot'].main[0][0].node, 'Send report', 'order');
});
await check('a re-run replaces the week instead of adding to it', () => {
  const h = nodeOf('Save snapshot').parameters.headerParameters.parameters;
  ok(h.some((x) => x.value.includes('merge-duplicates')), 'no upsert');
});
await check('nothing is disabled or changed on the instance', () => {
  const writes = wf.nodes.filter((n) => n.parameters.nodeCredentialType === 'n8nApi' && n.parameters.method && n.parameters.method !== 'GET');
  eq(writes.map((n) => n.name), [], 'n8n write nodes');
  ok(!/\/(activate|deactivate)/.test(JSON.stringify(wf)), 'an activate/deactivate call exists');
});
await check('ships inactive, no credentials, English only', () => {
  eq(wf.active, false, 'active');
  eq(wf.nodes.filter((n) => n.credentials).length, 0, 'credentials');
  eq(JSON.stringify(wf).match(/[\u0400-\u04FF]/g), null, 'cyrillic');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
