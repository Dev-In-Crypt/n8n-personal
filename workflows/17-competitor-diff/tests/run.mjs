// Offline tests for workflow 17.
//
// Every Code node is executed exactly as it is stored in workflow.json: the jsCode is read
// out of the file and run with the n8n globals stubbed. Nothing here re-implements the
// logic it is testing, so a test cannot pass against code the instance would not run.
//
// `crypto` is deliberately left undefined. The Code node sandbox on this instance has no
// crypto global and refuses builtin module imports, so any node reaching for it must fail
// here rather than at 09:30 in production.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DateTime } from 'luxon';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const wf = JSON.parse(readFileSync(join(root, 'workflow.json'), 'utf8'));
const nodes = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
const fixture = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; } catch (e) { failures.push(name + ': ' + (e && e.message ? e.message : e)); }
};
const eq = (a, b, what) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error((what || 'value') + ' was ' + x + ', expected ' + y);
};
const ok = (cond, what) => { if (!cond) throw new Error(what || 'expected true'); };
const throws = (fn, re, what) => {
  try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error((what || '') + ' threw "' + e.message + '"'); return; }
  throw new Error((what || 'call') + ' did not throw');
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const items = (xs) => xs.map((j) => ({ json: j }));
const stubInput = (xs) => ({ all: () => items(xs), first: () => items(xs)[0] });

// Runs one Code node out of workflow.json. `ctx` maps node names to the items those nodes
// produced; `input` is what arrives on this node's own input.
const run = (nodeName, input, ctx = {}) => {
  const node = nodes[nodeName];
  if (!node) throw new Error('no node named ' + nodeName);
  const $ = (name) => {
    if (!(name in ctx)) throw new Error(nodeName + ' asked for node "' + name + '" which the test did not stub');
    const list = items(Array.isArray(ctx[name]) ? ctx[name] : [ctx[name]]);
    return { all: () => list, first: () => list[0] };
  };
  const fn = new AsyncFunction('$input', '$', 'DateTime', '$now', 'crypto', node.parameters.jsCode);
  return fn(stubInput(input), $, DateTime, DateTime.now(), undefined);
};

