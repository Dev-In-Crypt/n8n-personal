// Runs the "Build payload" node logic outside n8n: $input and $getWorkflowStaticData
// are stubbed, then the scenarios from expected.md are checked. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const code = wf.nodes.find((n) => n.name === 'Build payload').parameters.jsCode;

const store = {};
const run = (payload) => {
  const $input = { first: () => ({ json: payload }) };
  const $getWorkflowStaticData = () => store;
  const fn = new Function('$input', '$getWorkflowStaticData', code);
  return fn($input, $getWorkflowStaticData)[0].json;
};

const base = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (name, cond, got) => {
  if (cond) { console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Run 1: first failure');
const r1 = run(clone(base));
check('isDuplicate is false', r1.isDuplicate === false, r1.isDuplicate);
check('workflow name parsed', r1.workflowName === 'Demo: source collector', r1.workflowName);
check('failed node parsed', r1.failedNode === 'HTTP Request', r1.failedNode);
check('execution url built', r1.url === 'http://localhost:5678/workflow/wf-demo-1/executions/231', r1.url);
check('html escaped', r1.text.includes('&amp;') && r1.text.includes('&lt;secret&gt;'), r1.text.slice(0, 200));
check('no stack trace', !r1.text.includes('TCPConnectWrap'), true);

console.log('Run 2: same payload inside the hour');
const r2 = run(clone(base));
check('isDuplicate is true', r2.isDuplicate === true, r2.isDuplicate);

console.log('Run 3: different error text');
const other = clone(base);
other.execution.error.message = 'ETIMEDOUT';
const r3 = run(other);
check('isDuplicate is false', r3.isDuplicate === false, r3.isDuplicate);

console.log('Run 4: mark older than an hour');
for (const k of Object.keys(store.alerts)) store.alerts[k] = Date.now() - 61 * 60 * 1000;
const r4 = run(clone(base));
check('isDuplicate is false', r4.isDuplicate === false, r4.isDuplicate);
check('stale entries evicted', Object.keys(store.alerts).length === 1, Object.keys(store.alerts));

console.log('Long message truncation');
const long = clone(base);
long.execution.error.message = 'x'.repeat(900);
const r5 = run(long);
check('message is 500 chars', r5.message.length === 500, r5.message.length);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
