// Offline test suite for workflow 16. Code is read out of workflow.json, never copied.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DateTime } from 'luxon';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const wf = load('../workflow.json');
const wf03 = load('../../03-llm-structured/workflow.json');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const nodeOf = (w, name) => {
  const n = w.nodes.find((x) => x.name === name);
  if (!n) throw new Error('no node named ' + name);
  return n;
};
const codeOf = (name, w = wf) => nodeOf(w, name).parameters.jsCode;
const configured = (src) => src
  .replace("const VAULT_PATH = '';", "const VAULT_PATH = '/data/vault';")
  .replace("const ALLOWED_CHAT_IDS = [];", "const ALLOWED_CHAT_IDS = ['777'];")
  .replace("const SUPABASE_URL = '';", "const SUPABASE_URL = 'https://example.supabase.co';");

const wrap = (arr) => ({ all: () => arr.map((j) => ({ json: j })), first: () => ({ json: arr[0] }) });
// No crypto is provided: the live Code node sandbox has none.
function run(name, { input = [{}], nodes = {}, raw = false } = {}) {
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('Referenced node is unexecuted: ' + n);
    return wrap(nodes[n]);
  };
  const src = raw ? codeOf(name) : configured(codeOf(name));
  return new AsyncFunction('$input', '$', 'DateTime', 'crypto', src)(wrap(input), $, DateTime, undefined);
}

let pass = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { failures.push(name); console.log('  FAIL ' + name + ' -- ' + e.message); }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((what || 'value') + ': got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b));
};
const ok = (c, what) => { if (!c) throw new Error(what); };
async function throws(fn, frag) {
  try { await fn(); } catch (e) { if (!e.message.includes(frag)) throw new Error('threw "' + e.message + '"'); return; }
  throw new Error('did not throw');
}

const cfg = (await run('Config'))[0].json;
const update = (over = {}, chatId = 777) => ({
  update_id: 1, message: { message_id: 4242, chat: { id: chatId, type: 'private' },
    voice: { file_id: 'AwACAgIAAx', duration: 42, mime_type: 'audio/ogg' }, ...over },
});
const inspect = async (u) => (await run('Inspect the message', { input: [u], nodes: { Config: [cfg] } }))[0].json;

const TRANSCRIPT = 'Emm so the idea is, you know, the idea is to let the bot file notes, '
  + 'and, and I should also call the accountant about the VAT thing before Friday.';
const structured = {
  ok: true,
  data: {
    title: 'Bot files notes: call the accountant',
    cleaned_text: 'The idea is to let the bot file notes. I should also call the accountant about the VAT thing before Friday.',
    tags: ['idea', 'Accounting', 'idea', 'vat thing', '', 'a', 'b', 'c', 'd'],
    type: 'task',
    related_project: 'n8n agent',
  },
  usage: { input_tokens: 300, output_tokens: 120 }, model: 'claude-haiku-4-5',
};
async function note(answer = structured, insp = null, transcript = TRANSCRIPT) {
  const i = insp || (await inspect(update()));
  return (await run('Build the note', {
    input: [answer],
    nodes: { Config: [cfg], 'Inspect the message': [i], Transcribe: [{ text: transcript }] },
  }))[0].json;
}

console.log('\nConfig');
await check('refuses to run unconfigured', () => throws(() => run('Config', { raw: true }), 'VAULT_PATH'));
await check('refuses to run with an empty allow list', () => throws(async () => {
  const src = codeOf('Config').replace("const VAULT_PATH = '';", "const VAULT_PATH = '/v';");
  return new AsyncFunction('$input', '$', 'DateTime', src)(wrap([{}]), () => {}, DateTime);
}, 'ALLOWED_CHAT_IDS is empty'));
await check('the shipped file names no vault, chat or project', () => {
  for (const l of ["const VAULT_PATH = '';", "const ALLOWED_CHAT_IDS = [];", "const SUPABASE_URL = '';"]) {
    ok(codeOf('Config').includes(l), 'baked in: ' + l);
  }
});

