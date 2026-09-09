# Expected result

Input: `tests/input.json`. The harness replaces the network call with canned replies,
so the loop can be driven through every branch without spending tokens.

## Valid reply on the first attempt

- `ok` true, `attempts` 1, `data` equals the parsed object
- `usage` carries `input_tokens` and `output_tokens`
- `raw_on_failure` is null

## Reply wrapped in prose or a code fence

- the JSON is still extracted and validated, `ok` true

## Reply that violates the schema

- `ok` false and `done` false while attempts remain
- the conversation grows by two messages: the rejected reply and the rejection reason,
  so the next call is a repair rather than a repeat
- the rejection text names the offending path, for example
  `root.severity: expected integer, got string`

## Impossible schema

- after `max_retries` the loop stops with `done` true, `ok` false
- `attempts` equals `max_retries + 1`
- `raw_on_failure` holds the last reply, truncated to 2000 characters
- nothing throws

## API failure

- an error payload from the HTTP node is treated as a failed attempt, not an exception

## Empty reply

- reported as `empty reply from the model`

## Back-off

- `waitSeconds` is 2 after the first failure and 8 after the second

## Schema subset

Validation covers `type`, `required`, `properties`, `enum` and `items`. Anything else in
a schema is passed to the model as instruction but is not enforced locally.
