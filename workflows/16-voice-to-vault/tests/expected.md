# Expected behaviour

`node tests/run.mjs` from this folder's parent. Needs Node 18+ and `luxon`, which n8n
injects into Code nodes as `DateTime`. No n8n, network, Telegram, model or vault needed.
Every test reads its code out of `workflow.json`, and the answer schema is checked against
workflow 03's own validator. No `crypto` is provided, because the live sandbox has none.

## About the audio fixtures

The spec asked for two audio files here. There are none, and they would prove nothing: the
transcription is an HTTP call to someone else's model, so a real recording could only be
tested by spending money on a live call. What these tests cover instead is everything on
either side of that call - the gate, the duration limit, the request, and the whole note.
The live transcription is listed in the README as the one part only a human run can check.

## The 40 checks

**Config (3).** Refuses to run without a vault path and without an allow list, and the
shipped file names no vault, chat or project.

**The gate (8).** An allowed chat with a voice note is transcribed. Another chat is ignored
with no reply at all. The chat id is compared as a string, so a number in the config and a
number from Telegram cannot silently mismatch. A text message is ignored. An `audio` file,
not only a `voice` note, is accepted. A recording over the ten minute limit is refused with
a message rather than transcribed, exactly at the limit is still filed, and a long
recording from a stranger is still ignored silently.

**The structuring request (5).** The transcript is what gets sent. The prompt says tidy,
not summarise. An empty transcription stops the run instead of filing a blank note.
Workflow 03's validator accepts a well-formed note and rejects an invented `type`.

**Build the note (16).** The frontmatter carries created, source, type, tags, project and
the duration. A title with a colon does not break it and a title with a quote is escaped.
Tags are lowercased, deduplicated and capped at six. The cleaned text is the body and the
raw transcript is kept below it behind a fold. The filename carries the date, the time and
the message id, so two notes dictated in the same minute get different paths. The note
lands in the vault inbox. A task becomes a row keyed by the note path, and any other type
writes no row. An unusable answer from the model stops the run rather than filing an empty
note. A missing title falls back instead of producing a nameless file. A title written in
another alphabet still yields a usable filename, while tags in another alphabet survive
instead of being stripped to nothing. The reply names the title, the path and the task.

**Workflow file (8).** The allow list is checked before anything is downloaded, and a
stranger reaches no node that answers or spends. The audio is never written to disk: the
only file written is the markdown, and the only binary converted is the note. Nothing
deletes or sends files. The note is written before the task row and before the reply. The
trigger listens for messages only. The transcription posts the binary rather than a path.
Ships inactive, without credentials, without `crypto`, in English only.
