// Runs the digest's Code nodes outside n8n. Code is read from workflow.json; the RSS
// feed, the two sub-workflow calls and Telegram are canned. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const normalise = (entries) => {
  const $input = { all: () => entries.map((json) => ({ json })) };
  return new Function('$input', codeOf('Normalise and cap'))($input)[0].json;
};
const buildRequest = (dedupResult) => {
  const $input = { first: () => ({ json: dedupResult }) };
  return new Function('$input', codeOf('Build digest request'))($input)[0].json;
};
const compose = (llmResult, batch) => {
  const $input = { first: () => ({ json: llmResult }) };
  const $ = () => ({ first: () => ({ json: batch }) });
  return new Function('$input', '$', codeOf('Compose message'))($input, $)[0].json;
};

const fixture = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Normalise and cap');
const n = normalise(clone(fixture.feedEntries));
check('entry without a link dropped', n.items.length === 3, n.items.length);
check('shaped for workflow 02',
  n.source === 'digest' && n.key_field === 'url' && Array.isArray(n.items), n);
check('newest first', n.items[0].url === 'https://example.com/escape', n.items.map((i) => i.url));
check('html stripped from excerpt',
  !n.items.some((i) => /[<>]/.test(i.excerpt)), n.items.map((i) => i.excerpt));
check('dates normalised to iso',
  n.items.every((i) => i.published_at.endsWith('Z')), n.items.map((i) => i.published_at));
check('nothing carried over', n.carriedOver === 0, n.carriedOver);

console.log('Cap runs before deduplication');
const many = Array.from({ length: 20 }, (_, i) => ({
  title: 'Item ' + i, link: 'https://example.com/' + i,
  isoDate: new Date(Date.UTC(2026, 8, 9, 0, i)).toISOString(), contentSnippet: 'x',
}));
const capped = normalise(many);
check('capped at 15', capped.items.length === 15, capped.items.length);
check('overflow reported', capped.carriedOver === 5, capped.carriedOver);
check('overflow not sent to dedup',
  !capped.items.some((i) => i.url === 'https://example.com/0'), capped.items.length);
check('kept the newest', capped.items[0].url === 'https://example.com/19', capped.items[0].url);

console.log('Build digest request');
const dedup = { new_items: n.items, skipped: 0 };
const req = buildRequest(dedup);
check('one call for the batch', req.count === 3 && typeof req.user === 'string', req.count);
check('every url in the prompt',
  n.items.every((i) => req.user.includes(i.url)), req.user.slice(0, 200));
check('schema demands the fields',
  req.schema.properties.items.items.required.join() === 'url,one_liner,tag',
  req.schema.properties.items.items.required);

console.log('Compose message');
const llm = { ok: true, data: { items: [
  { url: 'https://example.com/escape', one_liner: 'Escaping check', tag: 'misc' },
  { url: 'https://example.com/n8n-29', one_liner: 'MCP server lands in core', why_it_matters: 'no extra server to run', tag: 'tooling' },
  { url: 'https://example.com/pg19', one_liner: 'Failover slots in logical replication', tag: 'databases' },
] } };
const msg = compose(llm, n);
check('all entries present', msg.count === 3, msg.count);
check('grouped and sorted by tag',
  msg.text.indexOf('<b>databases</b>') < msg.text.indexOf('<b>misc</b>')
  && msg.text.indexOf('<b>misc</b>') < msg.text.indexOf('<b>tooling</b>'), msg.text);
check('titles are links',
  msg.text.includes('<a href="https://example.com/pg19">'), msg.text);
check('html escaped in titles',
  msg.text.includes('A &amp; B &lt;script&gt;'), msg.text);
check('why it matters rendered', msg.text.includes('no extra server to run'), msg.text);
check('no carry-over footer', !msg.text.includes('waiting for tomorrow'), msg.text);
check('not degraded', msg.degraded === false, msg.degraded);

console.log('Carry-over footer');
const cappedMsg = compose({ ok: true, data: { items: [] } }, capped);
check('footer shown', cappedMsg.text.includes('5 more waiting for tomorrow'), cappedMsg.text);

console.log('Degraded mode');
const degraded = compose({ ok: false, data: null, errors: ['schema mismatch'] }, n);
check('digest still sent', degraded.count === 3, degraded.count);
check('links survive', degraded.text.includes('https://example.com/pg19'), degraded.text);
check('degradation is stated', degraded.text.includes('summaries unavailable'), degraded.text);
check('flagged', degraded.degraded === true, degraded.degraded);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
