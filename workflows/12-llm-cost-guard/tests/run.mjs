// Offline test suite for workflow 12.
//
// Every test pulls the jsCode out of the workflow files and runs it. Nothing is copied
// here, so a green run is a statement about the files that ship and not about a snapshot
// of them taken at writing time.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DateTime } from 'luxon';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const guard = JSON.parse(readFileSync(join(root, 'workflow-guard.json'), 'utf8'));
const report = JSON.parse(readFileSync(join(root, 'workflow-report.json'), 'utf8'));
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const SUPABASE = 'https://example.supabase.co';
const CHAT = '-1001234567890';

function nodeOf(wf, name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error('no node named ' + name);
  return n;
}
function codeOf(wf, name) {
  const n = nodeOf(wf, name);
  if (n.type !== 'n8n-nodes-base.code') throw new Error(name + ' is not a Code node');
  return n.parameters.jsCode;
}
// The shipped files leave both placeholders blank on purpose. Tests fill them the way a
// user would, and a separate test asserts they are still blank in the file.
function configured(wf, name) {
  return codeOf(wf, name)
    .replace("const SUPABASE_URL = '';", `const SUPABASE_URL = '${SUPABASE}';`)
    .replace("const ALERT_CHAT_ID = '';", `const ALERT_CHAT_ID = '${CHAT}';`);
}

const wrap = (arr) => ({
  all: () => arr.map((j) => ({ json: j })),
  first: () => ({ json: arr[0] }),
  last: () => ({ json: arr[arr.length - 1] }),
});

// A Code node sees $input, $(), and the globals n8n injects - DateTime from luxon among
// them, confirmed by probing the live instance. Nothing else is available, so nothing else
// is provided here.
function run(wf, nodeName, { input = [], nodes = {}, raw = false } = {}) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('test did not stub node "' + name + '"');
    return wrap(nodes[name]);
  };
  const src = raw ? codeOf(wf, nodeName) : configured(wf, nodeName);
  const fn = new AsyncFunction('$input', '$', 'DateTime', src);
  return fn(wrap(input), $, DateTime);
}

let pass = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push([name, e.message]);
    console.log('  FAIL ' + name + ' -- ' + e.message);
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

const prepare = (json) => run(guard, 'Prepare', { input: [json] });
const prepared = async (json) => (await prepare(json))[0].json;
const httpBody = (rows) => [{ body: rows, statusCode: 200, headers: {} }];

console.log('\nPrepare, mode and configuration');
await check('refuses to run with no project url', () => throws(
  () => run(guard, 'Prepare', { input: [{ mode: 'check', estimated_cost_usd: 1 }], raw: true }),
  'SUPABASE_URL is not configured'));
await check('refuses to run with no alert chat', () => throws(async () => {
  const src = codeOf(guard, 'Prepare').replace("const SUPABASE_URL = '';", `const SUPABASE_URL = '${SUPABASE}';`);
  const fn = new AsyncFunction('$input', '$', 'DateTime', src);
  return fn(wrap([{ mode: 'check', estimated_cost_usd: 1 }]), () => {}, DateTime);
}, 'ALERT_CHAT_ID is not configured'));
await check('the shipped files carry no project url and no chat id', () => {
  for (const [wf, node] of [[guard, 'Prepare'], [report, 'Prepare window']]) {
    const src = codeOf(wf, node);
    ok(src.includes("const SUPABASE_URL = '';"), node + ' has a project url baked in');
    ok(src.includes("const ALERT_CHAT_ID = '';"), node + ' has a chat id baked in');
  }
});
await check('usage alone means log', async () => {
  const s = await prepared({ workflow_name: 'w', model: 'm', usage: { input_tokens: 1, output_tokens: 2 } });
  eq(s.mode, 'log', 'mode');
});
await check('an estimate alone means check', async () => {
  eq((await prepared({ estimated_cost_usd: 0.5 })).mode, 'check', 'mode');
});
await check('both at once is refused rather than guessed', () => throws(
  () => prepare({ workflow_name: 'w', model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, estimated_cost_usd: 1 }),
  'ambiguous request'));
