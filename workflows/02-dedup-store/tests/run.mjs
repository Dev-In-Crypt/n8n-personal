// Runs the "Build keys" and "Diff against seen" node logic outside n8n. The code is
// read straight out of workflow.json; n8n globals are stubbed. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// No crypto is installed for the node code. The live Code node sandbox has none, and an
// earlier version of this suite supplied it here, which is how a workflow that throws on
// its first line passed every check. createHash is used only to check the answers.

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

// The workflow refuses to run without SUPABASE_URL, so the harness injects a fake one.
const buildCode = codeOf('Build keys').replace(
  "const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://test.supabase.co';");
const diffCode = codeOf('Diff against seen');
const resultCode = codeOf('Return result');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const buildKeys = (payload) => {
  const $input = { first: () => ({ json: payload }) };
  return new AsyncFunction('$input', 'crypto', buildCode)($input, undefined).then((r) => r[0].json);
};
const diff = (built, seenHashes) => {
  const $input = { all: () => seenHashes.map((h) => ({ json: { hash: h } })) };
  const $ = (name) => ({ first: () => ({ json: built }) });
  return new Function('$input', '$', diffCode)($input, $)[0].json;
};
const result = (diffed) => {
  const $ = () => ({ first: () => ({ json: diffed }) });
  return new Function('$', resultCode)($)[0].json;
};

const base = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Run 1: empty table');
const built1 = await buildKeys(clone(base));
const d1 = diff(built1, []);
const r1 = result(d1);
check('5 new items', r1.new_items.length === 5, r1.new_items.length);
check('nothing skipped', r1.skipped === 0, r1.skipped);
check('one batch of 5 rows', d1.rows.length === 5, d1.rows.length);
check('rows carry the expected columns',
  Object.keys(d1.rows[0]).sort().join(',') === 'first_seen_at,hash,payload_preview,source',
  Object.keys(d1.rows[0]));
check('hash is sha256 hex', /^[0-9a-f]{64}$/.test(d1.rows[0].hash), d1.rows[0].hash);

console.log('Run 2: same input, hashes already stored');
const built2 = await buildKeys(clone(base));
const d2 = diff(built2, built1.keys.map((k) => k.hash));
const r2 = result(d2);
check('no new items', r2.new_items.length === 0, r2.new_items.length);
check('5 skipped', r2.skipped === 5, r2.skipped);
check('no insert payload', d2.rows.length === 0 && d2.hasNew === false, d2.hasNew);

console.log('Hashing is stable across runs');
check('same input gives same hashes',
  built1.keys.map((k) => k.hash).join() === built2.keys.map((k) => k.hash).join(), false);
const otherSource = await buildKeys({ ...clone(base), source: 'other' });
check('source is part of the key',
  otherSource.keys[0].hash !== built1.keys[0].hash, otherSource.keys[0].hash);

console.log('Duplicate inside one batch');
const dup = clone(base);
dup.items.push({ url: 'https://example.com/a', title: 'Alpha again' });
const builtDup = await buildKeys(dup);
check('collapsed before the database', builtDup.keys.length === 5, builtDup.keys.length);
check('collapse is reported', builtDup.duplicatesInBatch === 1, builtDup.duplicatesInBatch);

console.log('Empty batch');
const builtEmpty = await buildKeys({ source: 'digest', key_field: 'url', items: [] });
check('select url stays valid', builtEmpty.selectUrl.includes('in.("__none__")'), builtEmpty.selectUrl);
const dEmpty = diff(builtEmpty, []);
check('nothing to insert', dEmpty.hasNew === false && dEmpty.rows.length === 0, dEmpty.hasNew);

console.log('Missing key field');
let threw = false;
try { await buildKeys({ source: 'digest', key_field: 'url', items: [{ title: 'no url here' }] }); }
catch (e) { threw = /missing key_field/.test(e.message); }
check('throws with the item named', threw, threw);

console.log('Preview length');
const long = { source: 'digest', key_field: 'url',
  items: [{ url: 'https://example.com/x', body: 'y'.repeat(2000) }] };
const builtLong = await buildKeys(long);
check('preview capped at 200', builtLong.keys[0].preview.length === 200, builtLong.keys[0].preview.length);

console.log('Runs without crypto, as the live sandbox does');
const expect = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
check('hash matches sha256 of source:key exactly',
  built1.keys[0].hash === expect(built1.source + ':' + built1.keys[0].value), built1.keys[0].hash);
const odd = await buildKeys({ source: 'gmail', key_field: 'id',
  items: [{ id: '<CAF=abc@mail.gmail.com>' }, { id: 'ünïcødé ✓' }, { id: 'x'.repeat(56) }] });
check('multibyte and padding-boundary keys hash correctly',
  odd.keys.every((k) => k.hash === expect('gmail:' + k.value)), odd.keys.map((k) => k.hash.slice(0, 8)));
check('no Code node calls into crypto',
  wf.nodes.every((n) => !/\bcrypto\s*\./.test((n.parameters && n.parameters.jsCode) || '')), true);

console.log('An all-new batch against an empty answer');
const emptyItem = (() => {
  const $input = { all: () => [{ json: {} }] };
  const $ = () => ({ first: () => ({ json: built1 }) });
  return new Function('$input', '$', diffCode)($input, $)[0].json;
})();
check('one empty item from the fetch is not mistaken for a seen hash', emptyItem.new_items.length === 5, emptyItem.new_items.length);
check('the fetch node always emits an item, so an all-new batch is not dropped',
  wf.nodes.find((n) => n.name === 'Fetch seen hashes').alwaysOutputData === true, false);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
