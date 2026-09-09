// Drives the retry loop outside n8n. Node code is read from workflow.json and the
// network call is replaced by canned replies. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const prepare = (payload) => {
  const $input = { first: () => ({ json: payload }) };
  return new Function('$input', codeOf('Prepare request'))($input)[0].json;
};
const validate = (state, response) => {
  const $input = { first: () => ({ json: response }) };
  const $ = () => ({ first: () => ({ json: state }) });
  return new Function('$input', '$', codeOf('Validate against schema'))($input, $)[0].json;
};
const finish = (state) => {
  const $input = { first: () => ({ json: state }) };
  return new Function('$input', codeOf('Return result'))($input)[0].json;
};

// One full pass of the workflow, with replies handed out in order.
const runLoop = (payload, replies) => {
  let state = prepare(payload);
  const seen = [];
  for (let i = 0; ; i++) {
    const reply = replies[Math.min(i, replies.length - 1)];
    state = validate(state, reply);
    seen.push(state);
    if (state.done) break;
    if (i > 10) throw new Error('loop did not terminate');
  }
  return { result: finish(state), passes: seen };
};

const say = (text, usage) => ({
  content: [{ type: 'text', text }],
  usage: usage || { input_tokens: 120, output_tokens: 40 },
});

const base = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const good = { category: 'bug', severity: 2, summary: 'Export button inert on Safari', tags: ['safari'] };

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Valid on the first attempt');
const a = runLoop(clone(base), [say(JSON.stringify(good))]);
check('ok', a.result.ok === true, a.result);
check('one attempt', a.result.attempts === 1, a.result.attempts);
check('data parsed', a.result.data.summary === good.summary, a.result.data);
check('usage reported', a.result.usage.output_tokens === 40, a.result.usage);
check('no raw on success', a.result.raw_on_failure === null, a.result.raw_on_failure);

console.log('JSON wrapped in prose and a fence');
const b = runLoop(clone(base), [say('Sure, here you go:\n```json\n' + JSON.stringify(good) + '\n```\nHope that helps.')]);
check('extracted anyway', b.result.ok === true && b.result.attempts === 1, b.result);

console.log('Schema violation then a fix');
const bad = { ...good, severity: 'high' };
const c = runLoop(clone(base), [say(JSON.stringify(bad)), say(JSON.stringify(good))]);
check('recovered on attempt 2', c.result.ok === true && c.result.attempts === 2, c.result);
check('first pass not done', c.passes[0].done === false, c.passes[0].done);
check('error names the path',
  /root\.severity: expected integer, got string/.test(c.passes[0].errors[0]), c.passes[0].errors);
check('conversation grew by two', c.passes[0].messages.length === 3, c.passes[0].messages.length);
check('back-off 2s then 8s',
  c.passes[0].waitSeconds === 2 && c.passes[1].waitSeconds === 8,
  [c.passes[0].waitSeconds, c.passes[1].waitSeconds]);

console.log('Missing required property');
const d = runLoop(clone(base), [say(JSON.stringify({ category: 'bug', severity: 1 }))]);
check('reported as missing',
  /missing required property "summary"/.test(d.passes[0].errors[0]), d.passes[0].errors);

console.log('Enum violation');
const e = runLoop(clone(base), [say(JSON.stringify({ ...good, category: 'other' }))]);
check('enum enforced', /is not one of/.test(e.passes[0].errors[0]), e.passes[0].errors);

console.log('Array item type');
const f = runLoop(clone(base), [say(JSON.stringify({ ...good, tags: ['ok', 7] }))]);
check('item path reported',
  /root\.tags\[1\]: expected string, got number/.test(f.passes[0].errors[0]), f.passes[0].errors);

console.log('Impossible schema, attempts exhausted');
const g = runLoop(clone(base), [say(JSON.stringify({ category: 'bug' }))]);
check('gives up cleanly', g.result.ok === false, g.result.ok);
check('attempts = max_retries + 1', g.result.attempts === 3, g.result.attempts);
check('raw kept for debugging', typeof g.result.raw_on_failure === 'string', g.result.raw_on_failure);
check('errors listed', g.result.errors.length > 0, g.result.errors);

console.log('max_retries 0 stops after one call');
const h = runLoop({ ...clone(base), max_retries: 0 }, [say('not json at all')]);
check('single attempt', h.result.attempts === 1 && h.result.ok === false, h.result.attempts);

console.log('API failure is data, not an exception');
const i = runLoop(clone(base), [{ error: { type: 'overloaded_error', message: 'server busy' } }]);
check('counted as a failed attempt', i.result.ok === false, i.result.ok);
check('error surfaced', /api call failed/.test(i.result.errors[0]), i.result.errors);

console.log('Empty reply');
const j = runLoop(clone(base), [{ content: [] }]);
check('reported', /empty reply/.test(j.passes[0].errors[0]), j.passes[0].errors);

console.log('Input validation');
const throws = (fn, re) => { try { fn(); return false; } catch (err) { return re.test(err.message); } };
check('user prompt required', throws(() => prepare({ schema: {} }), /user prompt is required/), true);
check('schema required', throws(() => prepare({ user: 'hi' }), /schema is required/), true);
check('max_retries bounded', throws(() => prepare({ user: 'hi', schema: {}, max_retries: 9 }), /between 0 and 5/), true);
check('model comes from input, not hardcoded',
  prepare({ user: 'hi', schema: {}, model: 'claude-haiku-4-5' }).model === 'claude-haiku-4-5', true);
check('schema is sent to the model',
  prepare(clone(base)).system.includes('"severity"'), true);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
