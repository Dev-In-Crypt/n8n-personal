// Offline test suite for workflow 13.
//
// Every test pulls the jsCode out of workflow.json and runs it, so a green run says
// something about the file that ships rather than about a copy of it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DateTime } from 'luxon';

const here = dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(join(here, '..', 'workflow.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const OWNER = 'Dev-In-Crypt';
const REPO = 'n8n-personal';
const CHAT = '-1001234567890';

function nodeOf(name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error('no node named ' + name);
  return n;
}
function codeOf(name) {
  const n = nodeOf(name);
  if (n.type !== 'n8n-nodes-base.code') throw new Error(name + ' is not a Code node');
  return n.parameters.jsCode;
}
// The shipped file leaves all three placeholders blank on purpose; a separate test asserts
// they are still blank.
function configured(name) {
  return codeOf(name)
    .replace("const GITHUB_OWNER = '';", `const GITHUB_OWNER = '${OWNER}';`)
    .replace("const GITHUB_REPO = '';", `const GITHUB_REPO = '${REPO}';`)
    .replace("const ALERT_CHAT_ID = '';", `const ALERT_CHAT_ID = '${CHAT}';`);
}

const wrap = (arr) => ({
  all: () => arr.map((j) => ({ json: j })),
  first: () => ({ json: arr[0] }),
  last: () => ({ json: arr[arr.length - 1] }),
});

function run(nodeName, { input = [], nodes = {}, raw = false } = {}) {
  const $ = (name) => {
    // A node that did not run throws when asked for, exactly as it does in n8n. "Plan
    // commit" relies on that for the branch-does-not-exist case, so the stub must behave
    // the same way rather than quietly returning nothing.
    if (!(name in nodes)) throw new Error('Referenced node is unexecuted: ' + name);
    return wrap(nodes[name]);
  };
  const fn = new AsyncFunction('$input', '$', 'DateTime', raw ? codeOf(nodeName) : configured(nodeName));
  return fn(wrap(input), $, DateTime);
}

let pass = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { failures.push([name, e.message]); console.log('  FAIL ' + name + ' -- ' + e.message); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || 'value') + ': got ' + a + ', wanted ' + b);
}
function ok(cond, what) { if (!cond) throw new Error(what); }
async function throws(fn, fragment) {
  try { await fn(); } catch (e) {
    if (!e.message.includes(fragment)) throw new Error('threw "' + e.message + '", wanted "' + fragment + '"');
    return;
  }
  throw new Error('did not throw, wanted "' + fragment + '"');
}

const http = (body, statusCode = 200) => [{ body, statusCode, headers: {} }];
const prepared = async () => (await run('Prepare', { input: [{}] }))[0].json;

console.log('\nPrepare');
await check('refuses to run without a repository', () => throws(
  () => run('Prepare', { input: [{}], raw: true }), 'GITHUB_OWNER and GITHUB_REPO'));
await check('refuses to run without an alert chat', () => throws(async () => {
  const src = codeOf('Prepare')
    .replace("const GITHUB_OWNER = '';", `const GITHUB_OWNER = '${OWNER}';`)
    .replace("const GITHUB_REPO = '';", `const GITHUB_REPO = '${REPO}';`);
  return new AsyncFunction('$input', '$', 'DateTime', src)(wrap([{}]), () => {}, DateTime);
}, 'ALERT_CHAT_ID is not configured'));
await check('the shipped file names no repository and no chat', () => {
  const src = codeOf('Prepare');
  for (const line of ["const GITHUB_OWNER = '';", "const GITHUB_REPO = '';", "const ALERT_CHAT_ID = '';"]) {
    ok(src.includes(line), 'missing placeholder: ' + line);
  }
});
await check('the backup branch is never main', async () => {
  const s = await prepared();
  eq(s.branch, 'backup', 'branch');
  ok(!/\/(main|master)$/.test(s.refUrl), 'refUrl points at a trunk branch: ' + s.refUrl);
  ok(s.updateRefUrl.endsWith('/git/refs/heads/backup'), 'updateRefUrl: ' + s.updateRefUrl);
});
await check('the listing asks n8n not to send captured run data', async () => {
  ok((await prepared()).listUrl.includes('excludePinnedData=true'), 'listUrl lacks excludePinnedData');
});
await check('the date is local, not utc', async () => {
  const s = await prepared();
  eq(s.date, DateTime.now().setZone(s.timezone).toFormat('yyyy-LL-dd'), 'date');
});

