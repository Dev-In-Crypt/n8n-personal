# Expected result

Input: `tests/input.json` holds App Store feed payloads as the HTTP node would return
them, one per country. The harness runs the Code nodes; the sub-workflow calls, the
database write and Telegram are canned.

## Normalise reviews

- the feed's first entry is app metadata, not a review, and is dropped: it has no
  `im:rating`
- a country with a single review returns an object instead of an array, and is handled
- a country whose fetch failed contributes nothing and does not break the run
- `review_id` is prefixed with the country, since ids repeat across storefronts
- whitespace in bodies is collapsed, bodies are capped at 1500 characters
- the batch is sorted newest first
- the output is shaped as the input of workflow 02

## Routing

- rating 1 or 2 alerts
- a review the model marked `is_bug_report` alerts whatever its rating
- everything else is stored only
- every new review is stored, alerted or not

## First run

- with `bootstrap` set, nothing is alerted and everything is still stored and marked
  seen, so an existing backlog does not become a wall of notifications

## Draft replies

- `draft_reply` is stored on the row and appears nowhere in the outgoing message
- the message says explicitly that drafts are not sent

## Degraded mode

- if the tagging call fails, reviews are still stored and low ratings still alert,
  just without sentiment or theme

## Message

- HTML is escaped, since the message uses `parse_mode: HTML`