console.log('\nThe gate');
await check('an allowed chat with a voice note is transcribed', async () => {
  const i = await inspect(update());
  eq([i.allowed, i.hasAudio, i.shouldTranscribe], [true, true, true], 'flags');
});
await check('another chat is ignored without a reply', async () => {
  const i = await inspect(update({}, 999));
  eq([i.allowed, i.shouldTranscribe, i.shouldRefuse], [false, false, false], 'flags');
});
await check('the chat id is compared as a string, not by type', async () => {
  const i = await inspect(update({}, '777'));
  eq(i.allowed, true, 'allowed');
});
await check('a text message from an allowed chat is ignored', async () => {
  const u = update(); delete u.message.voice; u.message.text = 'hello';
  const i = await inspect(u);
  eq([i.hasAudio, i.shouldTranscribe, i.shouldRefuse], [false, false, false], 'flags');
});
await check('an audio file, not just a voice note, is accepted', async () => {
  const u = update(); delete u.message.voice;
  u.message.audio = { file_id: 'x', duration: 10, mime_type: 'audio/mpeg' };
  eq((await inspect(u)).shouldTranscribe, true, 'shouldTranscribe');
});
await check('a recording over the limit is refused, not transcribed', async () => {
  const i = await inspect(update({ voice: { file_id: 'x', duration: 601 } }));
  eq([i.shouldTranscribe, i.shouldRefuse], [false, true], 'flags');
  ok(i.refusal.includes('601') && i.refusal.includes('600'), i.refusal);
});
await check('exactly at the limit is still filed', async () => {
  eq((await inspect(update({ voice: { file_id: 'x', duration: 600 } }))).shouldTranscribe, true, 'shouldTranscribe');
});
await check('a long recording from a stranger is still ignored silently', async () => {
  const i = await inspect(update({ voice: { file_id: 'x', duration: 9000 } }, 999));
  eq([i.shouldTranscribe, i.shouldRefuse], [false, false], 'flags');
});

console.log('\nThe structuring request');
const req = async () => (await run('Build the request', { input: [{ text: TRANSCRIPT }], nodes: { Config: [cfg] } }))[0].json;
await check('the transcript is what gets sent', async () => {
  eq(JSON.parse((await req()).user), { transcript: TRANSCRIPT }, 'user');
});
await check('the prompt says tidy, not summarise', async () => {
  const s = (await req()).system;
  ok(/[Dd]o not summarise/.test(s) && /keep everything else/.test(s), s);
});
await check('an empty transcription stops the run rather than filing a blank note', () => throws(
  () => run('Build the request', { input: [{ text: '   ' }], nodes: { Config: [cfg] } }), 'came back empty'));
const validate03 = new Function(codeOf('Validate against schema', wf03).split('// Models wrap JSON')[0] + '\nreturn validate;')();
await check('workflow 03 accepts a well-formed note', async () => {
  eq(validate03(structured.data, (await req()).schema, 'root'), [], 'errors');
});
await check('workflow 03 rejects an invented type', async () => {
  ok(validate03({ ...structured.data, type: 'reminder' }, (await req()).schema, 'root').length === 1, 'accepted');
});

console.log('\nBuild the note');
const n1 = await note();
await check('the frontmatter carries created, source, type, tags and project', () => {
  const fm = n1.markdown.split('---')[1];
  for (const k of ['created:', 'source: voice', 'type: task', 'tags:', 'project:', 'duration_seconds: 42']) {
    ok(fm.includes(k), 'missing ' + k + ' in:\n' + fm);
  }
});
await check('a title with a colon does not break the frontmatter', () => {
  ok(n1.markdown.includes('title: "Bot files notes: call the accountant"'), n1.markdown.split('\n')[4]);
});
await check('a title with a quote is escaped', async () => {
  const n = await note({ ...structured, data: { ...structured.data, title: 'He said "yes"' } });
  ok(n.markdown.includes('title: "He said \\"yes\\""'), n.markdown.split('\n').find((l) => l.startsWith('title')));
});
await check('tags are lowercased, deduplicated and capped', () => {
  eq(n1.tags, ['idea', 'accounting', 'vat-thing', 'a', 'b', 'c'], 'tags');
});
await check('the cleaned text is the body', () => {
  ok(n1.markdown.includes(structured.data.cleaned_text), 'cleaned text missing');
});
await check('the raw transcript is kept, folded, not thrown away', () => {
  ok(n1.markdown.includes('> [!quote]- Raw transcript'), 'no fold');
  ok(n1.markdown.includes('> ' + TRANSCRIPT), 'raw transcript missing');
});
await check('the filename carries the date, the time and the message id', () => {
  const stamp = DateTime.now().setZone(cfg.timezone).toFormat('yyyy-LL-dd-HHmm');
  eq(n1.fileName, stamp + '-bot-files-notes-call-the-accountant-4242.md', 'fileName');
});
await check('two notes in the same minute get different paths', async () => {
  const a = await note(structured, await inspect(update({ message_id: 1 })));
  const b = await note(structured, await inspect(update({ message_id: 2 })));
  ok(a.path !== b.path, 'same path: ' + a.path);
  ok(a.path.endsWith('-1.md') && b.path.endsWith('-2.md'), a.path + ' / ' + b.path);
});
await check('the note lands in the vault inbox', () => {
  ok(n1.path.startsWith('/data/vault/Inbox/'), n1.path);
});
await check('a task becomes a row keyed by the note path', () => {
  eq(n1.isTask, true, 'isTask');
  eq(n1.task.source_url, n1.path, 'source_url');
  eq([n1.task.source, n1.task.status, n1.task.urgency], ['voice', 'open', 'normal'], 'task fields');
});
await check('anything else writes no task row', async () => {
  const n = await note({ ...structured, data: { ...structured.data, type: 'idea' } });
  eq([n.isTask, n.task], [false, null], 'task');
});
await check('an unusable answer stops the run instead of filing nothing', () => throws(
  () => note({ ok: false, errors: ['api call failed'] }), 'could not be structured'));