await check('neither is refused', () => throws(() => prepare({ workflow_name: 'w' }), 'send either usage'));
await check('an explicit mode wins over the shape', async () => {
  const s = await prepared({ mode: 'check', estimated_cost_usd: 0 });
  eq(s.mode, 'check', 'mode');
});
await check('an unknown mode is refused', () => throws(
  () => prepare({ mode: 'delete', estimated_cost_usd: 1 }), 'mode must be'));

console.log('\nPrepare, logging');
const goodLog = { mode: 'log', workflow_name: '[05] digest', model: 'claude-haiku-4-5', usage: { input_tokens: 1200, output_tokens: 300 }, purpose: 'summarise' };
await check('a valid log call is accepted', async () => {
  const s = await prepared(goodLog);
  eq(s.workflowName, '[05] digest', 'workflowName');
  eq(s.inputTokens, 1200, 'inputTokens');
  eq(s.outputTokens, 300, 'outputTokens');
  eq(s.purpose, 'summarise', 'purpose');
});
await check('workflow_name is required', () => throws(
  () => prepare({ ...goodLog, workflow_name: '  ' }), 'workflow_name is required'));
await check('model is required', () => throws(() => prepare({ ...goodLog, model: '' }), 'model is required'));
for (const [label, bad] of [['a negative count', -1], ['a fraction', 1.5], ['text', 'lots'],
                            ['nothing at all', undefined], ['an absurd count', 99999999999]]) {
  await check('rejects ' + label + ' for input_tokens', () => throws(
    () => prepare({ ...goodLog, usage: { input_tokens: bad, output_tokens: 1 } }), 'input_tokens must be'));
}
await check('rejects a bad output_tokens too', () => throws(
  () => prepare({ ...goodLog, usage: { input_tokens: 1, output_tokens: -5 } }), 'output_tokens must be'));
await check('zero tokens is a real call, not an error', async () => {
  const s = await prepared({ ...goodLog, usage: { input_tokens: 0, output_tokens: 0 } });
  eq([s.inputTokens, s.outputTokens], [0, 0], 'tokens');
});
await check('a missing purpose becomes null, not the string undefined', async () => {
  const { purpose, ...noPurpose } = goodLog;
  eq((await prepared(noPurpose)).purpose, null, 'purpose');
});
await check('an overlong purpose is cut rather than rejected', async () => {
  const s = await prepared({ ...goodLog, purpose: 'x'.repeat(900) });
  eq(s.purpose.length, 500, 'purpose length');
});
await check('a model with awkward characters is escaped in the price url', async () => {
  const s = await prepared({ ...goodLog, model: 'vendor/model v1+beta' });
  ok(!/ /.test(s.priceUrl), 'unescaped space in ' + s.priceUrl);
  ok(s.priceUrl.includes(encodeURIComponent('vendor/model v1+beta')), 'url: ' + s.priceUrl);
});

console.log('\nPrepare, the gate');
await check('a valid check call is accepted', async () => {
  eq((await prepared({ mode: 'check', estimated_cost_usd: 0.25 })).estimated, 0.25, 'estimated');
});
await check('a negative estimate is refused', () => throws(
  () => prepare({ mode: 'check', estimated_cost_usd: -1 }), 'estimated_cost_usd must be'));
await check('a non-numeric estimate is refused', () => throws(
  () => prepare({ mode: 'check', estimated_cost_usd: 'a lot' }), 'estimated_cost_usd must be'));
await check('an estimate of zero is allowed', async () => {
  eq((await prepared({ mode: 'check', estimated_cost_usd: 0 })).estimated, 0, 'estimated');
});
await check('the day starts at local midnight, not utc midnight', async () => {
  const s = await prepared({ mode: 'check', estimated_cost_usd: 0 });
  const d = DateTime.fromISO(s.dayStart, { setZone: true });
  eq([d.hour, d.minute, d.second], [0, 0, 0], 'local time of dayStart');
  // toISO() writes an offset, not the zone name, so the round-trip is checked against the
  // offset the named zone actually had at that instant.
  eq(d.offset, DateTime.fromISO(s.dayStart).setZone(s.timezone).offset, 'utc offset');
  ok(s.timezone !== 'UTC', 'the timezone is UTC, so the budget day resets at the wrong hour');
});
await check('the spend lookup is an rpc, not a row scan', async () => {
  const s = await prepared({ mode: 'check', estimated_cost_usd: 0 });
  ok(s.spendUrl.endsWith('/rest/v1/rpc/llm_spend_since'), 'spendUrl: ' + s.spendUrl);
});

