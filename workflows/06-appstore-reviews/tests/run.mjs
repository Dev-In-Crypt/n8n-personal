// Runs the monitor's Code nodes outside n8n. Code is read from workflow.json; feeds,
// sub-workflow calls, the database write and Telegram are canned. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const config = (over) => ({
  bootstrap: false, chatId: '123', storeUrl: 'https://test.supabase.co/rest/v1/app_reviews', ...over,
});
const normalise = (feeds, cfg) => {
  const $input = { all: () => feeds.map((json) => ({ json })) };
  const $ = () => ({ first: () => ({ json: cfg }) });
  return new Function('$input', '$', codeOf('Normalise reviews'))($input, $)[0].json;
};
const buildRequest = (dedup, state) => {
  const $input = { first: () => ({ json: dedup }) };
  const $ = () => ({ first: () => ({ json: state }) });
  return new Function('$input', '$', codeOf('Build review request'))($input, $)[0].json;
};
const route = (llm, batch) => {
  const $input = { first: () => ({ json: llm }) };
  const $ = () => ({ first: () => ({ json: batch }) });
  return new Function('$input', '$', codeOf('Route and compose'))($input, $)[0].json;
};

const fixture = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Normalise reviews');
const n = normalise(clone(fixture.feeds), config());
check('four reviews, metadata dropped', n.items.length === 4, n.items.length);
check('no app metadata entry',
  !n.items.some((r) => r.review_id.includes('app-metadata')), n.items.map((r) => r.review_id));
check('single-review country handled',
  n.items.some((r) => r.review_id === 'es:7001'), n.items.map((r) => r.review_id));
check('empty feed ignored',
  !n.items.some((r) => r.country === 'gb'), n.items.map((r) => r.country));
check('ids are country scoped', n.items.every((r) => /^[a-z]{2}:/.test(r.review_id)), n.items[0]);
check('whitespace collapsed',
  n.items.find((r) => r.review_id === 'us:9001').body === 'My kid sleeps <b>faster</b> now.',
  n.items.find((r) => r.review_id === 'us:9001').body);
check('newest first', n.items[0].review_id === 'us:9002', n.items.map((r) => r.review_id));
check('shaped for workflow 02',
  n.source === 'appstore' && n.key_field === 'review_id', n);

console.log('Routing');
const batch = buildRequest({ new_items: n.items }, n);
check('one call for the batch', batch.count === 4, batch.count);
const llm = { ok: true, data: { reviews: [
  { review_id: 'us:9001', sentiment: 'positive', theme: 'sleep', is_bug_report: false, suggested_reply: 'Thank you!' },
  { review_id: 'us:9002', sentiment: 'negative', theme: 'stability', is_bug_report: true, suggested_reply: 'Sorry about that, could you share your device?' },
  { review_id: 'us:9003', sentiment: 'negative', theme: 'content volume', is_bug_report: false, suggested_reply: 'More stories are coming.' },
  { review_id: 'es:7001', sentiment: 'positive', theme: 'general', is_bug_report: false, suggested_reply: 'Gracias!' },
] } };
const out = route(llm, batch);
check('all four stored', out.stored === 4, out.stored);
check('two alerted', out.alertCount === 2, out.alertCount);
check('one star alerted',
  out.rows.find((r) => r.review_id === 'us:9002').alerted === true, out.rows[0]);
check('two star alerted',
  out.rows.find((r) => r.review_id === 'us:9003').alerted === true, out.rows[1]);
check('four star not alerted',
  out.rows.find((r) => r.review_id === 'es:7001').alerted === false, out.rows[3]);
check('bug flag stored',
  out.rows.find((r) => r.review_id === 'us:9002').is_bug === true, out.rows[0]);

console.log('Bug report at a high rating still alerts');
const bugAtFive = route({ ok: true, data: { reviews: [
  { review_id: 'us:9001', sentiment: 'positive', theme: 'sleep', is_bug_report: true },
] } }, buildRequest({ new_items: [n.items.find((r) => r.review_id === 'us:9001')] }, n));
check('alerted on the bug flag', bugAtFive.alertCount === 1, bugAtFive.alertCount);

console.log('First run');
const bootstrapState = normalise(clone(fixture.feeds), config({ bootstrap: true }));
const bootstrapOut = route(llm, buildRequest({ new_items: bootstrapState.items }, bootstrapState));
check('nothing alerted', bootstrapOut.alertCount === 0, bootstrapOut.alertCount);
check('everything still stored', bootstrapOut.stored === 4, bootstrapOut.stored);
check('no message built', bootstrapOut.text === '', bootstrapOut.text);

console.log('Draft replies');
check('draft stored on the row',
  out.rows.find((r) => r.review_id === 'us:9002').draft_reply.startsWith('Sorry about that'),
  out.rows[0].draft_reply);
check('draft never in the message',
  !out.text.includes('could you share your device'), out.text);
check('message says drafts are not sent',
  out.text.includes('Draft replies are stored, not sent.'), out.text);

console.log('Message');
check('html escaped', out.text.includes('Crashes &amp; burns'), out.text);
check('rating and country shown', out.text.includes('<b>1/5</b> · US'), out.text);

console.log('Degraded mode');
const degraded = route({ ok: false, data: null }, batch);
check('still stored', degraded.stored === 4, degraded.stored);
check('low ratings still alert', degraded.alertCount === 2, degraded.alertCount);
check('no theme invented',
  degraded.rows.every((r) => r.theme === null), degraded.rows.map((r) => r.theme));
check('flagged as degraded', degraded.degraded === true, degraded.degraded);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
