# Expected result

Input: `tests/input.json` holds raw feed entries as the RSS node would emit them.
The harness runs the three Code nodes; the sub-workflow calls and Telegram are canned.

## Normalise and cap

- entries without a link or title are dropped
- HTML is stripped from the excerpt and it is capped at 400 characters
- the batch is sorted newest first, so a capped run keeps the freshest items
- the output is one item shaped as the input of workflow 02:
  `{ source: "digest", key_field: "url", items: [] }`
- `carriedOver` reports how many entries did not fit in this run

## Capping happens before deduplication

This is the important ordering. Workflow 02 records everything it is given as seen, so
items dropped after deduplication would never be seen again. Capping first means the
overflow is simply picked up on the next run. A batch of 20 yields 15 items and
`carriedOver` 5, and the five are not passed to the dedup call.

## Build digest request

- one LLM call for the whole batch, not one per item
- the prompt lists every entry with its url and excerpt
- the schema requires `url`, `one_liner` and `tag` per item

## Compose message

- entries are grouped by tag, tags sorted alphabetically
- every entry is a clickable link on its title
- `&`, `<` and `>` are escaped, since the message is sent with `parse_mode: HTML`
- a carry-over footer appears only when something was held back

## Degraded mode

- when the LLM sub-workflow returns `ok: false`, the digest is still sent with titles
  and links and a footer saying summaries are unavailable
- losing the summaries must not lose the digest

## Empty day

- with no new items the IF routes to a no-op and nothing is sent
