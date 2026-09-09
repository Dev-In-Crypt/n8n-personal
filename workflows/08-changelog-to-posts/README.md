# 08. Changelog to post drafts

Built from `SPEC.md`. Turns a product's own changelog into post drafts, each tied to a
real release, with a human gate before anything reaches a publishing queue. It is the
first workflow here that composes three others: 02 for deduplication, 03 twice for the
model calls, and 04 for the gate.

## What it does

| Node | Type | Role |
|---|---|---|
| Every day at 09:00 | `scheduleTrigger` v1.3 | daily sweep, manual runs work too |
| Config | `code` v2 | database url, review chat, gate timeout |
| Load products | `httpRequest` v4.4 | product list is data, not code |
| Fetch changelog | `httpRequest` v4.4 | one call per product, failures do not stop the run |
| Normalise entries | `code` v2 | GitHub releases and custom feeds into one shape |
| Drop already seen | `executeWorkflow` v1.3 | calls workflow 02 |
| Any new entries? | `if` v2.3 | quiet-day branch |
| Build occasion request | `code` v2 | first model call |
| Find occasions | `executeWorkflow` v1.3 | calls workflow 03 |
| Verify occasions | `code` v2 | quote verification, url check |
| Any occasions? | `if` v2.3 | nothing worth posting is a normal outcome |
| Build drafts request | `code` v2 | second model call |
| Write drafts | `executeWorkflow` v1.3 | calls workflow 03 again |
| Prepare approval | `code` v2 | builds the rows and the review text |
| Ask a human | `executeWorkflow` v1.3 | calls workflow 04 |
| Approved? | `if` v2.3 | the gate |
| Stamp approval | `code` v2 | attaches the approval id |
| Queue drafts | `httpRequest` v4.4 | the only write in the workflow |

## The rules that shape it

**No post without a source, enforced twice.** An occasion is dropped unless its
`evidence_quote` is a verbatim substring of the entry it claims to come from, and unless
that entry has a real url. Later, the `source_url` on every draft row is copied from the
entry, never taken from the model, so a hallucinated link cannot reach the queue. The
database column is `not null` as the third line of defence.

**Nothing is written before the gate.** The rows are assembled in memory, shown to a
human, and inserted only on the approved branch. A rejection or a timeout leaves no rows
at all, rather than rows with a `rejected` status that someone has to clean up later.

**There is no publishing step, and a test enforces that.** `tests/run.mjs` inspects
`workflow.json` itself and fails if any node type could post somewhere, or if there is
more than one write, or if the rejected branch does anything but end. That is the product
boundary from the spec turned into a check rather than a promise.

Other decisions:

- **One gate for the batch, not one per draft.** The gate suspends an execution; a gate
  per draft would mean a loop of suspended executions and a stream of messages. The
  reviewer sees all drafts in one message and decides once. Per-draft review belongs in
  the queue, where a human is already looking at rows.
- **The approval id is stamped onto every row**, so a queued draft can be traced back to
  the decision that let it through.
- **Unpublished GitHub releases are skipped**, since a draft release is not an occasion.
- **Ids are namespaced by product**, so two products cannot collide in the dedup store.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors.

`tests/run.mjs` runs the Code nodes against fixtures and additionally asserts structural
properties of the workflow file. Twenty-nine checks, all green:

```
node tests/run.mjs
```

Covered: GitHub defaults and a custom field map, draft releases skipped, product-scoped
ids, the "skip internal work" instruction present in the prompt, a paraphrased quote
dropped, an occasion for a non-existent entry dropped, an entry without a url dropped,
drafts for unknown occasions and empty drafts dropped, every row carrying a source url
that matches its entry, the review text containing drafts and links, approval stamping,
and the three structural rules above.

The one thing the tests deliberately do not assert is whether the model correctly ignores
a dependency bump. That is a model judgement; the test checks that the instruction is in
the prompt and that an empty occasion list flows through cleanly, instead of pretending
to test the model.

## Definition of done

- [x] every draft carries a `source_url`; a post without a source cannot exist
- [x] a rejected gate means no rows at all, not rows with a status
- [x] there is no publishing step anywhere in the workflow

## What is left to a human

1. Apply `schema.sql` and insert at least one `changelog_sources` row.
2. Create the `Supabase (dev)` credential and select it in both HTTP nodes.
3. Set `SUPABASE_URL` and `CHAT_ID` in "Config".
4. Repoint the four `executeWorkflow` nodes at your own copies of 02, 03 (twice) and 04.
5. Run once by hand and reject the batch, to confirm nothing is written.

## Limitations

- A GitHub token is not used, so the releases API is subject to unauthenticated rate
  limits. One product polled daily is far inside them.
- The review is all-or-nothing per run. Partial approval means editing rows in the queue.
- Changelogs are fetched directly. Once workflow 11 exists, this should move behind it.
