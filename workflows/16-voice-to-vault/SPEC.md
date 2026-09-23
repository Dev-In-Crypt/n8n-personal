# 16. Telegram voice notes into Obsidian

- **slug:** `voice-to-vault`
- **category:** ops
- **depends_on:** 01, 03

**Goal.** Dictate a thought to your own Telegram bot and a minute later it is in the vault
as a structured note with tags. Workflow 10's RAG picks it up from there.

**Trigger.** `Telegram Trigger` on messages carrying `voice` or `audio`.

**Flow.**
1. Download the file through Telegram getFile.
2. Transcribe it, language auto.
3. LLM through workflow 03 with the schema `{ title, cleaned_text, tags: [], type:
   idea|task|note|log, related_project }`. Remove filler, keep the meaning, do not retell.
4. Build markdown with frontmatter (`created`, `source: voice`, `tags`, `project`).
5. Write it to `<vault>/Inbox/YYYY-MM-DD-<slug>.md`.
6. `type: task` also adds a row to the `tasks` table from workflow 15.
7. Reply in Telegram with the note title and the file path.

**Input.** A voice message. **Output.** A file in the vault and a confirmation.
**Credentials.** `Telegram Bot (alerts)`, `Anthropic API` (through 03), a transcription key.

**Test.** Two audio files in `tests/`: a short thought and a three minute recording. Check
that two notes made in the same minute do not collide.

**Definition of done.**
- [ ] the raw transcript is kept in the note behind a fold, not discarded
- [ ] the bot answers only messages from an allowed `chat_id`
- [ ] the file is written atomically; a half-written file never appears in the vault

**Out of scope.** Do not keep audio files after transcription.
