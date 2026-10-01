// Drives the retry loop outside n8n. Node code is read from workflow.json and the
// network call is replaced by canned replies. Run: node tests/run.mjs
//
// The harness models the instance, not a convenient version of it. In n8n "Prepare request"
// runs exactly once, so every pass of the loop reads the SAME prepared state back - the
// loop state is not threaded from one pass to the next. An earlier harness did thread it,
// which hid a retry counter that never advanced. Here `prepared` is deliberately frozen and
// the only things that move are $runIndex and the list of replies already given.
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const prepare = (payload) => {
  const $input = { first: () => ({ json: payload }) };
  return new Function('$input', codeOf('Prepare request'))($input)[0].json;
};

// `given` is every reply the stubbed HTTP node has returned so far, newest last, which is
// what $('Call Anthropic').all(0, run) hands back in the real thing.
const validate = (prepared, response, runIndex, given) => {
  const $input = { first: () => ({ json: response }) };
  const $ = (name) => {
    if (name === 'Prepare request') return { first: () => ({ json: prepared }) };
    if (name === 'Call Anthropic') {
      return {
        all: (branch, run) => {
          if (run === undefined || run >= given.length) throw new Error('no data for run ' + run);
          return [{ json: given[run] }];
        },
      };
    }
    throw new Error('the validator asked for node "' + name + '" which the test did not stub');
  };
  return new Function('$input', '$', '$runIndex', codeOf('Validate against schema'))($input, $, runIndex)[0].json;
};

const finish = (state) => {
  // Junk on the input on purpose: the answer must come from the validator by name, because
  // the spend log sits between the two and its reply must never be returned to the caller.
  const $input = { first: () => ({ json: { ledger: 'this is the spend log answer' } }) };
  const $ = (name) => {
    if (name === 'Validate against schema') return { first: () => ({ json: state }) };
    throw new Error('"Return result" asked for node "' + name + '" which the test did not stub');
  };
  return new Function('$input', '$', codeOf('Return result'))($input, $)[0].json;
};

const spendLog = (state) => {
  const $ = (name) => {
    if (name === 'Validate against schema') return { first: () => ({ json: state }) };
    throw new Error('"Build the spend log" asked for node "' + name + '"');
  };
  return new Function('$', codeOf('Build the spend log'))($)[0].json;
};

// One full pass of the workflow, with replies handed out in order.
const runLoop = (payload, replies) => {
  const prepared = prepare(payload);
  const frozen = JSON.stringify(prepared);
  const given = [];
  const seen = [];
  for (let i = 0; ; i++) {
    const reply = replies[Math.min(i, replies.length - 1)];
    given.push(reply);
    const state = validate(prepared, reply, i, given);
    seen.push(state);
    if (JSON.stringify(prepared) !== frozen) throw new Error('a pass mutated the prepared state');
    if (state.done) break;
    if (i > 10) throw new Error('loop did not terminate');
  }
  return { result: finish(seen[seen.length - 1]), passes: seen };
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

console.log('The attempt counter advances even though the prepared state never does');
const k = runLoop(clone(base), [say(JSON.stringify({ category: 'bug' }))]);
check('one attempt per pass', JSON.stringify(k.passes.map((s) => s.attempt)) === '[1,2,3]',
  k.passes.map((s) => s.attempt));
check('the last pass is the one that stops', k.passes.map((s) => s.done).join() === 'false,false,true',
  k.passes.map((s) => s.done));

console.log('Usage is the sum over every attempt, not just the last one');
const l = runLoop(clone(base), [
  say(JSON.stringify({ category: 'bug' }), { input_tokens: 100, output_tokens: 10 }),
  say(JSON.stringify({ category: 'bug' }), { input_tokens: 200, output_tokens: 20 }),
  say(JSON.stringify(good), { input_tokens: 300, output_tokens: 30 }),
]);
check('three attempts paid for', l.result.attempts === 3, l.result.attempts);
check('input tokens summed', l.result.usage.input_tokens === 600, l.result.usage);
check('output tokens summed', l.result.usage.output_tokens === 60, l.result.usage);
const m = runLoop(clone(base), [{ error: { type: 'overloaded_error', message: 'busy' } }]);
check('no usage at all stays null', m.result.usage === null, m.result.usage);

console.log('The answer survives the spend log sitting in front of it');
check('answer read from the validator, not the input', l.result.ok === true && l.result.data.summary === good.summary,
  l.result);
check('internal fields do not leak to the caller',
  ['logSpend', 'workflowName', 'purpose'].every((f) => !(f in l.result)), Object.keys(l.result));

console.log('The spend log sent to workflow 12a');
const row = spendLog(l.passes[2]);
check('log mode', row.mode === 'log', row.mode);
check('whole token counts', Number.isInteger(row.usage.input_tokens) && Number.isInteger(row.usage.output_tokens), row.usage);
check('the summed usage is what gets logged', row.usage.input_tokens === 600, row.usage);
check('the model is the one that was called', row.model === prepare(clone(base)).model, row.model);
check('an unnamed caller is marked, not blank',
  row.workflow_name === '[03] (caller not named)', row.workflow_name);
const namedRow = spendLog(validate(prepare({ ...clone(base), workflow_name: '[16] Voice notes', purpose: 'note structuring' }),
  say(JSON.stringify(good)), 0, [say(JSON.stringify(good))]));
check('a named caller is logged under its own name', namedRow.workflow_name === '[16] Voice notes', namedRow.workflow_name);
check('the purpose is passed through', namedRow.purpose === 'note structuring', namedRow.purpose);
const failedRow = spendLog(runLoop(clone(base), [say(JSON.stringify({ category: 'bug' }))]).passes[2]);
check('a failed call is still logged, and says so',
  /no valid answer after 3 attempts/.test(failedRow.purpose), failedRow.purpose);

console.log('Opting out of the spend log');
check('logging is on unless the caller says otherwise', prepare(clone(base)).logSpend === true, true);
check('log_spend false is honoured',
  prepare({ ...clone(base), log_spend: false }).logSpend === false, true);
check('only false turns it off, not any falsy value',
  prepare({ ...clone(base), log_spend: 0 }).logSpend === true, true);
const gate = wf.nodes.find((n) => n.name === 'Report the spend?');
check('the gate checks the flag and that there is usage to report',
  gate.parameters.conditions.conditions[0].leftValue === '={{ $json.logSpend && !!$json.usage }}',
  gate.parameters.conditions.conditions[0].leftValue);
const logNode = wf.nodes.find((n) => n.name === 'Log the spend');
check('a ledger outage cannot cost the caller its answer',
  logNode.onError === 'continueRegularOutput' && logNode.alwaysOutputData === true, logNode);
check('the ledger is workflow 12a', logNode.parameters.workflowId.value === '7x0VlU6BXxpHP5tK',
  logNode.parameters.workflowId.value);
check('the spend log is not the last node', wf.connections['Log the spend'].main[0][0].node === 'Return result',
  wf.connections['Log the spend']);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
