// Runs the monitor's Code nodes outside n8n. Code is read from workflow.json; the model
// calls, history read, write and Telegram are canned. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const fx = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

const cfg = {
  chatId: '123', model: 'claude-sonnet-4-5', maxTokens: 700, runDate: '2026-09-14',
  runsUrl: 'https://test.supabase.co/rest/v1/visibility_runs',
};
const ctx = (map) => (name) => ({
  first: () => ({ json: map[name] }),
  all: () => (Array.isArray(map[name]) ? map[name] : [map[name]]).map((json) => ({ json })),
});

const buildRequests = (prompts, brands) =>
  new Function('$input', '$', codeOf('Build measurement requests'))(
    { all: () => prompts.map((json) => ({ json })) },
    ctx({ Config: cfg, 'Load brands': brands }),
  ).map((i) => i.json);

const detect = (answers, requests) =>
  new Function('$input', '$', codeOf('Detect mentions'))(
    { all: () => answers.map((json) => ({ json })) },
    ctx({ Config: cfg, 'Build measurement requests': requests }),
  )[0].json;

const report = (history, state) =>
  new Function('$input', '$', codeOf('Compare and report'))(
    { all: () => history.map((json) => ({ json })) },
    ctx({ 'Detect mentions': state }),
  )[0].json;

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

const requests = buildRequests(clone(fx.prompts), [clone(fx.brand)]);
console.log('Build measurement requests');
check('one request per prompt', requests.length === 5, requests.length);
check('prompt asked as written',
  requests[0].body.messages[0].content === fx.prompts[0].text, requests[0].body.messages[0]);
check('no schema or json instruction in the request',
  !JSON.stringify(requests[0].body).toLowerCase().includes('json'), requests[0].body);
check('model carried from config', requests[0].body.model === cfg.model, requests[0].body.model);

const state = detect(clone(fx.answers), requests);
const byPrompt = Object.fromEntries(state.rows.map((r) => [r.prompt_id, r]));

console.log('Detection');
check('four measured, one failed call skipped',
  state.measured === 4 && state.failed === 1, [state.measured, state.failed]);
check('p1 mentioned', byPrompt.p1.mentioned === true, byPrompt.p1);
check('p1 position is 2, after Moonlit', byPrompt.p1.position === 2, byPrompt.p1.position);
check('p2 matched by alias', byPrompt.p2.mentioned === true, byPrompt.p2);
check('p2 domain cited', byPrompt.p2.cited === true, byPrompt.p2.cited);
check('p2 position is 1', byPrompt.p2.position === 1, byPrompt.p2.position);
check('p3 not mentioned', byPrompt.p3.mentioned === false, byPrompt.p3);
check('p3 position null', byPrompt.p3.position === null, byPrompt.p3.position);
check('p3 alias of a competitor still detected, brand still absent',
  byPrompt.p3.mentioned === false, byPrompt.p3);
check('"Lunelabs" and "Lune" do not count as "Lunela"',
  byPrompt.p4.mentioned === false, byPrompt.p4);
check('failed prompt is absent, not recorded as a miss',
  byPrompt.p5 === undefined, Object.keys(byPrompt));

console.log('Rows');
check('run date on every row', state.rows.every((r) => r.run_date === cfg.runDate), state.rows[0]);
check('model on every row', state.rows.every((r) => r.model === cfg.model), state.rows[0]);
check('answer kept for auditing', state.rows.every((r) => typeof r.answer === 'string'), state.rows[0]);
const store = wf.nodes.find((n) => n.name === 'Store measurements');
check('insert ignores duplicates',
  store.parameters.headerParameters.parameters.some((h) =>
    h.name === 'Prefer' && h.value.includes('resolution=ignore-duplicates')),
  store.parameters.headerParameters);

console.log('Comparison with history');
const history = [
  { run_date: '2026-09-07', brand_id: 'lunela', prompt_id: 'p1', mentioned: true, position: 1, cited: false, model: cfg.model },
  { run_date: '2026-09-07', brand_id: 'lunela', prompt_id: 'p2', mentioned: true, position: 1, cited: true, model: cfg.model },
  { run_date: '2026-09-07', brand_id: 'lunela', prompt_id: 'p3', mentioned: true, position: 3, cited: false, model: cfg.model },
  { run_date: '2026-09-07', brand_id: 'lunela', prompt_id: 'p4', mentioned: false, position: null, cited: false, model: cfg.model },
  { run_date: '2026-08-31', brand_id: 'lunela', prompt_id: 'p1', mentioned: false, position: null, cited: false, model: cfg.model },
];
const rep = report(history, state);
check('previous run is the latest earlier date', rep.previousDate === '2026-09-07', rep.previousDate);
check('current share is 2 of 4', Math.abs(rep.nowShare - 0.5) < 1e-9, rep.nowShare);
check('previous share is 3 of 4', Math.abs(rep.prevShare - 0.75) < 1e-9, rep.prevShare);
check('delta is negative', rep.delta < 0, rep.delta);
check('p3 counted as lost', rep.lost === 1, rep.lost);
check('nothing gained', rep.gained === 0, rep.gained);
check('delta shown in the message', /change -25 points/.test(rep.text), rep.text);
check('failed prompt reported', /1 prompt failed/.test(rep.text), rep.text);

console.log('History from another model is ignored');
const otherModel = report(history.map((h) => ({ ...h, model: 'some-other-model' })), state);
check('no baseline', otherModel.prevShare === null && otherModel.delta === null, otherModel.prevShare);
check('message says so', /No earlier run to compare against yet/.test(otherModel.text), otherModel.text);

console.log('First ever run');
const firstRun = report([], state);
check('no delta invented', firstRun.delta === null, firstRun.delta);
check('still reports the current share', /Mentioned in 2 of 4/.test(firstRun.text), firstRun.text);

console.log('Report');
check('model and run date in the footer',
  rep.text.includes('Model claude-sonnet-4-5, run 2026-09-14'), rep.text);
check('states it is measurement only', /no causes/.test(rep.text), rep.text);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
