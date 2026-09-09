# 05. Morning digest of sources

Built from `SPEC.md`. The first composite in this library: it does almost no work
itself, it calls workflow 02 for deduplication and workflow 03 for the summaries.

## What it does

Every morning at 07:30 Europe/Madrid it reads the enabled rows of `sources`, fetches
each feed, drops everything already seen, asks the model for one line per entry, and
sends a single grouped digest. On a quiet day it sends nothing at all.

| Node | Type | Role |
|---|---|---|
| Every morning at 07:30 | `scheduleTrigger` v1.3 | the only schedule in the workflow |
| Config | `code` v2 | the one place to set `SUPABASE_URL` and `CHAT_ID` |
| Load enabled sources | `httpRequest` v4.4 | reads the `sources` table |
| Read feed | `rssFeedRead` v1.2 | one call per source, a dead feed does not stop the run |
| Normalise and cap | `code` v2 | normalises entries, sorts newest first, caps the batch |
| Drop already seen | `executeWorkflow` v1.3 | calls workflow 02 |
| Anything new? | `if` v2.3 | the silence branch |
| Stay silent | `noOp` v1 | explicit end for an empty day |
| Build digest request | `code` v2 | one LLM request for the whole batch |
| Summarise batch | `executeWorkflow` v1.3 | calls workflow 03 |
| Compose message | `code` v2 | groups by tag, escapes, links |
| Send digest | `telegram` v1.2 | one message |

Decisions the spec did not spell out:

- **The cap runs before deduplication, not after.** This is the subtle one. Workflow 02
  records everything handed to it as seen, so an item dropped by a cap placed after the
  dedup call would never appear again. Capping first, on a list sorted newest first,
  means the overflow is simply picked up on the next run. The definition of done says
  the overflow is not lost, and the node order is what makes that true.
- **A dead feed does not kill the digest.** The RSS node carries
  `onError: continueRegularOutput` with two tries, so one unreachable source costs its
  own entries and nothing else.
- **The digest survives an LLM failure.** If workflow 03 returns `ok: false` after its
  retries, the message still goes out with titles and links and a footer saying
  summaries are unavailable. Losing the summaries should not lose the digest.
- **One LLM call per run, not one per entry.** Cheaper, and it lets the model tag
  consistently across the batch so the grouping means something.
- **Silence is a real branch.** An empty day routes to a no-op. A daily "nothing new"
  message is how a digest teaches you to ignore it.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors. The warnings are the usual advice about Code nodes and the credential type.

`tests/run.mjs` runs the three Code nodes outside n8n against canned feed entries and
canned sub-workflow replies. Twenty-five checks, all green:

```
node tests/run.mjs
```

Covered: entries without links dropped, HTML stripped from excerpts, ISO dates,
newest-first ordering, the cap at 15 with the overflow reported and kept out of the
dedup call, one call for the batch, the schema demanding url, one_liner and tag,
grouping and alphabetical tags, clickable titles, HTML escaping, the carry-over footer
appearing only when needed, and the degraded path still producing a digest.

## Definition of done

- [x] an empty day means silence, not a "nothing new" message
- [x] every entry carries a clickable link to its source
- [x] the 15 item cap holds and the overflow is not lost

## What is left to a human

1. Apply `schema.sql` and add at least one row to `sources`.
2. Create the `Supabase (dev)` and `Telegram Bot (alerts)` credentials and select them.
3. Set `SUPABASE_URL` and `CHAT_ID` in "Config".
4. Repoint the two `executeWorkflow` nodes at your own copies of workflows 02 and 03.
   The ids in this file are from the machine it was built on and mean nothing elsewhere.
5. Run it once by hand before putting it on the schedule.

## Limitations

- Sub-workflow ids are instance-specific, see step 4 above.
- Feeds are fetched directly. Once workflow 11 exists, the fetch should move behind it
  for caching and rate limiting.
- The cap is a constant in "Normalise and cap". A backlog larger than 15 a day will
  never drain; raise it or prune the source list.