await check('a missing title falls back rather than producing a nameless file', async () => {
  const n = await note({ ...structured, data: { ...structured.data, title: '   ' } });
  eq(n.title, 'Voice note', 'title');
  ok(/-note-4242\.md$/.test(n.fileName), n.fileName);
});
await check('a title in another alphabet still yields a usable filename', async () => {
  const n = await note({ ...structured, data: { ...structured.data, title: '\u0417\u0430\u043c\u0435\u0442\u043a\u0430 \u043e VAT' } });
  ok(/^\d{4}-\d{2}-\d{2}-\d{4}-vat-4242\.md$/.test(n.fileName), n.fileName);
});
await check('tags in another alphabet survive instead of becoming empty', async () => {
  const n = await note({ ...structured, data: { ...structured.data, tags: ['\u0438\u0434\u0435\u044f', 'vat'] } });
  eq(n.tags, ['\u0438\u0434\u0435\u044f', 'vat'], 'tags');
});
await check('the reply names the title and the path', () => {
  ok(n1.reply.includes(n1.title) && n1.reply.includes(n1.path), n1.reply);
  ok(n1.reply.includes('tasks'), 'task not mentioned');
});

console.log('\nWorkflow file');
await check('the allow list is checked before anything is downloaded', () => {
  const order = ['Config', 'Inspect the message', 'Transcribe it?'];
  eq(wf.connections['Voice note received'].main[0][0].node, 'Config', 'first');
  eq(wf.connections['Config'].main[0][0].node, order[1], 'second');
  eq(wf.connections['Inspect the message'].main[0][0].node, order[2], 'third');
  eq(wf.connections['Transcribe it?'].main[0][0].node, 'Download the audio', 'download is behind the gate');
});
await check('a stranger reaches no node that answers or spends', () => {
  eq(wf.connections['Too long to file?'].main[1][0].node, 'Nothing to do', 'silent path');
  eq(wf.connections['Nothing to do'], undefined, 'the silent path continues somewhere');
});
await check('the audio is never written to disk', () => {
  const writes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.readWriteFile');
  eq(writes.map((n) => n.parameters.operation), ['write'], 'file nodes');
  eq(writes[0].parameters.fileName, "={{ $('Build the note').first().json.path }}", 'written path');
  // The only binary that reaches a write node is the one made from the markdown.
  eq(nodeOf(wf, 'Markdown to file').parameters.sourceProperty, 'markdown', 'converted field');
  eq(wf.connections['Markdown to file'].main[0][0].node, 'Write the note', 'what is written');
});
await check('nothing deletes or sends anything from the vault', () => {
  const src = JSON.stringify(wf);
  for (const bad of ['"DELETE"', 'unlink', 'rmdir', 'sendDocument', 'sendAudio']) ok(!src.includes(bad), 'found ' + bad);
});
await check('the note is written before the task row and the reply', () => {
  eq(wf.connections['Write the note'].main[0][0].node, 'Is it a task?', 'after write');
  eq(wf.connections['Is it a task?'].main[0][0].node, 'Save the task', 'task branch');
  eq(wf.connections['Save the task'].main[0][0].node, 'Confirm in Telegram', 'reply last');
});
await check('the trigger listens for messages only', () => {
  eq(nodeOf(wf, 'Voice note received').parameters.updates, ['message'], 'updates');
});
await check('the transcription posts the binary, not a path', () => {
  const p = nodeOf(wf, 'Transcribe').parameters;
  eq(p.contentType, 'multipart-form-data', 'contentType');
  const file = p.bodyParameters.parameters.find((x) => x.name === 'file');
  eq([file.parameterType, file.inputDataFieldName], ['formBinaryData', 'data'], 'file field');
});
await check('ships inactive, no credentials, no crypto, English only', () => {
  eq(wf.active, false, 'active');
  eq(wf.nodes.filter((n) => n.credentials).length, 0, 'credentials');
  ok(wf.nodes.every((n) => !/\bcrypto\s*\./.test(n.parameters.jsCode || '')), 'crypto');
  eq(JSON.stringify(wf).match(/[\u0400-\u04FF]/g), null, 'cyrillic');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