console.log('\nPrice the call');
const priceRows = [{ model: 'claude-haiku-4-5', in_per_mtok: 1, out_per_mtok: 5 }];
async function priceCall(rows, input = goodLog) {
  const state = await prepared(input);
  const [o] = await run(guard, 'Price the call', { input: httpBody(rows), nodes: { Prepare: [state] } });
  return o.json;
}
await check('cost is tokens times the table price', async () => {
  const r = await priceCall(priceRows);
  // 1200 in at $1/Mtok plus 300 out at $5/Mtok
  eq(r.cost, 0.0027, 'cost');
  eq(r.priced, true, 'priced');
});
await check('the row written matches what was priced', async () => {
  const r = await priceCall(priceRows);
  eq(r.row, { workflow_name: '[05] digest', model: 'claude-haiku-4-5', input_tokens: 1200,
              output_tokens: 300, cost_usd: 0.0027, priced: true, purpose: 'summarise' }, 'row');
});
await check('an unknown model is recorded, not priced, and not guessed at', async () => {
  const r = await priceCall([]);
  eq(r.cost, 0, 'cost');
  eq(r.priced, false, 'priced');
  eq(r.row.input_tokens, 1200, 'tokens are still recorded');
  ok(r.alertText && r.alertText.includes('Unpriced model'), 'no alert text');
});
await check('a row for some other model is not used', async () => {
  const r = await priceCall([{ model: 'gpt-4o-mini', in_per_mtok: 999, out_per_mtok: 999 }]);
  eq(r.priced, false, 'priced against the wrong model');
});
await check('a price that is not a number throws instead of costing zero', () => throws(
  () => priceCall([{ model: 'claude-haiku-4-5', in_per_mtok: 'free', out_per_mtok: 5 }]),
  'price that is not a number'));
await check('a negative price throws', () => throws(
  () => priceCall([{ model: 'claude-haiku-4-5', in_per_mtok: -1, out_per_mtok: 5 }]),
  'price that is not a number'));
await check('zero tokens costs zero but is still priced', async () => {
  const r = await priceCall(priceRows, { ...goodLog, usage: { input_tokens: 0, output_tokens: 0 } });
  eq([r.cost, r.priced], [0, true], 'cost and priced');
});
await check('a priced call raises no alert', async () => {
  eq((await priceCall(priceRows)).alertText, null, 'alertText');
});
await check('cost is rounded to six places, not left as float noise', async () => {
  const r = await priceCall([{ model: 'claude-haiku-4-5', in_per_mtok: 3, out_per_mtok: 15 }],
    { ...goodLog, usage: { input_tokens: 1, output_tokens: 1 } });
  eq(r.cost, 0.000018, 'cost');
});

console.log('\nLog result');
await check('the caller is told whether the call was actually priced', async () => {
  const state = await priceCall([]);
  const [o] = await run(guard, 'Log result', { input: [{}], nodes: { 'Price the call': [state] } });
  eq(o.json.priced, false, 'priced');
  eq(o.json.logged, true, 'logged');
  eq(o.json.cost_usd, 0, 'cost_usd');
});

console.log('\nDecide');
const cfg = (limit) => httpBody([{ daily_limit_usd: limit }]);
const spend = (total, unpriced = 0, calls = 1) => httpBody([{ total_usd: total, unpriced, calls }]);
async function decide(limitRows, spendRows, estimate = 1) {
  const state = await prepared({ mode: 'check', estimated_cost_usd: estimate });
  const [o] = await run(guard, 'Decide', {
    input: spendRows, nodes: { Prepare: [state], 'Read the cap': limitRows[0] ? [limitRows[0]] : [] },
  });
  return o.json;
}
await check('under the cap is allowed', async () => {
  const r = await decide(cfg(20), spend(5), 1);
  eq(r.allowed, true, 'allowed');
  eq(r.projected, 6, 'projected');
});
await check('exactly at the cap is allowed', async () => {
  eq((await decide(cfg(20), spend(19), 1)).allowed, true, 'allowed');
});
await check('a cent over the cap is refused', async () => {
  const r = await decide(cfg(20), spend(19), 1.01);
  eq(r.allowed, false, 'allowed');
  ok(r.alertText.includes('Daily LLM cap reached'), 'alert text');
});
await check('a spent total already over the cap refuses even a free call', async () => {
  eq((await decide(cfg(20), spend(25), 0)).allowed, false, 'allowed');
});
await check('an empty ledger means nothing spent, not an error', async () => {
  const r = await decide(cfg(20), spend(0, 0, 0), 1);
  eq([r.spent, r.allowed], [0, true], 'spent and allowed');
});
await check('a missing cap refuses rather than reading as unlimited', () => throws(
  () => decide([], spend(5), 1), 'daily_limit_usd could not be read'));
