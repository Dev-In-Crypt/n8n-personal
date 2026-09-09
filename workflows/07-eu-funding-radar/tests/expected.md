# Expected result

Input: `tests/input.json` carries an applicant profile, two source rows and the payloads
those sources would return. The harness runs the four Code nodes; the sub-workflow
calls, the database write and Telegram are canned.

## Normalise items

- both sources are mapped through their own `field_map` and `items_path`
- ids are prefixed with the source name, since native ids only need to be unique there
- HTML is stripped from summaries, dates become `YYYY-MM-DD`, budgets become numbers
- a source whose fetch failed contributes nothing without breaking the pairing, which is
  positional: the nth response belongs to the nth source row

## Hard filter, before any model call

From the seven normalised items the gate drops, and reports each reason:

- `C-3`, deadline in the past
- `C-4`, budget below the profile minimum
- `C-5`, country not in the profile list
- `C-2`, contains a disqualifying term
- `C-6`, no profile keyword present

`C-1` and `O-1` survive, so five of seven never reach the model. The counters make that
checkable rather than a claim.

A source that does not map a field must leave it null rather than filling it with the
whole raw object: `O-1` has no country, so the country filter does not apply to it.

## Quote verification

- a quote copied verbatim from the item text verifies, and the score stands
- a fabricated quote marks the item `unverified` and caps its score at 40
- an unverified item never alerts, whatever score the model gave it
- whitespace differences are tolerated, a paraphrase is not
- a quote shorter than 12 characters is not accepted as evidence
- an item the model returned no score for at all is unverified with relevance 0, never
  quietly dropped and never alerted

## Alerting

- only verified items scoring at or above the threshold alert
- the message states how many were seen and how many were filtered before scoring

## Degraded mode

- if scoring fails, items are still stored with relevance 0, marked unverified, and
  nothing is alerted
