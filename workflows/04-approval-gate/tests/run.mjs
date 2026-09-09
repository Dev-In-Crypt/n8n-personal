// Runs the gate's logic outside n8n. Node code is read from workflow.json; the Telegram
// wait is replaced by canned resume payloads. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const prepareCode = codeOf('Prepare request')
  .replace("const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://test.supabase.co';");

const prepare = (payload) => {
  const $input = { first: () => ({ json: payload }) };
  return new Function('$input', prepareCode)($input)[0].json;
};
const record = (state, resume) => {
  const $input = { first: () => ({ json: resume }) };
  const $ = () => ({ first: () => ({ json: state }) });
  return new Function('$input', '$', codeOf('Record decision'))($input, $)[0].json;
};
const finish = (state) => {
  const $input = { first: () => ({ json: state }) };
  return new Function('$input', codeOf('Return result'))($input)[0].json;
};
const run = (payload, resume) => {
  const state = prepare(payload);
  const decided = record(state, resume);
  return { state, decided, result: finish(decided) };
};

const base = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Approved');
const a = run(clone(base), { data: { approved: true } });
check('decision approved', a.result.decision === 'approved', a.result.decision);
check('not timed out', a.result.timed_out === false, a.result.timed_out);
check('patch matches', a.decided.patch.status === 'approved' && a.decided.patch.timed_out === false, a.decided.patch);

console.log('Rejected');
const r = run(clone(base), { data: { approved: false } });
check('decision rejected', r.result.decision === 'rejected', r.result.decision);
check('not timed out', r.result.timed_out === false, r.result.timed_out);

console.log('Timed out');
const t = run(clone(base), { data: {} });
check('decision expired', t.result.decision === 'expired', t.result.decision);
check('timed out flag', t.result.timed_out === true, t.result.timed_out);
check('outcome still written', t.decided.patch.status === 'expired', t.decided.patch);

console.log('First decision wins');
check('write is filtered on pending',
  /status=eq\.pending$/.test(a.state.decisionUrl), a.state.decisionUrl);
check('write targets this request only',
  a.state.decisionUrl.includes('id=eq.' + a.state.requestId), a.state.decisionUrl);

console.log('Request id');
const b = run(clone(base), { data: { approved: true } });
check('uuid shape', /^[0-9a-f-]{36}$/.test(a.state.requestId), a.state.requestId);
check('fresh per call', a.state.requestId !== b.state.requestId, [a.state.requestId, b.state.requestId]);
check('audit row carries it', a.state.row.id === a.state.requestId, a.state.row);
check('output carries it', a.result.request_id === a.state.requestId, a.result.request_id);
check('audit row starts pending', a.state.row.status === 'pending', a.state.row.status);

console.log('Message content');
check('title and body only',
  a.state.message === base.title + '\n\n' + base.body, a.state.message);
check('no ids leak into the message',
  !a.state.message.includes(a.state.requestId), a.state.message);

console.log('Long body');
const long = { ...clone(base), body: 'z'.repeat(5000) };
const l = prepare(long);
check('truncated', l.truncated === true, l.truncated);
check('under the Telegram limit', l.message.length < 4096, l.message.length);
check('truncation is marked', l.message.includes('[truncated]'), true);

console.log('Input validation');
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
check('title required', throws(() => prepare({ ...clone(base), title: '' }), /title is required/), true);
check('body required', throws(() => prepare({ ...clone(base), body: '' }), /body is required/), true);
check('chat id required', throws(() => prepare({ ...clone(base), chat_id: '' }), /chat_id is required/), true);
check('timeout upper bound', throws(() => prepare({ ...clone(base), timeout_hours: 500 }), /between 0 and 168/), true);
check('timeout must be positive', throws(() => prepare({ ...clone(base), timeout_hours: 0 }), /between 0 and 168/), true);
check('timeout defaults to 24', prepare({ ...clone(base), timeout_hours: undefined }).timeoutHours === 24, true);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