await check('a cap that is not a number refuses', () => throws(
  () => decide(cfg('twenty'), spend(5), 1), 'daily_limit_usd could not be read'));
await check('a negative cap refuses', () => throws(() => decide(cfg(-1), spend(5), 1), 'daily_limit_usd'));
await check('a total that is not a number refuses rather than counting as zero', () => throws(
  () => decide(cfg(20), spend(null), 1), 'did not return a usable total'));
await check('unpriced calls are carried into the verdict', async () => {
  const r = await decide(cfg(20), spend(5, 3), 1);
  eq(r.unpriced, 3, 'unpriced');
});
await check('a refusal says the total is a floor when prices are missing', async () => {
  const r = await decide(cfg(20), spend(25, 2), 1);
  ok(r.alertText.includes('the real total is higher'), 'alert text: ' + r.alertText);
});
await check('a refusal with no unpriced calls does not mention them', async () => {
  const r = await decide(cfg(20), spend(25, 0), 1);
  ok(!r.alertText.includes('real total is higher'), 'alert text: ' + r.alertText);
});
await check('float addition does not leak into the projection', async () => {
  eq((await decide(cfg(20), spend(0.1), 0.2)).projected, 0.3, 'projected');
});

console.log('\nCheck result');
await check('the verdict carries the numbers behind it', async () => {
  const state = await decide(cfg(20), spend(5, 2, 9), 1);
  const [o] = await run(guard, 'Check result', { input: [{}], nodes: { Decide: [state] } });
  const j = o.json;
  eq([j.allowed, j.spent_today, j.estimated, j.limit, j.calls_today, j.unpriced_today],
     [true, 5, 1, 20, 9, 2], 'verdict fields');
  eq(j.currency, 'USD', 'currency');
  ok(j.day_start && j.timezone, 'no day window on the verdict');
});

console.log('\nReport window');
const windowOf = async () => (await run(report, 'Prepare window', { input: [{}] }))[0].json;
await check('the window is a whole local day that has already ended', async () => {
  const w = await windowOf();
  const since = DateTime.fromISO(w.since, { setZone: true });
  const until = DateTime.fromISO(w.until, { setZone: true });
  eq([since.hour, until.hour], [0, 0], 'window edges are not midnight');
  eq(until.diff(since, 'hours').hours, 24, 'window is not 24 hours');
  ok(until <= DateTime.now().setZone(w.timezone), 'the window has not closed yet');
});
await check('the report and the cap use the same timezone', async () => {
  const w = await windowOf();
  const p = await prepared({ mode: 'check', estimated_cost_usd: 0 });
  eq(w.timezone, p.timezone, 'timezone');
});
await check('the schedule fires after the window closes, not before', () => {
  const rule = nodeOf(report, 'Just after midnight').parameters.rule.interval[0];
  // The brief said 23:00. That would leave 23:00 to midnight in no report at all.
  eq(rule.triggerAtHour, 0, 'trigger hour');
  ok(rule.triggerAtMinute > 0, 'trigger minute is ' + rule.triggerAtMinute);
});

console.log('\nSummarise');
const rrow = (workflow_name, model, cost_usd, extra = {}) => ({
  workflow_name, model, cost_usd, calls: 1, input_tokens: 100, output_tokens: 50, unpriced: 0, ...extra });
