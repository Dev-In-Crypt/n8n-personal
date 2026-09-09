# Expected result

Input: `tests/input.json`, a synthetic Error Trigger payload.

## Run 1, first failure

- `isDuplicate` = `false`
- `workflowName` = `Demo: source collector`
- `failedNode` = `HTTP Request`
- `executionId` = `231`
- `url` = `http://localhost:5678/workflow/wf-demo-1/executions/231`
- `&`, `<` and `>` are escaped in `text` (`&amp;`, `&lt;`, `&gt;`), otherwise Telegram
  rejects a message sent with `parse_mode: HTML`
- no stack trace in `text`
- IF branch: `false` -> Telegram -> `Result` -> `{ alerted: true, reason: "sent" }`

## Run 2, same payload inside the hour

- `isDuplicate` = `true`
- IF branch: `true` -> `Suppressed` -> `{ alerted: false, reason: "duplicate_within_1h" }`
- Telegram is not called

## Run 3, different error text

- `isDuplicate` = `false`: the dedup key covers workflow, node and error text

## Run 4, same payload but the mark is older than an hour

- `isDuplicate` = `false`, the stale entry is evicted from static data

## Limit

A message longer than 500 characters is truncated to 500.
