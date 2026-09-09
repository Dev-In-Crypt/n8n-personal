# 10. RAG over the Obsidian vault

Built from `SPEC.md`. Two workflows, because they have nothing in common but the data: a
nightly indexer and a Telegram bot. Both files live here, `workflow-indexer.json` and
`workflow-bot.json`. This is the only folder in the library with two.

## Indexer

| Node | Type | Role |
|---|---|---|
| Every night at 02:00 | `scheduleTrigger` v1.3 | nightly pass |
| Config | `code` v2 | vault path, database url, embedding model |
| Read vault files | `readWriteFile` v1.1 | markdown only |
| Extract text | `extractFromFile` v1.1 | binary to text |
| Chunk notes | `code` v2 | split by heading, stable ids |
| Drop unchanged chunks | `executeWorkflow` v1.3 | calls workflow 02 |
| Anything to embed? | `if` v2.3 | quiet-night branch |
| Build embedding request | `code` v2 | one call for the batch |
| Embed chunks | `httpRequest` v4.4 | embeddings API |
| Build rows | `code` v2 | pairs vectors to chunks, builds the tombstone filter |
| Store chunks | `httpRequest` v4.4 | upsert |
| Tombstone removed notes | `httpRequest` v4.4 | marks, never deletes |

## Bot

| Node | Type | Role |
|---|---|---|
| On a Telegram message | `telegramTrigger` v1.4 | incoming question |
| Config | `code` v2 | allow list, database url, top k |
| Allowed chat? | `if` v2.3 | the access gate |
| Embed question | `httpRequest` v4.4 | embeddings API |
| Prepare search | `code` v2 | builds the search call |
| Find matching chunks | `httpRequest` v4.4 | pgvector similarity via an RPC |
| Build answer request | `code` v2 | context and the honesty instruction |
| Answer from notes | `executeWorkflow` v1.3 | calls workflow 03 |
| Format reply | `code` v2 | answer plus verified sources |
| Reply | `telegram` v1.2 | one message |

## The decisions that matter

**The chunk id is the change detector.** It is `path#heading#hash(content)`, so an
untouched note produces exactly the ids it produced last night and an edited one produces
new ids. That is what makes "re-indexing changes nothing" true through workflow 02, with
no second bookkeeping store and no timestamp comparison that a file copy would break. A
test edits one note and asserts exactly one chunk id changes.

**A count mismatch throws rather than storing.** Embeddings are paired to chunks by
position. If the API returns a different number of vectors than there were chunks, the
node refuses to store anything, because a silently misaligned vector poisons every future
search in a way nobody would notice for months.

**Deletion is a tombstone, and an empty read cannot trigger it.** Notes missing from the
vault get `deleted_at` set, never a delete. And if the read produced no paths at all,
which is what a wrong `VAULT_PATH` or an unmounted drive looks like, the tombstone step
is disabled instead of marking the entire index deleted.

**The access gate runs before anything is embedded or searched.** The vault is personal.
A message from a chat that is not on the allow list is dropped at the second node, before
the question reaches an embeddings API or the database. A test asserts the branch order,
not just the flag.

**Sources are intersected, not trusted.** The bot lists the notes the model says it used,
filtered against what the search actually returned. A path the model invents is dropped
and counted rather than shown. And when the model reports it did not have enough context,
the reply is the plain admission with no sources appended.

**Short notes survive.** A section below the minimum chunk size is kept whole rather than
discarded, otherwise a vault of one-line notes would index to nothing.

## Verification

`validate_workflow` with the `strict` profile against a live instance: both workflows
valid, zero errors, node versions bumped to the latest the instance offers.

`tests/run.mjs` runs the Code nodes of both workflows against a small real vault in
`tests/vault/`. Thirty-eight checks, all green:

```
node tests/run.mjs
```

Covered: heading-aware chunking, stable ids across runs, exactly one id changing after an
edit, long sections cut with overlap and none over the maximum, one embeddings call per
batch, a vector on every row, the tombstone filter built from live paths, the mismatch
guard throwing, the empty-read guard, the allow list rejecting a stranger and an empty
message before embedding, the branch order of the gate, the honesty instruction present,
an invented source path dropped and counted, the admission path carrying no sources, an
empty search still handled, and a failed model call apologising instead of inventing.

## Definition of done

- [x] re-indexing with nothing changed re-embeds nothing
- [x] every answer carries the notes it used
- [x] a question outside the vault is not answered from invention

## What is left to a human

1. Apply `schema.sql`. It needs the `vector` extension and creates the
   `match_vault_chunks` function the bot calls.
2. Create the `Supabase (dev)`, embeddings and `Telegram Bot (alerts)` credentials.
3. Set `VAULT_PATH` and `SUPABASE_URL` in the indexer's "Config", and
   `ALLOWED_CHAT_IDS` and `SUPABASE_URL` in the bot's.
4. Repoint the `executeWorkflow` nodes at your own copies of 02 and 03.
5. Run the indexer once by hand, check the row count, then run it again and confirm the
   second run embeds nothing.
6. Build the ivfflat index after the first bulk load, and raise `lists` for a large vault.

## Limitations

- The embeddings model is OpenAI's `text-embedding-3-small` at 1536 dimensions, which is
  what `schema.sql` declares. Changing the model means changing the column and
  re-embedding everything.
- n8n must be able to read the vault folder. In Docker that means mounting it into the
  container.
- Attachments are not indexed, by design.
- Retrieval is pure vector similarity with no reranking, so a question whose wording
  shares nothing with the note that answers it can miss.