async function summarise(rows) {
  const w = await windowOf();
  const [o] = await run(report, 'Summarise', { input: httpBody(rows), nodes: { 'Prepare window': [w] } });
  return o.json;
}
await check('the total is the sum of the groups', async () => {
  const r = await summarise([rrow('a', 'm1', 1.5), rrow('b', 'm1', 2.25), rrow('a', 'm2', 0.25)]);
  eq(r.total, 4, 'total');
  eq(r.calls, 3, 'calls');
});
await check('spend is grouped per workflow across models', async () => {
  const r = await summarise([rrow('a', 'm1', 1), rrow('a', 'm2', 2), rrow('b', 'm1', 0.5)]);
  eq(r.workflows, [{ workflow_name: 'a', cost_usd: 3 }, { workflow_name: 'b', cost_usd: 0.5 }], 'workflows');
});
await check('the three most expensive workflows lead the report', async () => {
  const r = await summarise(['a', 'b', 'c', 'd', 'e'].map((n, i) => rrow(n, 'm', (i + 1))));
  eq(r.top.map((t) => t.workflow_name), ['e', 'd', 'c'], 'top three');
  eq(r.top.length, 3, 'top length');
  ok(r.message.includes('1. e'), 'message: ' + r.message);
});
await check('the tail is counted rather than dropped', async () => {
  const r = await summarise(['a', 'b', 'c', 'd', 'e'].map((n, i) => rrow(n, 'm', (i + 1))));
  ok(r.message.includes('and 2 more'), 'message: ' + r.message);
  ok(r.message.includes('$3.00'), 'the tail total is missing: ' + r.message);
});
await check('a tie breaks on the name so the order does not wander', async () => {
  const r1 = await summarise([rrow('zebra', 'm', 5), rrow('apple', 'm', 5)]);
  const r2 = await summarise([rrow('apple', 'm', 5), rrow('zebra', 'm', 5)]);
  eq(r1.top.map((t) => t.workflow_name), ['apple', 'zebra'], 'order');
  eq(r1.top, r2.top, 'the order depends on the order rows arrived');
});
await check('models are broken out separately from workflows', async () => {
  const r = await summarise([rrow('a', 'm1', 1), rrow('b', 'm1', 2), rrow('a', 'm2', 4)]);
  eq(r.models, [{ model: 'm2', cost_usd: 4 }, { model: 'm1', cost_usd: 3 }], 'models');
});
await check('unpriced calls are called out in the message', async () => {
  const r = await summarise([rrow('a', 'm', 1, { unpriced: 2 })]);
  eq(r.unpriced, 2, 'unpriced');
  ok(r.message.includes('The real total is higher'), 'message: ' + r.message);
});
await check('a clean day says nothing about unpriced calls', async () => {
  const r = await summarise([rrow('a', 'm', 1)]);
  ok(!r.message.includes('real total is higher'), 'message: ' + r.message);
});
await check('a day with no spend sends nothing', async () => {
  const r = await summarise([]);
  eq([r.hasSpend, r.total, r.calls], [false, 0, 0], 'empty day');
});
await check('percentages do not divide by zero on a free day', async () => {
  const r = await summarise([rrow('a', 'm', 0)]);
  ok(!r.message.includes('NaN'), 'message: ' + r.message);
  ok(!r.message.includes('Infinity'), 'message: ' + r.message);
});
await check('a cost that is not a number throws instead of vanishing', () => throws(
  () => summarise([rrow('a', 'm', 'free')]), 'cost that is not a number'));
await check('small amounts keep four decimals, large ones two', async () => {
  const small = await summarise([rrow('a', 'm', 0.0025)]);
  ok(small.message.includes('$0.0025'), 'message: ' + small.message);
  const large = await summarise([rrow('a', 'm', 12.5)]);
  ok(large.message.includes('$12.50'), 'message: ' + large.message);
});
await check('the message names the day it covers', async () => {
  const r = await summarise([rrow('a', 'm', 1)]);
  const w = await windowOf();
  ok(r.message.includes(w.dayLabel), 'message: ' + r.message);
});