console.log('\nFan out workflows');
const fanOut = async (body) => run('Fan out workflows', {
  input: http(body), nodes: { Prepare: [await prepared()] } });
await check('one item per workflow, each with its own url', async () => {
  const out = await fanOut({ data: [{ id: 'a1', name: 'One' }, { id: 'b2', name: 'Two' }] });
  eq(out.length, 2, 'item count');
  ok(out[0].json.url.endsWith('/api/v1/workflows/a1'), 'url: ' + out[0].json.url);
});
await check('an empty instance refuses rather than wiping the backup', () => throws(
  () => fanOut({ data: [] }), 'refusing to commit an empty backup'));
await check('a second page refuses rather than backing up a subset', () => throws(
  () => fanOut({ data: [{ id: 'a', name: 'A' }], nextCursor: 'more' }), 'more workflows than one page'));
await check('an absurd number of workflows refuses', () => throws(
  () => fanOut({ data: Array.from({ length: 501 }, (_, i) => ({ id: String(i), name: 'w' + i })) }),
  'above the cap'));
await check('a response that is not a list refuses', () => throws(
  () => fanOut({ message: 'unauthorized' }), 'did not come back as a list'));

console.log('\nNormalise');
const wfBody = (over = {}) => ({
  id: 'abc123', name: '[05] Morning digest', active: false,
  nodes: [
    { id: 'n2', name: 'Zulu', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [200, 0], parameters: {} },
    { id: 'n1', name: 'Alpha', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [0, 0],
      parameters: { url: 'https://example.com' },
      credentials: { supabaseApi: { id: 'cred-77', name: 'Supabase (dev)' } } },
  ],
  connections: { Alpha: { main: [[{ node: 'Zulu', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
  updatedAt: '2026-09-14T01:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  versionId: 'v-999', triggerCount: 17, meta: { instanceId: 'inst-abc' }, shared: [{ role: 'owner' }],
  pinData: { Alpha: [{ json: { secret: 'captured run data' } }] },
  staticData: { lastCursor: 'abc' },
  ...over,
});
async function normalise(bodies, { statuses = [] } = {}) {
  const state = await prepared();
  const reqs = bodies.map((b, i) => ({ id: b.id || 'x' + i, name: b.name || 'w' + i, url: 'u' + i }));
  const responses = bodies.map((b, i) => ({ body: b, statusCode: statuses[i] ?? 200, headers: {} }));
  const [o] = await run('Normalise', {
    input: responses, nodes: { Prepare: [state], 'Fan out workflows': reqs } });
  return o.json;
}
const fileAt = (r, path) => r.files.find((f) => f.path === path);

await check('one file per workflow, named by id and slug', async () => {
  const r = await normalise([wfBody()]);
  ok(fileAt(r, 'backup/workflows/abc123-05-morning-digest.json'), r.files.map((f) => f.path).join(', '));
  eq(r.workflowCount, 1, 'workflowCount');
});
await check('every volatile field is stripped', async () => {
  const r = await normalise([wfBody()]);
  const j = JSON.parse(fileAt(r, 'backup/workflows/abc123-05-morning-digest.json').content);
  for (const k of ['updatedAt', 'createdAt', 'versionId', 'triggerCount', 'meta', 'shared']) {
    eq(j[k], undefined, 'field survived: ' + k);
  }
});
await check('captured run data never reaches the backup', async () => {
  const r = await normalise([wfBody()]);
  const content = fileAt(r, 'backup/workflows/abc123-05-morning-digest.json').content;
  ok(!content.includes('captured run data'), 'pinData was written to the backup');
  ok(!content.includes('lastCursor'), 'staticData was written to the backup');
});
await check('a credential keeps its name and loses its id', async () => {
  const r = await normalise([wfBody()]);
  const j = JSON.parse(fileAt(r, 'backup/workflows/abc123-05-morning-digest.json').content);
  const node = j.nodes.find((n) => n.name === 'Alpha');
  eq(node.credentials, { supabaseApi: { name: 'Supabase (dev)' } }, 'credential reference');
});
await check('nodes come out in a stable order whatever order they arrived in', async () => {
  const a = await normalise([wfBody()]);
  const shuffled = wfBody();
  shuffled.nodes = [...shuffled.nodes].reverse();
  const b = await normalise([shuffled]);
  eq(fileAt(a, 'backup/workflows/abc123-05-morning-digest.json').content,
     fileAt(b, 'backup/workflows/abc123-05-morning-digest.json').content,
     'the same workflow produced two different files');
});
await check('object keys are sorted, so a diff follows the change', async () => {
  const r = await normalise([wfBody()]);
  const lines = fileAt(r, 'backup/workflows/abc123-05-morning-digest.json').content.split('\n');
  const top = lines.filter((l) => /^  "/.test(l)).map((l) => l.trim().split('"')[1]);
  eq([...top].sort(), top, 'top-level keys are not sorted: ' + top.join(', '));
});
await check('the file is many lines, not one', async () => {
  const r = await normalise([wfBody()]);
  const content = fileAt(r, 'backup/workflows/abc123-05-morning-digest.json').content;
  ok(content.split('\n').length > 20, 'the whole workflow is on ' + content.split('\n').length + ' line(s)');
  ok(content.endsWith('\n'), 'no trailing newline');
});
await check('renaming one node changes one line', async () => {
  const before = await normalise([wfBody()]);
  const after = wfBody();
  after.nodes = after.nodes.map((n) => (n.name === 'Zulu' ? { ...n, name: 'Zulu renamed' } : n));
  const renamed = await normalise([after]);
  const a = fileAt(before, 'backup/workflows/abc123-05-morning-digest.json').content.split('\n');
  const b = fileAt(renamed, 'backup/workflows/abc123-05-morning-digest.json').content.split('\n');
  eq(a.length, b.length, 'line count changed');
  const differing = a.filter((l, i) => l !== b[i]).length;
  // The name appears in the node and in the connections map it is the target of.
  ok(differing <= 2, 'a one-node rename moved ' + differing + ' lines');
});
await check('positions are left alone', async () => {
  const r = await normalise([wfBody()]);
  const j = JSON.parse(fileAt(r, 'backup/workflows/abc123-05-morning-digest.json').content);
  eq(j.nodes.find((n) => n.name === 'Alpha').position, [0, 0], 'position');
});
await check('credentials.md lists type and name, and no values', async () => {
  const r = await normalise([wfBody()]);
  const md = fileAt(r, 'backup/credentials.md').content;
  ok(md.includes('`supabaseApi`'), 'type missing: ' + md);
  ok(md.includes('Supabase (dev)'), 'name missing');
  ok(!md.includes('cred-77'), 'the credential id leaked into credentials.md');
  eq(r.credentialCount, 1, 'credentialCount');
});
await check('credentials.md carries no date, or every day would be a commit', async () => {
  const r = await normalise([wfBody()]);
  const md = fileAt(r, 'backup/credentials.md').content;
  ok(!/\d{4}-\d{2}-\d{2}/.test(md), 'a date appears in credentials.md: ' + md);
});
await check('a workflow referencing no credentials still produces the file', async () => {
  const bare = wfBody();
  bare.nodes = bare.nodes.map(({ credentials, ...n }) => n);
  const r = await normalise([bare]);
  ok(fileAt(r, 'backup/credentials.md').content.includes('no workflow references a credential'),
     fileAt(r, 'backup/credentials.md').content);
});
await check('a workflow that could not be read stops the backup', () => throws(
  () => normalise([wfBody()], { statuses: [500] }), 'this backup would be incomplete'));
await check('a response with no nodes stops the backup', () => throws(
  () => normalise([{ id: 'a', name: 'A', message: 'nope' }]), 'carried no nodes'));
// Fixtures, not secrets: every string below is an invented or published example value,
// present so the scan can be proven to catch the shape. Nothing here is live.
for (const [label, poison] of [
  ['a json web token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'],
  ['an openai-style key', 'sk-proj1234567890abcdefghijklmnop'],
  ['a github token', 'ghp_1234567890abcdefghijklmnopqrstuvwxyz'],
  ['an aws key id', 'AKIAIOSFODNN7EXAMPLE'],
  ['a telegram bot token', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'],
  ['a private key', '-----BEGIN RSA PRIVATE KEY-----'],
  ['a bearer header', 'Bearer abcdefghijklmnopqrstuvwxyz123456'],
]) {
  await check('refuses to back up ' + label, () => throws(async () => {
    const poisoned = wfBody();
    poisoned.nodes[0].parameters = { note: poison };
    return normalise([poisoned]);
  }, 'refusing to back up'));
}
await check('an ordinary workflow passes the scan', async () => {
  const r = await normalise([wfBody()]);
  ok(r.files.length === 2, 'files: ' + r.files.length);
});
await check('the tree replaces the branch rather than merging into it', async () => {
  const r = await normalise([wfBody()]);
  eq(r.treePayload.base_tree, undefined, 'a base_tree would leave deleted workflows behind');
  eq(r.treePayload.tree.length, r.files.length, 'tree length');
  for (const t of r.treePayload.tree) eq([t.mode, t.type], ['100644', 'blob'], 'tree entry');
});
await check('files are listed in a stable order', async () => {
  const r = await normalise([wfBody({ id: 'zzz', name: 'Zed' }), wfBody({ id: 'aaa', name: 'Ay' })]);
  const paths = r.files.map((f) => f.path);
  eq([...paths].sort(), paths, 'paths are not sorted: ' + paths.join(', '));
});
await check('an awkward workflow name still produces a usable filename', async () => {
  const r = await normalise([wfBody({ id: 'q1', name: '[12a] LLM cost guard / v2!!' })]);
  const p = r.files.find((f) => f.path.startsWith('backup/workflows/q1-')).path;
  ok(/^backup\/workflows\/q1-[a-z0-9-]+\.json$/.test(p), 'path: ' + p);
  ok(!p.includes('--'), 'doubled separators in ' + p);
});

console.log('\nPlan commit');
async function plan({ refStatus = 200, parent = 'parent-sha', baseTree = 'tree-old', newTree = 'tree-new' } = {}) {
  const state = await normalise([wfBody()]);
  const nodes = {
    Normalise: [state],
    'Get branch head': [{ statusCode: refStatus, body: refStatus === 200 ? { object: { sha: parent } } : { message: 'Not Found' } }],
  };
  if (refStatus === 200 && baseTree !== null) nodes['Get base commit'] = [{ body: { tree: { sha: baseTree } } }];
  const [o] = await run('Plan commit', { input: [{ body: { sha: newTree } }], nodes });
  return o.json;
}
await check('a changed tree is a commit', async () => {
  const r = await plan({ baseTree: 'tree-old', newTree: 'tree-new' });
  eq(r.changed, true, 'changed');
  eq(r.commitPayload.parents, ['parent-sha'], 'parents');
  eq(r.commitPayload.tree, 'tree-new', 'tree');
});
await check('an identical tree is no commit', async () => {
  eq((await plan({ baseTree: 'same', newTree: 'same' })).changed, false, 'changed');
});
await check('a missing branch is a first commit with no parent', async () => {
  const r = await plan({ refStatus: 404 });
  eq(r.branchExisted, false, 'branchExisted');
  eq(r.changed, true, 'changed');
  eq(r.commitPayload.parents, [], 'parents');
});
await check('an unreadable base commit commits rather than skipping the backup', async () => {
  const r = await plan({ baseTree: null, newTree: 'tree-new' });
  eq(r.changed, true, 'changed');
});
await check('any other github answer stops the run', () => throws(
  () => plan({ refStatus: 403 }), 'GitHub answered 403'));
await check('a missing tree sha stops the run', () => throws(async () => {
  const state = await normalise([wfBody()]);
  return run('Plan commit', { input: [{ body: {} }], nodes: {
    Normalise: [state],
    'Get branch head': [{ statusCode: 404, body: {} }] } });
}, 'did not return a sha'));
await check('the commit message is the date the spec asked for', async () => {
  const r = await plan();
  eq(r.commitPayload.message, 'backup: ' + r.date, 'message');
});
await check('the file payloads are dropped once github has them', async () => {
  const r = await plan();
  eq(r.files, undefined, 'files were carried past the tree upload');
  eq(r.treePayload, undefined, 'treePayload was carried past the tree upload');
});

console.log('\nReport');
await check('the summary names the repository, branch and counts', async () => {
  const state = await plan();
  const [o] = await run('Report', {
    input: [{ body: { ref: 'refs/heads/backup' } }],
    nodes: { 'Plan commit': [state], 'Create commit': [{ body: { sha: 'abcdef1234567890' } }] } });
  const m = o.json.message;
  for (const part of ['Dev-In-Crypt/n8n-personal', 'backup', state.date, 'Workflows: 1']) {
    ok(m.includes(part), 'missing "' + part + '" in: ' + m);
  }
  eq(o.json.commitSha, 'abcdef1234567890', 'commitSha');
  ok(m.includes('abcdef1'), 'short sha missing');
});
await check('a newly created branch is called out', async () => {
  const state = await plan({ refStatus: 404 });
  const [o] = await run('Report', {
    input: [{ body: {} }],
    nodes: { 'Plan commit': [state], 'Create commit': [{ body: { sha: 'deadbeef' } }] } });
  ok(o.json.message.includes('did not exist and was created'), o.json.message);
});

console.log('\nWorkflow file');
await check('it runs at 03:00 as the spec asked', () => {
  const r = nodeOf('Every day at 03:00').parameters.rule.interval[0];
  eq([r.triggerAtHour, r.triggerAtMinute], [3, 0], 'schedule');
});
await check('the backup never writes to main', () => {
  const src = JSON.stringify(wf);
  ok(!/refs\/heads\/main/.test(src), 'a reference to main appears in the workflow');
  ok(!/heads\/master/.test(src), 'a reference to master appears in the workflow');
});
await check('nothing is written to github before the tree is compared', () => {
  // Create commit and the two ref nodes must all sit behind "Anything changed?".
  const reach = (start) => {
    const seen = new Set([start]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [from, c] of Object.entries(wf.connections)) {
        if (!seen.has(from)) continue;
        for (const b of c.main) for (const l of b || []) if (!seen.has(l.node)) { seen.add(l.node); grew = true; }
      }
    }
    return seen;
  };
  const afterGate = reach('Anything changed?');
  for (const n of ['Create commit', 'Move branch', 'Create branch']) {
    ok(afterGate.has(n), n + ' can run without passing the changed check');
  }
  // And the tree upload, which creates blobs but changes no ref, is the only write before it.
  const writes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest'
    && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(n.parameters.method));
  eq(writes.map((n) => n.name).sort(), ['Create branch', 'Create commit', 'Create tree', 'Move branch'], 'write nodes');
});
await check('the n8n api and github use separate credentials', () => {
  const byCred = {};
  for (const n of wf.nodes.filter((x) => x.parameters.nodeCredentialType)) {
    (byCred[n.parameters.nodeCredentialType] ||= []).push(n.name);
  }
  eq(Object.keys(byCred).sort(), ['githubApi', 'n8nApi'], 'credential types');
  eq(byCred.n8nApi.sort(), ['Fetch each workflow', 'List workflows'], 'n8n api nodes');
});
await check('every github call declares an api version', () => {
  for (const n of wf.nodes.filter((x) => x.parameters.nodeCredentialType === 'githubApi')) {
    const h = n.parameters.headerParameters.parameters.map((p) => p.name);
    ok(h.includes('X-GitHub-Api-Version'), n.name + ' sends no api version');
    ok(h.includes('Accept'), n.name + ' sends no Accept header');
  }
});
await check('reading a missing branch is tolerated, every other call is not', () => {
  const lenient = wf.nodes.filter((n) => n.parameters.options
    && n.parameters.options.response && n.parameters.options.response.response.neverError);
  eq(lenient.map((n) => n.name).sort(), ['Fetch each workflow', 'Get branch head'], 'neverError nodes');
});
await check('the workflow ships inactive and carries no credentials', () => {
  eq(wf.active, false, 'active');
  eq(wf.nodes.filter((n) => n.credentials).map((n) => n.name), [], 'bundled credentials');
});
await check('nothing restores from a backup automatically', () => {
  // Out of scope in SPEC.md. No node may write to the n8n API.
  const n8nWrites = wf.nodes.filter((n) => n.parameters.nodeCredentialType === 'n8nApi'
    && n.parameters.method && n.parameters.method !== 'GET');
  eq(n8nWrites.map((n) => n.name), [], 'a node writes back to the n8n instance');
});
await check('every node is reachable from the trigger', () => {
  const seen = new Set(['Every day at 03:00']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, c] of Object.entries(wf.connections)) {
      if (!seen.has(from)) continue;
      for (const b of c.main) for (const l of b || []) if (!seen.has(l.node)) { seen.add(l.node); grew = true; }
    }
  }
  eq(wf.nodes.filter((n) => !seen.has(n.name)).map((n) => n.name), [], 'orphan nodes');
});
await check('nothing in the file is written in anything but English', () => {
  // Escaped rather than written literally, so this file does not itself trip the scan.
  eq(JSON.stringify(wf).match(/[\u0400-\u04FF]/g), null, 'cyrillic found');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
