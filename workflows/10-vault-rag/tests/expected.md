# Expected result

Two workflows, so two halves. The harness runs their Code nodes; file reads, embeddings,
the vector search, the sub-workflow call and Telegram are canned.

## Indexer, chunking

- notes are split on markdown headings, and the heading travels with its section
- the chunk id is `path#heading#hash(content)`, so an unchanged note produces exactly the
  ids it produced last time and a changed one produces new ids
- a short note is kept whole rather than dropped for being under the minimum size
- a long section is cut into overlapping pieces, so a sentence spanning a cut is still
  retrievable
- the output is shaped as the input of workflow 02, which is what makes re-embedding
  unchanged chunks impossible rather than merely unlikely

## Indexer, storing

- embeddings are paired to chunks by position, and a count mismatch throws rather than
  storing misaligned vectors, because a silently wrong vector is worse than a failed run
- chunks with no embedding are skipped, never stored with a null vector
- notes missing from the vault are tombstoned by a filter built from the live paths,
  never hard deleted
- with no live paths at all the tombstone step is disabled, so an empty read cannot
  wipe the index

## Bot, access

- a message from a chat that is not on the allow list is rejected before the question is
  embedded or the vault is searched
- an empty message is rejected the same way

## Bot, answering

- the prompt instructs the model to answer only from the provided notes and to say so
  when they are not enough
- sources shown to the user are intersected with what the search actually returned, so a
  path the model invents is dropped rather than displayed
- when the model reports `enough_context: false`, the reply is the plain admission, with
  no sources appended
- when nothing matched, the same admission path is used
- a failed model call produces a short apology, not a fabricated answer