console.log('\nSchema and workflow files');
await check('every rpc the workflows call exists in schema.sql', () => {
  for (const fn of ['llm_spend_since', 'llm_spend_report']) {
    ok(new RegExp('create or replace function ' + fn + '\\(').test(schema), fn + ' is not in schema.sql');
  }
  const guardSrc = JSON.stringify(guard) + JSON.stringify(report);
  for (const fn of ['llm_spend_since', 'llm_spend_report']) {
    ok(guardSrc.includes('rpc/' + fn), fn + ' is not called by any workflow');
  }
});
await check('the price list is a table, not a literal in a node', () => {
  ok(/create table if not exists model_prices/.test(schema), 'no model_prices table');
  const src = codeOf(guard, 'Price the call');
  ok(src.includes('model_prices') === false || !/in_per_mtok\s*[:=]\s*[\d.]/.test(src),
     'a price literal appears in the node code');
  ok(/model_prices\?select=/.test(codeOf(guard, 'Prepare')), 'the node does not read model_prices');
});
await check('the cap is a table too, so changing it needs no workflow edit', () => {
  ok(/create table if not exists llm_guard_config/.test(schema), 'no config table');
  ok(/llm_guard_config\?select=daily_limit_usd/.test(codeOf(guard, 'Prepare')), 'the cap is not read from the table');
});
await check('the config table cannot grow a second row', () => {
  ok(/check \(id = 1\)/.test(schema), 'nothing stops a second config row');
});
await check('the ledger cannot hold negative tokens or negative money', () => {
  for (const c of ['input_tokens  >= 0', 'output_tokens >= 0', 'cost_usd >= 0']) {
    ok(schema.includes(c), 'missing check constraint: ' + c);
  }
});
await check('both workflows ship inactive and carry no credentials', () => {
  for (const wf of [guard, report]) {
    eq(wf.active, false, wf.name + ' active');
    eq(wf.nodes.filter((n) => n.credentials).map((n) => n.name), [], wf.name + ' credentials');
  }
});
await check('every node is reachable from a trigger', () => {
  for (const wf of [guard, report]) {
    const triggers = wf.nodes.filter((n) => /Trigger$|trigger$/i.test(n.type)).map((n) => n.name);
    ok(triggers.length > 0, wf.name + ' has no trigger');
    const seen = new Set(triggers);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [from, c] of Object.entries(wf.connections)) {
        if (!seen.has(from)) continue;
        for (const branch of c.main) for (const l of branch || []) if (!seen.has(l.node)) { seen.add(l.node); grew = true; }
      }
    }
    eq(wf.nodes.filter((n) => !seen.has(n.name)).map((n) => n.name), [], wf.name + ' orphans');
  }
});
await check('both gate branches return something to the caller', () => {
  const terminal = (wf) => wf.nodes.filter((n) => !wf.connections[n.name]).map((n) => n.name).sort();
  eq(terminal(guard), ['Check result', 'Log result'], 'guard terminals');
});
await check('a telegram outage cannot swallow the verdict', () => {
  // Without this, an unreachable Telegram throws and the caller never learns whether it
  // may spend - a notification failure wearing the costume of a broken guard.
  for (const n of guard.nodes.filter((x) => x.type === 'n8n-nodes-base.telegram')) {
    eq(n.onError, 'continueRegularOutput', n.name + ' onError');
  }
});
await check('the report is allowed to fail loudly instead', () => {
  // Different call: a daily report that silently does not arrive is worse than one that
  // errors and gets picked up by the error handler in workflow 01.
  const n = nodeOf(report, 'Send report');
  eq(n.onError, undefined, 'Send report onError');
});
await check('an alert never swallows the result', () => {
  eq(guard.connections['Alert unpriced model'].main[0][0].node, 'Log result', 'unpriced alert');
  eq(guard.connections['Alert cap reached'].main[0][0].node, 'Check result', 'cap alert');
});
await check('the gate refuses on the way in, never after the fact', () => {
  // Out of scope in SPEC.md: nothing may undo a call that already happened.
  const names = guard.nodes.map((n) => n.name.toLowerCase()).join(' ');
  ok(!/revert|refund|undo|rollback|delete/.test(names), 'a node looks like it undoes spending');
  const src = JSON.stringify(guard);
  ok(!/"method":\s*"(DELETE|PATCH)"/.test(src), 'the guard mutates existing ledger rows');
});
await check('the ledger is only ever appended to', () => {
  const writes = guard.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest'
    && n.parameters.url.includes('usageUrl'));
  eq(writes.map((n) => n.parameters.method), ['POST'], 'ledger write methods');
});
await check('nothing in either file is written in anything but English', () => {
  // Escaped rather than written literally, so this file does not itself trip the scan.
  for (const wf of [guard, report]) {
    eq(JSON.stringify(wf).match(/[\u0400-\u04FF]/g), null, wf.name + ' has cyrillic');
  }
  eq(schema.match(/[\u0400-\u04FF]/g), null, 'schema.sql has cyrillic');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
