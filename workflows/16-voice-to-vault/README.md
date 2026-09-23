# 16. Telegram voice notes into Obsidian

Built from `SPEC.md`. Dictate into your own bot; a structured note appears in the vault
inbox with the cleaned text on top and the raw transcript folded underneath.

## Nodes

| Node | Type | Role |
|---|---|---|
| Voice note received | `telegramTrigger` v1.4 | messages only |
| Config | `code` v2 | vault path, allow list, limits |
| Inspect the message | `code` v2 | the allow list, the duration limit, the file id |
| Transcribe it? | `if` v2.3 | the only path to spending anything |
| Download the audio | `telegram` v1.2 | getFile, into memory |
| Transcribe | `httpRequest` v4.4 | the audio goes up as binary |
| Build the request | `code` v2 | prompt and schema |
| Structure the note | `executeWorkflow` v1.3 | workflow 03 |
| Build the note | `code` v2 | frontmatter, body, fold, path, task row |
| Markdown to file | `convertToFile` v1.1 | text to a file |
| Write the note | `readWriteFile` v1.1 | into the vault inbox |
| Is it a task? / Save the task | `if` v2.3, `httpRequest` v4.4 | the table from workflow 15 |
| Confirm in Telegram | `telegram` v1.2 | title and path |
| Too long to file? / Say it is too long | `if` v2.3, `telegram` v1.2 | a refusal, not silence |
| Nothing to do | `noOp` v1 | strangers and text messages end here |

## The decisions that matter

**The allow list is the second node, before anything is downloaded.** A message from any
other chat ends at a no-op with no reply at all. Replying "you are not allowed" would
confirm the bot exists to whoever found it, and downloading first would let a stranger
spend your transcription budget. The chat id is compared as a string, so a number in the
config and a number from Telegram cannot mismatch on type.

**The raw transcript stays in the note.** The cleaning is a model's judgement about what
was filler and what was the thought. The only way to check that later is to still have the
original, so it sits under the cleaned text in a folded `[!quote]` callout - present,
searchable by workflow 10, and out of the way.

**The filename carries the message id.** The spec asked for `YYYY-MM-DD-<slug>.md` and its
own test asks that two notes in the same minute not collide. Those cannot both hold: two
notes about the same subject in one day would overwrite each other. The name is
`YYYY-MM-DD-HHmm-<slug>-<messageId>.md`, and the message id makes it unique by
construction rather than by luck.

**The audio is never written to disk.** It goes from Telegram into memory, straight into
the transcription request, and is gone when the run ends. There is nothing to clean up
afterwards, which is the spec's "do not keep audio files" satisfied by never having one.

**A title is quoted and escaped in the frontmatter.** "Bot files notes: call the
accountant" contains a colon; unquoted, that is frontmatter Obsidian cannot parse and a
note that shows up broken.

**Tags keep their alphabet.** Dictation here is often not in English, and a sanitiser that
allowed only `a-z` would turn every Russian tag into an empty string. The filename is
transliterated down to ASCII, so it stays typeable, but the tags are not.

**An unusable answer stops the run.** If workflow 03 cannot produce a valid note, nothing
is written and nothing is confirmed. A blank file in the vault would be worse than an
error: it looks like the thought was captured.

## Verification

Deployed to the live instance as `k7DuryTzdjhlPZs9` and validated with n8n-mcp's **strict**
profile: **0 errors**, 8 warnings. The warnings are the ones this library accepts on purpose
- "Code nodes can throw errors" (they are meant to: a note that cannot be built must not be
written), "Hardcoded nodeCredentialType" on the two HTTP nodes, and no `onError` on "Confirm
in Telegram", where a failed confirmation should surface as a failed run rather than pass
quietly, because the note is already on disk by then.

`tests/run.mjs` runs the Code nodes straight out of `workflow.json`. Forty checks, all
passing:

```
npm i luxon
node tests/run.mjs
```

`tests/expected.md` lists all forty, and explains why there are no audio fixtures.

## Definition of done

- [x] the raw transcript is kept in the note behind a fold, not discarded
- [x] the bot answers only messages from an allowed `chat_id`
- [ ] the file is written atomically; a half-written file never appears in the vault

**The third is not done, and cannot be done inside n8n here.** An atomic write means
writing to a temporary name and renaming it into place, because a rename is the operation
filesystems make atomic. n8n's Read/Write Files node has no rename, and the Execute
Command node that would give a shell is not registered on this instance - the same finding
that reshaped workflow 13. So the note is written straight to its final path in a single
write. For a file of a few kilobytes that is one write call, and Obsidian re-reads on the
next change event, so a torn read is unlikely rather than impossible.

If you want the guarantee, point `VAULT_PATH` at a staging folder outside the vault and let
one line on the host move files in:

```
while true; do mv -n /path/to/staging/*.md "$VAULT/Inbox/" 2>/dev/null; sleep 2; done
```

## What is left to a human

1. Mount the vault into the n8n container and set `VAULT_PATH` to the path **n8n** sees,
   not the path you see. Create the `Inbox` folder.
2. Put your Telegram chat id in `ALLOWED_CHAT_IDS` and set `SUPABASE_URL`.
3. Create the Telegram, transcription and Supabase credentials, and repoint "Structure the
   note" at your copy of workflow 03.
4. Apply workflow 15's `schema.sql` if the `tasks` table does not exist yet.
5. **Send one real voice note.** The transcription call is the one part these tests cannot
   cover: they check everything on both sides of it, but not the call itself.
6. Activate it. The trigger only works while the workflow is active.

## Limitations

- **The transcription is untested against the real API.** Model name, multipart field names
  and the response shape are from the documented interface, not from a live call.
- **Ten minutes per recording.** Longer ones are refused with a message rather than
  truncated, because half a note filed as a whole one is worse than none.
- **Telegram's getFile caps at 20 MB**, which is roughly an hour of voice, so the duration
  limit is reached first.
- **No audio is kept**, so a bad transcription cannot be re-run. The raw transcript in the
  note is the only record of what was heard.
- **One note per message.** A long recording split across two Telegram messages becomes two
  notes, not one.
