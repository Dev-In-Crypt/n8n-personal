// Runs the radar's Code nodes outside n8n. Code is read from workflow.json; source
// fetches, sub-workflow calls, the write and Telegram are canned. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const cfg = { chatId: '123', alertThreshold: 70, storeUrl: 'https://test.supabase.co/rest/v1/funding_items' };

const ctx = (map) => (name) => ({
  first: () => ({ json: map[name] }),
  all: () => (Array.isArray(map[name]) ? map[name] : [map[name]]).map((json) => ({ json })),
});

const normalise = (fetched, sources) => {
  const $input = { all: () => fetched.map((json) => ({ json })) };
  const $ = ctx({ 'Load sources': sources, Config: cfg });
  return new Function('$input', '$', codeOf('Normalise items'))($input, $)[0].json;
};
const hardFilter = (dedup, state, profile) => {
  const $input = { first: () => ({ json: dedup }) };
  const $ = ctx({ 'Normalise items': state, 'Load applicant profile': profile });
  return new Function('$input', '$', codeOf('Hard filter'))($input, $)[0].json;
};
const buildScoring = (gate) => {
  const $input = { first: () => ({ json: gate }) };
  return new Function('$input', codeOf('Build scoring request'))($input)[0].json;
};
const verify = (llm, gate) => {
  const $input = { first: () => ({ json: llm }) };
  const $ = ctx({ 'Build scoring request': gate });
  return new Function('$input', '$', codeOf('Verify evidence'))($input, $)[0].json;
};

const fx = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Normalise items');
const n = normalise(clone(fx.fetched), clone(fx.sources));
check('seven items across two sources', n.items.length === 7, n.items.length);
check('ids prefixed by source',
  n.items[0].id === 'demo-api:C-1' && n.items.at(-1).id === 'other-api:O-1',
  [n.items[0].id, n.items.at(-1).id]);
check('field_map applied', n.items[0].title === 'AI for public services', n.items[0]);
check('html stripped', !/[<>]/.test(n.items[0].summary), n.items[0].summary);
check('budget parsed as number', n.items[0].budget === 250000, n.items[0].budget);
check('date normalised', n.items[0].deadline === '2027-03-01', n.items[0].deadline);
check('country upper-cased', n.items[0].country === 'ES', n.items[0].country);
check('shaped for workflow 02', n.source === 'eu-funding' && n.key_field === 'id', n.source);

console.log('Failed fetch keeps the pairing');
const withFailure = normalise([{ error: 'timeout' }, clone(fx.fetched[1])], clone(fx.sources));
check('only the second source contributed',
  withFailure.items.length === 1 && withFailure.items[0].id === 'other-api:O-1',
  withFailure.items.map((i) => i.id));

console.log('Hard filter runs before any model call');
const gate = hardFilter({ new_items: n.items }, n, clone(fx.profile));
check('two survivors', gate.kept === 2, gate.items.map((i) => i.id));
check('five dropped', gate.droppedTotal === 5, gate.droppedTotal);
check('past deadline counted', gate.dropped.deadline === 1, gate.dropped);
check('budget below minimum counted', gate.dropped.budget === 1, gate.dropped);
check('country outside profile counted', gate.dropped.country === 1, gate.dropped);
check('disqualifying term counted', gate.dropped.excluded === 1, gate.dropped);
check('missing keywords counted', gate.dropped.keywords === 1, gate.dropped);
check('profile is data, not code',
  gate.profile.countries.join() === 'ES,PT', gate.profile.countries);

console.log('Empty profile lists disable their filters');
const openGate = hardFilter({ new_items: n.items }, n,
  { keywords: [], exclude_terms: [], countries: [], budget_min: null, budget_max: null });
check('only the past deadline is dropped', openGate.kept === 6, openGate.kept);
check('unmapped fields fall back to null, not "[object Object]"',
  n.items.at(-1).country === null && n.items.at(-1).url === null, n.items.at(-1));

console.log('Quote verification');
const scoring = buildScoring(gate);
const realQuote = 'Grants for artificial intelligence in municipal services.';
const good = verify({ ok: true, data: { items: [
  { id: 'demo-api:C-1', relevance_0_100: 88, matched_criteria: ['ai'], blocking_reasons: [], evidence_quote: realQuote, evidence_url: 'https://example.org/c1' },
  { id: 'other-api:O-1', relevance_0_100: 30, evidence_quote: 'Support for digital twin adoption.' },
] } }, scoring);
check('verified quote keeps its score', good.rows[0].relevance === 88, good.rows[0].relevance);
check('not marked unverified', good.rows[0].unverified === false, good.rows[0].unverified);
check('evidence stored', good.rows[0].evidence === realQuote, good.rows[0].evidence);
check('alerts', good.alertCount === 1, good.alertCount);

const fabricated = verify({ ok: true, data: { items: [
  { id: 'demo-api:C-1', relevance_0_100: 95, evidence_quote: 'This call explicitly funds solo founders in Spain.' },
] } }, scoring);
check('fabricated quote flagged', fabricated.rows[0].unverified === true, fabricated.rows[0].unverified);
check('score capped at 40', fabricated.rows[0].relevance === 40, fabricated.rows[0].relevance);
check('evidence not stored', fabricated.rows[0].evidence === null, fabricated.rows[0].evidence);
check('does not alert despite the high score', fabricated.alertCount === 0, fabricated.alertCount);
check('unverified counted', fabricated.unverifiedCount === 2, fabricated.unverifiedCount);
check('an item the model skipped entirely is unverified too',
  fabricated.rows.find((r) => r.id === 'other-api:O-1').unverified === true
  && fabricated.rows.find((r) => r.id === 'other-api:O-1').relevance === 0,
  fabricated.rows.find((r) => r.id === 'other-api:O-1'));

const spaced = verify({ ok: true, data: { items: [
  { id: 'demo-api:C-1', relevance_0_100: 80, evidence_quote: '  Grants   for artificial\nintelligence in municipal services. ' },
] } }, scoring);
check('whitespace tolerated', spaced.rows[0].unverified === false, spaced.rows[0].unverified);

const paraphrase = verify({ ok: true, data: { items: [
  { id: 'demo-api:C-1', relevance_0_100: 80, evidence_quote: 'Grants for AI in municipal services.' },
] } }, scoring);
check('paraphrase rejected', paraphrase.rows[0].unverified === true, paraphrase.rows[0].unverified);

const tiny = verify({ ok: true, data: { items: [
  { id: 'demo-api:C-1', relevance_0_100: 80, evidence_quote: 'Grants' },
] } }, scoring);
check('too short to be evidence', tiny.rows[0].unverified === true, tiny.rows[0].unverified);

console.log('Threshold');
const below = verify({ ok: true, data: { items: [
  { id: 'demo-api:C-1', relevance_0_100: 69, evidence_quote: realQuote },
] } }, scoring);
check('69 does not alert', below.alertCount === 0, below.alertCount);
check('but is still stored', below.stored === 2, below.stored);

console.log('Message');
check('counters in the footer',
  good.text.includes('7 seen, 5 filtered before scoring'), good.text);
check('title is a link', good.text.includes('<a href="https://example.org/c1">'), good.text);

console.log('Degraded mode');
const degraded = verify({ ok: false, data: null }, scoring);
check('stored anyway', degraded.stored === 2, degraded.stored);
check('relevance zero', degraded.rows[0].relevance === 0, degraded.rows[0].relevance);
check('nothing alerted', degraded.alertCount === 0, degraded.alertCount);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
