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

## The retry loop, as the instance actually runs it

The harness re-reads the same prepared state on every pass, because "Prepare request" runs
once per execution and n8n hands back that one run for ever. The attempt number therefore
has to come from `$runIndex`.

- three passes of a persistently invalid reply report `attempt` 1, 2, 3
- only the third has `done` true, and `max_retries: 2` means exactly three calls
- the prepared state is unchanged after every pass, and the harness fails if it is not

## Usage over several attempts

- three replies reporting 100/10, 200/20 and 300/30 tokens come out as 600/60
- a call that never reached the model at all reports `usage` null

## The spend ledger row

- `mode` is `log`, token counts are whole numbers, and the summed usage is what is logged
- a caller that sent no `workflow_name` is logged as `[03] (caller not named)`, never blank
- a caller that sent one is logged under it, with its `purpose` line
- a call that produced no valid answer is still logged, with the attempt count in the purpose
- `log_spend` is on unless the caller passes exactly `false`
- the gate also requires usage to exist, so a call that never reached the model logs nothing
- "Log the spend" continues on error, and is not the last node: the caller's answer comes
  from "Return result", which reads the validator by name
