// Runs both workflows' Code nodes outside n8n. Code is read from the two workflow files;
// file reads, embeddings, search, sub-workflow calls and Telegram are canned.
// Run: node tests/run.mjs
import { readFileSync, readdirSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const indexer = load('workflow-indexer.json');
const bot = load('workflow-bot.json');
const codeOf = (wf, name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const ctx = (map) => (name) => ({
  first: () => ({ json: map[name] }),
  all: () => (Array.isArray(map[name]) ? map[name] : [map[name]]).map((json) => ({ json })),
});
const call = (wf, node, input, refs) =>
  new Function('$input', '$', codeOf(wf, node))(
    {
      first: () => ({ json: Array.isArray(input) ? input[0] : input }),
      all: () => (Array.isArray(input) ? input : [input]).map((json) => ({ json })),
    },
    ctx(refs || {}),
  );

const vaultDir = new URL('./vault/', import.meta.url);
const files = readdirSync(vaultDir).map((name) => ({
  filePath: '/vault/' + name,
  data: readFileSync(new URL(name, vaultDir), 'utf8'),
}));
const idxCfg = {
  vaultPath: '/vault', glob: '/vault/**/*.md', embeddingModel: 'text-embedding-3-small',
  embeddingsUrl: 'https://api.openai.com/v1/embeddings',
  chunksUrl: 'https://test.supabase.co/rest/v1/vault_chunks',
  tombstoneUrl: 'https://test.supabase.co/rest/v1/vault_chunks?deleted_at=is.null',
};

let failed = 0;
const check = (name, cond, got) => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + '  ->  ' + JSON.stringify(got)); }
};

console.log('Indexer: chunking');
const chunked = call(indexer, 'Chunk notes', files, { Config: idxCfg })[0].json;
check('chunks produced', chunked.chunkCount > 0, chunked.chunkCount);
check('shaped for workflow 02',
  chunked.source === 'vault' && chunked.key_field === 'id', chunked.source);
check('paths are relative to the vault',
  chunked.paths.every((p) => !p.startsWith('/')), chunked.paths);
check('heading kept with its section',
  chunked.items.some((c) => c.heading === 'Production' && /manual promote/.test(c.content)),
  chunked.items.map((c) => c.heading));
check('id is path, heading and content hash',
  chunked.items.every((c) => c.id.split('#').length === 3), chunked.items[0].id);
check('short note kept whole',
  chunked.items.some((c) => /Aeropress/.test(c.content)), chunked.items.map((c) => c.path));

console.log('Indexer: stable ids');
const again = call(indexer, 'Chunk notes', files, { Config: idxCfg })[0].json;
check('unchanged notes produce identical ids',
  again.items.map((c) => c.id).join() === chunked.items.map((c) => c.id).join(), false);
const edited = files.map((f) => f.filePath.endsWith('short.md')
  ? { ...f, data: f.data.replace('80 seconds', '90 seconds') } : f);
const afterEdit = call(indexer, 'Chunk notes', edited, { Config: idxCfg })[0].json;
const changed = afterEdit.items.filter((c) => !chunked.items.some((o) => o.id === c.id));
check('an edit changes exactly one chunk id', changed.length === 1, changed.map((c) => c.id));

console.log('Indexer: long sections are cut with overlap');
const long = [{ filePath: '/vault/long.md', data: '# Long\n\n' + 'sentence. '.repeat(400) }];
const longChunks = call(indexer, 'Chunk notes', long, { Config: idxCfg })[0].json;
check('cut into several pieces', longChunks.items.length > 1, longChunks.items.length);
check('no piece exceeds the maximum',
  longChunks.items.every((c) => c.content.length <= 1200), longChunks.items.map((c) => c.content.length));
const a = longChunks.items[0].content, b = longChunks.items[1].content;
check('pieces overlap', b.startsWith(a.slice(-100).trim().slice(0, 40)) || a.slice(-100).includes(b.slice(0, 40)),
  [a.slice(-40), b.slice(0, 40)]);

console.log('Indexer: storing');
const embedReq = call(indexer, 'Build embedding request',
  { new_items: chunked.items }, { 'Chunk notes': chunked })[0].json;
check('one embeddings call for the batch',
  Array.isArray(embedReq.body.input) && embedReq.body.input.length === chunked.items.length,
  embedReq.body.input.length);
const vectors = { data: chunked.items.map(() => ({ embedding: new Array(1536).fill(0.01) })) };
const rowsOut = call(indexer, 'Build rows', vectors, { 'Build embedding request': embedReq })[0].json;
check('a row per chunk', rowsOut.stored === chunked.items.length, rowsOut.stored);
check('every row has a vector',
  rowsOut.rows.every((r) => Array.isArray(r.embedding) && r.embedding.length === 1536), rowsOut.rows[0].path);
check('tombstone filter excludes live paths',
  chunked.paths.every((p) => rowsOut.tombstoneUrl.includes(p)), rowsOut.tombstoneUrl);
