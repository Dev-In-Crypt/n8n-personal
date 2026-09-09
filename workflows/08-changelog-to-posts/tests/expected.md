# Expected result

Input: `tests/input.json` carries two product rows and the payloads they would return.
The harness runs the Code nodes; the three sub-workflow calls and the database write are
canned.

## Normalise entries

- a GitHub releases array is read without a field map, its default names are handled
- a custom feed is read through its own `items_path` and `field_map`
- an unpublished GitHub release (`draft: true`) is skipped
- ids are prefixed with the product so two products cannot collide
- the output is shaped as the input of workflow 02

## Occasions

- entries that are refactors, dependency bumps or CI work should produce no occasion.
  That is a model judgement, so the test asserts the instruction is in the prompt and
  asserts the pipeline handles an empty occasion list, rather than pretending to test
  the model itself.
- an occasion whose quote is not verbatim in its entry is dropped
- an occasion referring to an entry id that does not exist is dropped
- an occasion whose entry has no source url is dropped: no url, no post

## Drafts

- the source url on every row comes from the entry, never from the model, so a
  hallucinated link cannot reach the queue
- a draft referring to an unknown occasion is dropped
- an empty draft text is dropped

## The gate

- approved: rows are written, each stamped with the approval id
- rejected: no rows at all, not rows with a status
- expired: same as rejected
- nothing is written before the gate, so there is no state to clean up

## No publishing

- the workflow contains no node that posts anywhere; the only write is into the queue
