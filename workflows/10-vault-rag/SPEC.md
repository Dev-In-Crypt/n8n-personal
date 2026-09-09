# 10. RAG over the Obsidian vault

- **slug:** `vault-rag`
- **category:** portfolio
- **depends_on:** 01, 02, 03

**Goal.** Ask your own notes a question in natural language and get an answer with links
to the notes it came from.

**Triggers.** Two workflows: an indexer on a nightly schedule, and a bot on a Telegram
trigger.

**Indexer.**
1. Read `.md` files from the vault folder.
2. Chunk by heading, 800 to 1200 characters, 100 of overlap. Chunk key is
   `path + heading + hash(content)`.
3. Call workflow 02 with `source = 'vault'`, so only changed chunks are re-embedded.
4. Embed and store into `vault_chunks(id, path, heading, content, embedding, updated_at)`.
5. Files removed from the vault are marked `deleted_at`, never hard deleted.

**Bot.**
1. `Telegram Trigger` on a message.
2. Embed the question, take the top 8 chunks by cosine similarity.
3. Call workflow 03 with the schema `{ answer, used_chunks, confidence }` and an
   instruction to say plainly when the context is not enough.
4. Reply with the answer and the list of source notes.

**Credentials.** `Supabase (dev)`, `Telegram Bot (alerts)`, an embeddings credential.

**Test.** A small vault of five notes. A question with a known answer must find the right
file; a question outside the vault must produce "I do not know".

**Definition of done.**
- [ ] re-indexing with nothing changed re-embeds nothing
- [ ] every answer carries the notes it used
- [ ] a question outside the vault is not answered from invention

**Out of scope.** Do not index attachments and do not send vault contents anywhere else.
