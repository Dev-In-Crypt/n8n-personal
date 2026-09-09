// Runs the Code nodes outside n8n. Code is read from workflow.json; fetches, the three
// sub-workflow calls and the write are canned. Run: node tests/run.mjs
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const cfg = { chatId: '123', approvalTimeoutHours: 24, draftsUrl: 'https://test.supabase.co/rest/v1/post_drafts' };
const ctx = (map) => (name) => ({
  first: () => ({ json: map[name] }),
  all: () => (Array.isArray(map[name]) ? map[name] : [map[name]]).map((json) => ({ json })),
});
const run = (node, input, refs) =>
  new Function('$input', '$', codeOf(node))(
    { first: () => ({ json: input }), all: () => (Array.isArray(input) ? input : [input]).map((json) => ({ json })) },
    ctx(refs || {}),
  )[0].json;

const normalise = (fetched, products) =>
  new Function('$input', '$', codeOf('Normalise entries'))(
    { all: () => fetched.map((json) => ({ json })) },
    ctx({ 'Load products': products, Config: cfg }),
  )[0].json;

const fx = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Normalise entries');
const n = normalise(clone(fx.fetched), clone(fx.products));
check('four entries, draft skipped', n.items.length === 4, n.items.map((e) => e.id));
check('no unpublished release',
  !n.items.some((e) => e.id.includes('v1.5.0-rc1')), n.items.map((e) => e.id));
check('github defaults handled',
  n.items[0].title === 'Offline mode' && n.items[0].url.includes('releases/tag/v1.4.0'), n.items[0]);
check('field map applied',
  n.items.find((e) => e.id.endsWith('d-1')).title === 'Search across all docs', n.items[2]);
check('ids namespaced by product',
  n.items[0].id.startsWith('changelog:lunela:') &&
  n.items[2].id.startsWith('changelog:docsite:'), [n.items[0].id, n.items[2].id]);
check('shaped for workflow 02', n.source === 'changelog' && n.key_field === 'id', n.source);

console.log('Occasion prompt');
const occReq = run('Build occasion request', { new_items: n.items }, { 'Normalise entries': n });
check('all entries in the prompt', occReq.count === 4, occReq.count);
check('internal work is excluded by instruction',
  /Skip refactors, dependency bumps, CI changes and internal cleanups/.test(occReq.user), occReq.user.slice(0, 120));
check('schema demands evidence',
  occReq.schema.properties.occasions.items.required.includes('evidence_quote'), occReq.schema);

console.log('Occasion verification');
const entryA = n.items[0];
const entryDocs = n.items.find((e) => e.id.endsWith('d-1'));
const entryNoUrl = n.items.find((e) => e.id.endsWith('d-2'));
const goodOcc = { entry_id: entryA.id, headline: 'Offline bedtime', audience_value: 'works on a plane',
  evidence_quote: 'Stories now download for offline playback' };
const verified = run('Verify occasions', { ok: true, data: { occasions: [goodOcc] } },
  { 'Build occasion request': occReq });
check('verbatim quote accepted', verified.occasionCount === 1, verified.occasionCount);
check('source url carried from the entry',
  verified.occasions[0].source_url === entryA.url, verified.occasions[0].source_url);

const bad = run('Verify occasions', { ok: true, data: { occasions: [
  { ...goodOcc, evidence_quote: 'Stories can be downloaded for the plane' },
  { entry_id: 'changelog:lunela:does-not-exist', headline: 'Ghost', audience_value: 'x', evidence_quote: 'Stories now download for offline playback' },
  { entry_id: entryNoUrl.id, headline: 'No link', audience_value: 'x', evidence_quote: 'This one has no permalink.' },
] } }, { 'Build occasion request': occReq });
check('paraphrase dropped', bad.occasionCount === 0, bad.occasions);
check('unknown entry id dropped', bad.rejectedOccasions === 3, bad.rejectedOccasions);

const docsOcc = { entry_id: entryDocs.id, headline: 'Search everywhere', audience_value: 'find things faster',
  evidence_quote: 'Full text search now spans every version of the docs.' };
const both = run('Verify occasions', { ok: true, data: { occasions: [goodOcc, docsOcc] } },
  { 'Build occasion request': occReq });
check('two occasions survive', both.occasionCount === 2, both.occasionCount);

console.log('Drafts');
const draftReq = run('Build drafts request', both, {});
check('no links asked of the model', /Do not include links/.test(draftReq.user), draftReq.user.slice(0, 200));
const drafts = { ok: true, data: { drafts: [
  { occasion_id: entryA.id, platform: 'short', text: 'Bedtime stories now work offline.', cta: 'Update the app' },
  { occasion_id: entryA.id, platform: 'long', text: 'Offline playback landed today. Download once, play anywhere.' },
  { occasion_id: entryDocs.id, platform: 'short', text: 'Docs search now covers every version.' },
  { occasion_id: 'changelog:lunela:ghost', platform: 'short', text: 'Draft for an occasion that does not exist.' },
  { occasion_id: entryDocs.id, platform: 'long', text: '   ' },
] } };
const prepared = run('Prepare approval', drafts, { 'Build drafts request': draftReq });
check('three usable drafts', prepared.draftCount === 3, prepared.draftCount);
check('draft for unknown occasion dropped',
  !prepared.rows.some((r) => r.text.includes('does not exist')), prepared.rows.map((r) => r.text));
check('empty draft dropped',
  !prepared.rows.some((r) => r.text.trim() === ''), prepared.rows.length);
check('every row has a source url',
  prepared.rows.every((r) => typeof r.source_url === 'string' && r.source_url.startsWith('http')),
  prepared.rows.map((r) => r.source_url));
check('source url matches its entry, not the model',
  prepared.rows.filter((r) => r.occasion === 'Offline bedtime').every((r) => r.source_url === entryA.url),
  prepared.rows[0].source_url);
check('every row carries its evidence',
  prepared.rows.every((r) => r.evidence && r.evidence.length >= 12), prepared.rows.map((r) => r.evidence));
check('review text shows drafts and links',
  prepared.body.includes('Bedtime stories now work offline.') && prepared.body.includes(entryA.url),
  prepared.body.slice(0, 200));
check('gate input shaped for workflow 04',
  typeof prepared.title === 'string' && typeof prepared.body === 'string'
  && prepared.chat_id === '123' && prepared.timeout_hours === 24, prepared.title);

console.log('The gate');
const approved = run('Stamp approval', { decision: 'approved', request_id: 'aaaa-bbbb' },
  { 'Prepare approval': prepared });
check('rows written on approval', approved.stored === 3, approved.stored);
check('approval id stamped',
  approved.rows.every((r) => r.approval_id === 'aaaa-bbbb'), approved.rows[0]);
check('status ready', approved.rows.every((r) => r.status === 'ready'), approved.rows[0].status);

console.log('No publishing');
const publishing = wf.nodes.filter((node) =>
  /telegram|slack|twitter|linkedIn|gmail|emailSend|mastodon/i.test(node.type));
check('no node that posts anywhere', publishing.length === 0, publishing.map((p) => p.type));
const writes = wf.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest'
  && node.parameters.method === 'POST');
check('exactly one write, into the queue',
  writes.length === 1 && writes[0].name === 'Queue drafts', writes.map((w) => w.name));
const rejectedBranch = wf.connections['Approved?'].main[1];
check('rejected branch ends in a no-op',
  rejectedBranch.length === 1 && rejectedBranch[0].node === 'Not approved, nothing written',
  rejectedBranch);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
