# 07. EU Funding Radar

Built from `SPEC.md`. Monitors European funding sources and scores what it finds against
an applicant profile. The portfolio piece of this library, and the one where the design
question is not "can it fetch" but "why would you believe the score".

## What it does

| Node | Type | Role |
|---|---|---|
| Every day at 08:00 | `scheduleTrigger` v1.3 | daily sweep |
| Config | `code` v2 | database url, chat, profile id, alert threshold |
| Load applicant profile | `httpRequest` v4.4 | the profile is a row, not code |
| Load sources | `httpRequest` v4.4 | the source list is data too |
| Fetch source | `httpRequest` v4.4 | one call per source, failures do not stop the sweep |
| Normalise items | `code` v2 | maps every source into one shape via its own field map |
| Drop already seen | `executeWorkflow` v1.3 | calls workflow 02 |
| Hard filter | `code` v2 | the cheap gate, before any model call |
| Anything left to score? | `if` v2.3 | skips the model on an empty day |
| Build scoring request | `code` v2 | one scoring call for the survivors |
| Score calls | `executeWorkflow` v1.3 | calls workflow 03 |
| Verify evidence | `code` v2 | quote verification, scoring, message |
| Store items | `httpRequest` v4.4 | one batch insert |
| Anything to alert? | `if` v2.3 | store-only runs stay quiet |
| Send alert | `telegram` v1.2 | one message |

## The two decisions that matter

**Nothing reaches the model until code has had a chance to reject it.** Deadline in the
past, budget outside the range, country not allowed, a disqualifying term present, no
required keyword: all decided in `Hard filter`, all counted. In the test fixture five of
seven candidates die there. The counters are emitted and printed in the alert footer, so
"the filter does most of the work" is a number you can read, not a claim in a README.

**A score without a verified quote is not a score.** The model must return
`evidence_quote` copied verbatim from the text it was shown. `Verify evidence` checks
that the quote is a literal substring of that same text, tolerating only whitespace
differences. A paraphrase fails. A fabrication fails. A failed check marks the item
`unverified`, caps its relevance at 40, drops the quote, and blocks the alert no matter
what score the model claimed. An item the model skipped entirely is treated the same way
rather than quietly disappearing.

Other decisions the spec did not spell out:

- **Sources are rows, not code.** Each carries a dot path to its item array and a map
  from our field names to theirs, so adding a source is an insert. The spec named CORDIS,
  the Funding and Tenders portal and TED; hardcoding three API shapes I cannot test
  against would have been fiction. They belong in `funding_sources` as configuration.
- **Only JSON sources are implemented.** `kind` exists in the schema and the source query
  filters on `kind=eq.json`, so an RSS row cannot silently produce nothing. Adding XML
  support means a parse branch, not a rewrite.
- **The applicant profile lives in the database**, exactly as the project intends. There
  is no country, entity or applicant anywhere in the workflow.
- **Responses pair with sources by position**, which is why the fetch node continues on
  error: a failed source must still emit an item or every later source would shift.

## A bug the tests caught

The field mapper resolves dot paths. Its first version reduced over an empty key list
when a source did not map a field, which returns the object itself rather than
`undefined`. Unmapped fields became `[object Object]`, and an item with no country got a
truthy garbage country and was silently dropped by the country filter. The test that
counts drop reasons per category failed, which is how it surfaced. Fixed by returning
`undefined` for an empty path, with a check that unmapped fields stay null.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors. The deployed topology was read back with `n8n_get_workflow` and matches this
file node for node and connection for connection.

`tests/run.mjs` runs the four Code nodes against fixtures. Thirty-nine checks, all green:

```
node tests/run.mjs
```

Covered: two sources through their own field maps, HTML stripping, date and money
parsing, unmapped fields staying null, a failed fetch not breaking the positional
pairing, every drop reason counted separately, empty profile lists disabling their
filters, a verified quote keeping its score, a fabricated quote capped and blocked, a
paraphrase rejected, whitespace tolerated, a too-short quote rejected, an unscored item
treated as unverified, the alert threshold, and the degraded path storing with relevance
zero and alerting nothing.

## Definition of done

- [x] the hard filter removes most candidates before any model call, visibly in counters
- [x] quote verification works and catches a fabricated quote
- [x] the applicant profile is nowhere in the workflow, only in configuration

## What is left to a human

1. Apply `schema.sql`, insert one `applicant_profile` row and at least one
   `funding_sources` row with its `items_path` and `field_map`.
2. Create the `Supabase (dev)` and `Telegram Bot (alerts)` credentials and select them.
3. Set `SUPABASE_URL` and `CHAT_ID` in "Config".
4. Repoint the two `executeWorkflow` nodes at your own copies of workflows 02 and 03.
5. Run once by hand and read the counters before trusting the scores.

## Limitations

- JSON sources only, see above.
- Verification proves a quote exists in the fetched text. It does not prove the quote
  supports the conclusion; it removes fabrication, not bad judgement.
- The summary is capped at 4000 characters per item, so a quote from deep inside a very
  long call text will not verify. Raise the cap or fetch full documents if that bites.
- Sources are fetched directly. Once workflow 11 exists, this should move behind it.