// A stand-in for the HTML node: not the real extractor, and the tests say so. It exists
// only to turn the fixtures into the text the real node would hand to "Detect changes".
const extractText = (html, selector) => {
  let body = html;
  if (selector && selector !== 'body') {
    const tag = selector.replace(/^[.#]/, '');
    const re = selector.startsWith('.')
      ? new RegExp('<([a-z]+)[^>]*class="[^"]*\\b' + tag + '\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>', 'i')
      : new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
    const m = html.match(re);
    if (!m) return '';
    body = m[m.length - 1];
  }
  return body
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|li|tr|footer|nav|main|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&copy;/g, '©')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
};

const CFG = {
  chatId: '111', sheetId: 'sheet-1', sheetName: 'competitor-changes', model: 'claude-haiku-4-5',
  language: 'Russian', timezone: 'Europe/Madrid', maxPages: 40, alertFrom: 6, estPerChange: 0.004,
  snapshotChars: 120000, diffMaxLines: 600, diffMaxChanges: 60, fetchTimeoutMs: 20000,
  workflowName: '[17] Competitor page monitor',
  pagesUrl: 'https://p.supabase.co/rest/v1/competitor_pages?enabled=eq.true',
  snapshotsUrl: 'https://p.supabase.co/rest/v1/page_snapshots',
  snapshotWriteUrl: 'https://p.supabase.co/rest/v1/page_snapshots?on_conflict=url_hash',
};

const main = async () => {
  // ---------------------------------------------------------------- Config
  const configCode = nodes.Config.parameters.jsCode;
  check('Config refuses to run without a Supabase url', () => {
    throws(() => new Function(configCode)(), /SUPABASE_URL/, 'Config');
  });
  check('Config refuses to run without an alert chat', () => {
    const c = configCode.replace("const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://p.supabase.co';");
    throws(() => new Function(c)(), /ALERT_CHAT_ID/, 'Config');
  });
  check('Config refuses to run without a sheet', () => {
    const c = configCode
      .replace("const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://p.supabase.co';")
      .replace("const ALERT_CHAT_ID = '';", "const ALERT_CHAT_ID = '111';");
    throws(() => new Function(c)(), /SHEET_ID/, 'Config');
  });
  const configured = (() => {
    const c = configCode
      .replace("const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://p.supabase.co/';")
      .replace("const ALERT_CHAT_ID = '';", "const ALERT_CHAT_ID = '111';")
      .replace("const SHEET_ID = '';", "const SHEET_ID = 'sheet-1';");
    return new Function(c)()[0].json;
  })();
  check('Config builds the page list url and trims the trailing slash', () => {
    eq(configured.pagesUrl, 'https://p.supabase.co/rest/v1/competitor_pages?enabled=eq.true&select=url,competitor,page_type,selector,enabled&order=url', 'pagesUrl');
  });
  check('Config upserts snapshots on the url hash', () => {
    ok(/on_conflict=url_hash$/.test(configured.snapshotWriteUrl), 'snapshotWriteUrl: ' + configured.snapshotWriteUrl);
  });
  check('Config alerts from 6 out of 10, as the spec asks', () => eq(configured.alertFrom, 6, 'alertFrom'));

  // ---------------------------------------------------------------- Prepare the batch
  const rows = [
    { url: 'https://a.example/pricing', competitor: 'A', page_type: 'pricing', selector: 'main' },
    { url: 'https://a.example/pricing', competitor: 'A', page_type: 'pricing', selector: 'main' },
    { url: 'https://b.example/changelog', competitor: '', page_type: '', selector: '' },
    { url: 'ftp://c.example/x', competitor: 'C' },
    { url: '', competitor: 'D' },
  ];
  const prepared = (await run('Prepare the batch', rows, { Config: CFG }))[0].json;
  check('Prepare drops duplicate urls', () => eq(prepared.count, 2, 'count'));
  check('Prepare rejects anything that is not an http url', () => {
    eq(prepared.rejected.map((r) => r.url), ['ftp://c.example/x', ''], 'rejected');
  });
  check('Prepare falls back to the hostname and to the whole body', () => {
    eq(prepared.pages[1].competitor, 'b.example', 'competitor');
    eq(prepared.pages[1].selector, 'body', 'selector');
    eq(prepared.pages[1].pageType, 'page', 'pageType');
  });
  check('Prepare asks workflow 11 for a fresh copy, never a cached one', () => {
    eq(prepared.fetchRequest.ttl_hours, 0, 'ttl_hours');
    eq(prepared.fetchRequest.urls, ['https://a.example/pricing', 'https://b.example/changelog'], 'urls');
    eq(prepared.fetchRequest.timeout_ms, 20000, 'timeout_ms');
  });
  check('Prepare hashes the url with a real sha256', () => {
    const expected = createHash('sha256').update('page:https://a.example/pricing').digest('hex');
    eq(prepared.pages[0].urlHash, expected, 'urlHash');
  });
  check('Prepare puts every hash into the snapshot query', () => {
    for (const p of prepared.pages) ok(prepared.snapshotQueryUrl.includes('"' + p.urlHash + '"'), 'missing ' + p.urlHash);
    // Hex keys, so the query needs no percent-encoding to be a valid url.
    ok(!/[\s%+#\\]/.test(prepared.snapshotQueryUrl), 'query string holds characters that need escaping');
  });
  const capped = (await run('Prepare the batch',
    Array.from({ length: 5 }, (_, i) => ({ url: 'https://x.example/' + i, competitor: 'X' })),
    { Config: { ...CFG, maxPages: 3 } }))[0].json;
  check('Prepare stops at maxPages and counts what it left', () => {
    eq(capped.count, 3, 'count');
    eq(capped.skipped, 2, 'skipped');
  });
  const empty = (await run('Prepare the batch', [], { Config: CFG }))[0].json;
  check('Prepare still builds a valid query when there is nothing to look up', () => {
    ok(empty.snapshotQueryUrl.includes('"__none__"'), empty.snapshotQueryUrl);
  });

  // ---------------------------------------------------------------- Fan out pages
  const fetched = {
    results: [
      { url: 'https://a.example/pricing', status: 200, from_cache: false, content: '<html>ok</html>' },
      { url: 'https://b.example/changelog', status: 503, from_cache: false, content: '' },
    ],
    errors: [], stats: {},
  };
  const fanned = (await run('Fan out pages', [fetched],
    { Config: CFG, 'Prepare the batch': prepared })).map((i) => i.json);
  check('Fan out keeps one item per page, fetched or not', () => eq(fanned.length, 2, 'items'));
  check('Fan out marks a non-2xx as a failed fetch and blanks the html', () => {
    eq(fanned[1].fetchOk, false, 'fetchOk');
    eq(fanned[1].html, '', 'html');
    ok(/503/.test(fanned[1].fetchError), fanned[1].fetchError);
  });
  const missing = (await run('Fan out pages', [{ results: [fetched.results[0]] }],
    { Config: CFG, 'Prepare the batch': prepared })).map((i) => i.json);
  check('Fan out survives a fetcher that answered about fewer urls than it was given', () => {
    eq(missing.length, 2, 'items');
    ok(/no answer/.test(missing[1].fetchError), missing[1].fetchError);
  });

  // ---------------------------------------------------------------- Detect changes
  const page = (url, selector) => ({
    url, urlHash: createHash('sha256').update('page:' + url).digest('hex'),
    competitor: 'Example', pageType: 'pricing', selector,
    status: 200, fromCache: false, fetchOk: true, fetchError: null, html: '',
  });
  const detect = async (pages, sections, snapshots) => (await run('Detect changes',
    snapshots.length ? snapshots : [{}], {
      Config: CFG, 'Prepare the batch': prepared,
      'Fan out pages': pages, 'Extract the section': sections.map((s) => ({ section: s })),
    }))[0].json;

  const v1 = fixture('pricing-v1.html');
  const p1 = page('https://a.example/pricing', 'main');
  const first = await detect([p1], [extractText(v1, 'main')], []);
  check('the first run takes a baseline and sends nothing', () => {
    eq(first.counts.baselines, 1, 'baselines');
    eq(first.hasChanges, false, 'hasChanges');
    eq(first.changed.length, 0, 'changed');
    ok(first.baselines[0].hash.length === 64, 'hash: ' + first.baselines[0].hash);
  });
  check('the baseline row carries everything the table needs', () => {
    const r = first.baselines[0];
    eq(r.url_hash, p1.urlHash, 'url_hash');
    eq([r.competitor, r.page_type, r.selector], ['Example', 'pricing', 'main'], 'page identity');
    eq(r.truncated, false, 'truncated');
  });
  const snapshot = { url_hash: p1.urlHash, url: p1.url, hash: first.baselines[0].hash, text: first.baselines[0].text, taken_at: '2026-09-22T07:30:00Z' };

  const same = await detect([p1], [extractText(v1, 'main')], [snapshot]);
  check('an identical page is not a change', () => {
    eq(same.counts.unchanged, 1, 'unchanged');
    eq(same.hasChanges, false, 'hasChanges');
  });

  const noiseBase = await detect([page('https://a.example/pricing', 'body')], [extractText(v1, 'body')], []);
  const noiseAfter = await detect([page('https://a.example/pricing', 'body')],
    [extractText(fixture('pricing-v2-noise.html'), 'body')],
    [{ url_hash: p1.urlHash, url: p1.url, hash: noiseBase.baselines[0].hash, text: noiseBase.baselines[0].text, taken_at: '2026-09-22T07:30:00Z' }]);
  check('a new year, a new visitor count and a new timestamp are not a change', () => {
    eq(noiseAfter.counts.changed, 0, 'changed');
    eq(noiseAfter.counts.unchanged, 1, 'unchanged');
  });
  check('the normalised text keeps the prices and replaces the volatile parts', () => {
    const t = noiseBase.baselines[0].text;
    ok(t.includes('$19/month'), 'price missing from the snapshot');
    ok(t.includes('<count> companies'), 'counter not normalised: ' + t);
    ok(t.includes('<datetime>'), 'timestamp not normalised');
    ok(/© <year>/.test(t) || t.includes('(c) <year>'), 'copyright year not normalised: ' + t);
    ok(t.includes('<id>'), 'session id not normalised');
  });

  const priceRun = await detect([p1], [extractText(fixture('pricing-v2-price.html'), 'main')], [snapshot]);
  check('a price change is a change', () => {
    eq(priceRun.counts.changed, 1, 'changed');
    eq(priceRun.hasChanges, true, 'hasChanges');
  });
  check('the diff shows the old value and the new one, not just that something moved', () => {
    const c = priceRun.changed[0];
    ok(c.removed.some((l) => l.includes('$19/month')), 'old price missing: ' + JSON.stringify(c.removed));
    ok(c.added.some((l) => l.includes('$24/month')), 'new price missing: ' + JSON.stringify(c.added));
    ok(c.diffText.includes('- ') && c.diffText.includes('+ '), 'diff has no sides');
    eq(c.previousSeenAt, '2026-09-22T07:30:00Z', 'previousSeenAt');
  });
  check('an unchanged run costs nothing to classify', () => eq(same.budgetCheck.estimated_cost_usd, 0, 'estimate'));
  check('the budget check prices one call per changed page', () => {
    eq(priceRun.budgetCheck, { mode: 'check', estimated_cost_usd: 0.004 }, 'budgetCheck');
  });

  const brokenSelector = await detect([page('https://a.example/pricing', '.gone')], [''], [snapshot]);
  check('a selector that matches nothing is a failure, never an empty page', () => {
    eq(brokenSelector.counts.failed, 1, 'failed');
    eq(brokenSelector.counts.baselines, 0, 'baselines');
    eq(brokenSelector.counts.changed, 0, 'changed');
    ok(/matched nothing/.test(brokenSelector.failed[0].reason), brokenSelector.failed[0].reason);
  });
  const deadFetch = await detect([{ ...p1, fetchOk: false, fetchError: 'http 503' }], [''], [snapshot]);
  check('a page that could not be fetched keeps its snapshot', () => {
    eq(deadFetch.counts.failed, 1, 'failed');
    eq(deadFetch.counts.changed, 0, 'changed');
  });
  let mismatched = null;
  try { await detect([p1, p1], ['a'], [snapshot]); } catch (e) { mismatched = e.message; }
  check('pairing by position is verified before anything is trusted', () => {
    ok(mismatched && /1 items for 2 pages/.test(mismatched), 'error was ' + mismatched);
  });

  const longOld = Array.from({ length: 900 }, (_, i) => 'line ' + i).join('\n');
  const longNew = longOld.replace('line 5', 'line five');
  const longRun = await detect([p1], [longNew],
    [{ ...snapshot, hash: createHash('sha256').update('different').digest('hex'), text: longOld }]);
  check('a page longer than the diff limit is still diffed, and says it was cut', () => {
    eq(longRun.counts.changed, 1, 'changed');
    ok(longRun.changed[0].diffTruncated, 'not flagged as truncated');
    ok(longRun.changed[0].diffText.includes('compared from the top only'), longRun.changed[0].diffText.slice(-200));
  });
  const manyOld = Array.from({ length: 200 }, (_, i) => 'old ' + i).join('\n');
  const manyNew = Array.from({ length: 200 }, (_, i) => 'new ' + i).join('\n');
  const manyRun = await detect([p1], [manyNew],
    [{ ...snapshot, hash: createHash('sha256').update('different').digest('hex'), text: manyOld }]);
  check('a diff with hundreds of changed lines is capped, and counts what it left out', () => {
    const c = manyRun.changed[0];
    eq(c.removed.length + c.added.length, CFG.diffMaxChanges, 'changed lines carried');
    ok(/more changed lines/.test(c.diffText), c.diffText.slice(-120));
  });

  // ---------------------------------------------------------------- the two sha256 copies
  check('both copies of sha256 in this workflow agree with node, byte for byte', () => {
    const copies = wf.nodes.filter((n) => (n.parameters.jsCode || '').includes('const sha256 ='))
      .map((n) => n.parameters.jsCode.slice(n.parameters.jsCode.indexOf('const sha256 ='),
        n.parameters.jsCode.indexOf('};', n.parameters.jsCode.indexOf('return H.map')) + 2));
    eq(copies.length, 2, 'copies of sha256');
    eq(copies[0], copies[1], 'the two copies have drifted apart');
    for (const s of ['', 'abc', 'https://a.example/pricing?x=1', 'a'.repeat(1000)]) {
      const fn = new Function(copies[0] + '\nreturn sha256(arguments[0]);');
      eq(fn(s), createHash('sha256').update(s).digest('hex'), 'digest of a ' + s.length + ' character string');
    }
  });
  check('no Code node reaches for crypto', () => {
    for (const n of wf.nodes) {
      const js = (n.parameters && n.parameters.jsCode) || '';
      ok(!/\bcrypto\b/.test(js.replace(/\/\/[^\n]*/g, '')), n.name + ' mentions crypto outside a comment');
    }
  });

  // ---------------------------------------------------------------- the model request
  const detected = priceRun;
  const requests = (await run('One request per change', [{}],
    { Config: CFG, 'Detect changes': detected })).map((i) => i.json);
  check('one request per changed page, and none for the quiet ones', () => eq(requests.length, 1, 'requests'));
  check('the request carries the schema the spec asks for', () => {
    eq(requests[0].schema.properties.change_type.enum, ['pricing', 'feature', 'copy', 'noise'], 'change_type');
    eq(requests[0].schema.required, ['change_type', 'summary_ru', 'significance_0_10', 'quote'], 'required');
  });
  check('the summary is asked for in the configured language', () => {
    ok(requests[0].system.includes('Russian'), 'language missing from the prompt');
  });
  check('the diff is handed over as data, with an instruction not to obey it', () => {
    ok(/untrusted data/.test(requests[0].system), 'no untrusted-data instruction');
    ok(JSON.parse(requests[0].user).diff.includes('$24/month'), 'the diff did not reach the prompt');
  });

  // ---------------------------------------------------------------- Collect verdicts
  const twoChanges = { ...detected, changed: [detected.changed[0], { ...detected.changed[0], url: 'https://a.example/blog' }] };
  const answer = (over) => ({ ok: true, model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: 50 },
    data: { change_type: 'pricing', summary_ru: 'text', significance_0_10: 8, quote: '+ $24/month', ...over } });
  const collect = async (changedState, answers) => (await run('Collect verdicts', answers,
    { Config: CFG, 'Detect changes': changedState }))[0].json;

  const verdicts = await collect(twoChanges, [answer(), answer({ significance_0_10: 3, change_type: 'copy' })]);
  check('a high score goes to Telegram, a low one only to the sheet', () => {
    eq(verdicts.alerts.length, 1, 'alerts');
    eq(verdicts.sheetRows.length, 2, 'sheet rows');
    eq(verdicts.sheetRows[0].alerted, true, 'first row alerted');
    eq(verdicts.sheetRows[1].alerted, false, 'second row alerted');
  });
  const noisy = await collect(twoChanges, [answer({ change_type: 'noise', significance_0_10: 9 }), answer()]);
  check('noise never reaches Telegram, whatever score the model gave it', () => {
    eq(noisy.alerts.length, 1, 'alerts');
    eq(noisy.alerts[0].url, 'https://a.example/blog', 'the wrong change was alerted');
    eq(noisy.sheetRows.length, 2, 'sheet rows');
  });
  const broken = await collect(twoChanges, [answer(), { ok: false, errors: ['schema'] }]);
  check('a page the model could not classify keeps its old snapshot', () => {
    eq(broken.snapshots.length, 1, 'snapshots');
    eq(broken.failed.length, 1, 'failed');
    ok(/model failed/.test(broken.failed[0].reason), broken.failed[0].reason);
  });
  const misaligned = await collect(twoChanges, [answer()]);
  check('answers that do not line up with the pages are all discarded', () => {
    eq(misaligned.snapshots.length, 0, 'snapshots');
    eq(misaligned.alerts.length, 0, 'alerts');
    ok(/misaligned/.test(misaligned.failed[0].reason), misaligned.failed[0].reason);
  });
  const badScore = await collect(twoChanges, [answer({ significance_0_10: 'high' }), answer({ change_type: 'guess' })]);
  check('an answer outside the schema is not a verdict', () => {
    eq(badScore.snapshots.length, 0, 'snapshots');
    eq(badScore.failed.length, 2, 'failed');
  });
  const clamped = await collect(twoChanges, [answer({ significance_0_10: 44 }), answer({ significance_0_10: -3 })]);
  check('a score outside 0 to 10 is clamped rather than believed', () => {
    eq(clamped.sheetRows.map((r) => r.significance), [10, 0], 'significance');
  });
  check('the spend log sums every call, including the ones that failed', () => {
    eq(broken.spendLog.usage, { input_tokens: 100, output_tokens: 50 }, 'usage');
    eq(broken.spendLog.mode, 'log', 'mode');
    ok(broken.spendLog.workflow_name.includes('17'), broken.spendLog.workflow_name);
  });
  check('the sheet row carries the old and the new value, not just a verdict', () => {
    ok(verdicts.sheetRows[0].removed.includes('$19/month'), verdicts.sheetRows[0].removed);
    ok(verdicts.sheetRows[0].added.includes('$24/month'), verdicts.sheetRows[0].added);
  });

  // ---------------------------------------------------------------- the message
  const messages = (await run('One message per alert', [{}],
    { Config: CFG, 'Collect verdicts': verdicts })).map((i) => i.json);
  check('one message per alert', () => eq(messages.length, 1, 'messages'));
  check('the message shows what it was and what it is now', () => {
    ok(messages[0].message.includes('Was:'), 'no before');
    ok(messages[0].message.includes('Now:'), 'no after');
    ok(messages[0].message.includes('$19/month'), 'old value missing');
    ok(messages[0].message.includes('$24/month'), 'new value missing');
  });
  check('the message names the competitor, the score and the page', () => {
    ok(messages[0].message.startsWith('Example - Pricing (8/10)'), messages[0].message.slice(0, 60));
    ok(messages[0].message.includes('https://a.example/pricing'), 'url missing');
  });
  check('the message says when the last snapshot was taken', () => {
    ok(/Compared against the snapshot from \d+ \w+ \d{2}:\d{2}\./.test(messages[0].message), messages[0].message.split('\n')[2]);
  });
  const huge = {
    ...verdicts,
    alerts: [{ ...verdicts.alerts[0],
      removed: Array.from({ length: 200 }, (_, i) => 'old line ' + i + ' '.repeat(40)),
      added: Array.from({ length: 200 }, (_, i) => 'new line ' + i + ' '.repeat(40)) }],
  };
  const bigMessages = (await run('One message per alert', [{}], { Config: CFG, 'Collect verdicts': huge })).map((i) => i.json);
  check('a huge diff is shortened to one Telegram message instead of failing to send', () => {
    ok(bigMessages[0].message.length <= 4096, 'length ' + bigMessages[0].message.length);
    ok(bigMessages[0].message.includes('old line 0'), 'the first removed line was dropped');
    ok(bigMessages[0].message.includes('new line 0'), 'the first added line was dropped');
  });

  // ---------------------------------------------------------------- the small nodes
  const budget = (await run('Build the budget check', [{}], { 'Detect changes': detected }))[0].json;
  check('the budget check asks in the shape workflow 12a reads', () => {
    eq(budget.mode, 'check', 'mode');
    ok(typeof budget.estimated_cost_usd === 'number', 'estimate is not a number');
  });
  const sheetItems = (await run('One row per change', [{}, {}, {}], { 'Collect verdicts': verdicts })).map((i) => i.json);
  check('the sheet gets one row per change, not one per message sent before it', () => {
    eq(sheetItems.length, 2, 'rows');
    eq(Object.keys(sheetItems[0]).length, 11, 'columns');
  });
  const log = (await run('Build the spend log', [{}], { 'Collect verdicts': verdicts }))[0].json;
  check('the spend log is handed over unchanged', () => eq(log.mode, 'log', 'mode'));

  // ---------------------------------------------------------------- the workflow file
  check('the workflow ships inactive and with no credentials attached', () => {
    eq(wf.active, false, 'active');
    for (const n of wf.nodes) ok(!n.credentials, n.name + ' carries a credential');
  });
  check('every connection points at a node that exists', () => {
    for (const [from, conn] of Object.entries(wf.connections)) {
      ok(nodes[from], 'connection from unknown node ' + from);
      for (const branch of conn.main) for (const c of branch) ok(nodes[c.node], from + ' points at unknown node ' + c.node);
    }
  });
  check('every node except the trigger is reachable', () => {
    const seen = new Set(['Every day at 09:30']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [from, conn] of Object.entries(wf.connections)) {
        if (!seen.has(from)) continue;
        for (const branch of conn.main) for (const c of branch) if (!seen.has(c.node)) { seen.add(c.node); grew = true; }
      }
    }
    for (const n of wf.nodes) ok(seen.has(n.name), n.name + ' is not reachable from the trigger');
  });
  check('the snapshot read still emits an item when the table is empty', () => {
    ok(nodes['Read the last snapshots'].alwaysOutputData, 'alwaysOutputData is off, so the first run would stop here');
    ok(nodes['Read the last snapshots'].executeOnce, 'executeOnce is off, so it would run once per page');
  });
  check('the snapshot writes run once per run, not once per item', () => {
    ok(nodes['Save baseline snapshots'].executeOnce, 'baseline write');
    ok(nodes['Save changed snapshots'].executeOnce, 'changed write');
  });
  check('a broken selector cannot take the extractor, and the run, down', () => {
    eq(nodes['Extract the section'].onError, 'continueRegularOutput', 'onError');
  });
  check('the network calls retry', () => {
    for (const name of ['Read the page list', 'Read the last snapshots', 'Save baseline snapshots',
      'Save changed snapshots', 'Alert in Telegram', 'Append to the sheet']) {
      ok(nodes[name].retryOnFail, name + ' does not retry');
    }
  });
  check('the sub-workflows are the ones this build depends on', () => {
    eq(nodes['Fetch the pages'].parameters.workflowId.value, 'TUo0nnuFo7BOdOyY', 'workflow 11');
    eq(nodes['Check the budget'].parameters.workflowId.value, '7x0VlU6BXxpHP5tK', 'workflow 12a');
    eq(nodes['Classify each change'].parameters.workflowId.value, 'SgxyRPkD8HkhXQAn', 'workflow 03');
    eq(nodes['Classify each change'].parameters.mode, 'each', 'one call per change');
  });
  check('the file holds no Cyrillic and no obvious secret', () => {
    const raw = readFileSync(join(root, 'workflow.json'), 'utf8');
    ok(!/[\u0400-\u04FF]/.test(raw), 'Cyrillic in workflow.json');
    ok(!/sk-[A-Za-z0-9]{16}|Bearer [A-Za-z0-9]{16}/.test(raw), 'something that looks like a key');
  });
  check('the schedule is the one the spec asks for', () => {
    eq(nodes['Every day at 09:30'].parameters.rule.interval[0].expression, '30 9 * * *', 'cron');
    eq(wf.settings.timezone, 'Europe/Madrid', 'timezone');
  });

  console.log(passed + ' passed, ' + failures.length + ' failed');
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