check('tombstone sets a date, does not delete',
  typeof rowsOut.tombstonePatch.deleted_at === 'string', rowsOut.tombstonePatch);

let threw = false;
try {
  call(indexer, 'Build rows', { data: [{ embedding: [0.1] }] }, { 'Build embedding request': embedReq });
} catch (e) { threw = /does not match chunk count/.test(e.message); }
check('a count mismatch throws instead of storing misaligned vectors', threw, threw);

const emptyReq = { ...embedReq, newChunks: [], paths: [] };
const emptyRows = call(indexer, 'Build rows', { data: [] }, { 'Build embedding request': emptyReq })[0].json;
check('an empty read cannot wipe the index', emptyRows.canTombstone === false, emptyRows.canTombstone);

console.log('Bot: access');
const fx = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const botCode = codeOf(bot, 'Config')
  .replace('const ALLOWED_CHAT_IDS = [];', "const ALLOWED_CHAT_IDS = ['123456789'];")
  .replace("const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://test.supabase.co';");
const botConfig = (msg) => new Function('$input', botCode)({ first: () => ({ json: msg }) })[0].json;
const allowed = botConfig(fx.telegramMessage);
check('allowed chat passes', allowed.allowed === true, allowed.allowed);
check('question captured', allowed.question === 'how does production deploy work?', allowed.question);
check('stranger rejected', botConfig(fx.strangerMessage).allowed === false, false);
check('empty message rejected',
  botConfig({ message: { chat: { id: 123456789 }, text: '   ' } }).allowed === false, false);
const gate = bot.connections['Allowed chat?'].main;
check('rejection happens before embedding',
  gate[0][0].node === 'Embed question' && gate[1][0].node === 'Ignore', gate);

console.log('Bot: answering');
const prepared = { ...allowed, searchBody: { query_embedding: [0.1], match_count: 8 } };
const matches = [
  { id: 'deploys.md#Production#abc', path: 'deploys.md', heading: 'Production', content: 'Production is a manual promote from staging.', similarity: 0.82 },
  { id: 'deploys.md#Staging#def', path: 'deploys.md', heading: 'Staging', content: 'Staging redeploys on every merge to main.', similarity: 0.71 },
];
const answerReq = call(bot, 'Build answer request', matches, { 'Prepare search': prepared })[0].json;
check('context carries paths and headings',
  /deploys\.md > Production/.test(answerReq.user), answerReq.user.slice(0, 200));
check('instructed to answer only from the notes',
  /only the notes provided/.test(answerReq.system), answerReq.system);
check('instructed to admit ignorance',
  /do not guess/.test(answerReq.system), answerReq.system);
check('schema requires the sources and the honesty flag',
  answerReq.schema.required.join() === 'answer,used_paths,enough_context', answerReq.schema.required);

const good = call(bot, 'Format reply', { ok: true, data: {
  answer: 'Production is promoted from staging by hand and needs two approvals.',
  used_paths: ['deploys.md'], enough_context: true,
} }, { 'Build answer request': answerReq })[0].json;
check('answer returned', good.answered === true, good.answered);
check('sources listed', good.text.includes('deploys.md'), good.text);
check('sources section present', /Notes used/.test(good.text), good.text);

const invented = call(bot, 'Format reply', { ok: true, data: {
  answer: 'Something.', used_paths: ['deploys.md', 'secrets/not-a-real-note.md'], enough_context: true,
} }, { 'Build answer request': answerReq })[0].json;
check('invented path dropped',
  !invented.text.includes('not-a-real-note'), invented.text);
check('invented path counted', invented.inventedPaths === 1, invented.inventedPaths);

const dunno = call(bot, 'Format reply', { ok: true, data: {
  answer: 'I do not know: the notes do not cover that.', used_paths: [], enough_context: false,
} }, { 'Build answer request': answerReq })[0].json;
check('admission passed through', /do not know/.test(dunno.text), dunno.text);
check('no sources on an admission', !/Notes used/.test(dunno.text), dunno.text);
check('not counted as answered', dunno.answered === false, dunno.answered);

const noMatches = call(bot, 'Build answer request', [], { 'Prepare search': prepared })[0].json;
check('empty search still builds a request', noMatches.matchCount === 0, noMatches.matchCount);
const noMatchReply = call(bot, 'Format reply', { ok: true, data: {
  answer: 'I do not know: nothing in the vault covers that.', used_paths: [], enough_context: true,
} }, { 'Build answer request': noMatches })[0].json;
check('no matches means the admission path', noMatchReply.answered === false, noMatchReply.answered);

const broken = call(bot, 'Format reply', { ok: false, data: null },
  { 'Build answer request': answerReq })[0].json;
check('failed call apologises, does not invent',
  /could not get an answer/.test(broken.text) && broken.answered === false, broken.text);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\nFAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
