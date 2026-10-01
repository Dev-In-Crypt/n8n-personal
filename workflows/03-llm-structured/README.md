# 03. LLM call with schema and retries

Built from `SPEC.md`. A sub-workflow: hand it a prompt and a JSON schema, get back a
validated object. A malformed reply is repaired by the model rather than crashing the
caller.

## Interface

Input:

```json
{
  "system": "You classify support tickets.",
  "user": "Ticket: the export button does nothing on Safari.",
  "model": "claude-sonnet-4-5",
  "max_retries": 2,
  "schema": { "type": "object", "required": ["category"], "properties": { "category": { "type": "string" } } }
}
```

Output:

```json
{ "ok": true, "data": {}, "attempts": 1, "errors": [], "usage": {}, "model": "", "raw_on_failure": null }
```

Only `user` and `schema` are required. `model` defaults to `claude-sonnet-4-5`,
`max_retries` to 2 and is capped at 5.

Three more optional fields control the spend ledger: `workflow_name` (who to bill the
call to, strongly recommended), `purpose` (a free line stored with the row) and
`log_spend: false` (do not log this call, for a caller that sums a batch and logs it
itself).

## What it does

| Node | Type | Role |
|---|---|---|
| When called by another workflow | `executeWorkflowTrigger` v1.2 | entry point |
| Prepare request | `code` v2 | validates input, applies defaults, builds the first request |
| Call Anthropic | `httpRequest` v4.4 | Messages API, retries transport failures, never throws |
| Validate against schema | `code` v2 | parses, validates, decides retry or stop, rebuilds the request |
| Valid or out of attempts? | `if` v2.3 | leaves the loop |
| First retry? | `if` v2.3 | picks the back-off |
| Wait 2 seconds / Wait 8 seconds | `wait` v1.1 | exponential pause between attempts |
| Report the spend? | `if` v2.3 | the opt-out, and no row when no tokens were used |
| Build the spend log | `code` v2 | the ledger row |
| Log the spend | `executeWorkflow` v1.3 | workflow 12a, in log mode |
| Return result | `code` v2 | single exit shape |

Decisions the spec did not spell out:

- **The retry is a repair, not a repeat.** On failure the rejected reply and the exact
  validation errors are appended to the conversation, so the next call is the model
  being told what it got wrong. Re-sending the same prompt would mostly reproduce the
  same mistake.
- **The schema is part of the instruction.** It is serialised into the system prompt
  alongside "answer with a single JSON object and nothing else", so validation is the
  second line of defence rather than the only one.
- **JSON is extracted, not assumed.** Code fences and surrounding prose are stripped,
  then the first balanced `{`/`[` region is parsed. Models do this often enough that
  failing on it would waste an attempt every time.
- **API failures are data.** The HTTP node carries `onError: continueRegularOutput`, so
  an overloaded or rejected call arrives at the validator as a failed attempt and is
  retried with the same back-off instead of throwing out of the sub-workflow.
- **Two explicit wait nodes instead of a computed pause.** The Wait node's `amount` is a
  numeric field; an expression there fails strict validation. Two nodes selected by an
  IF give the 2s then 8s the spec asks for and keep the workflow valid.
- **The attempt counter is `$runIndex`, not a value carried in the item.** This was a
  bug, found when workflow 12's ledger was wired up and the loop was re-read closely.
  The validator took its state from `$('Prepare request')`, a node that runs once per
  execution: on every retry it handed back `attempt: 0`, so `attempt` was always 1,
  `done` never turned true on a persistently invalid reply, and the loop called the model
  again and again with no ceiling. `max_retries` was a number the workflow printed, not a
  limit it enforced. `$runIndex` is this node's own run number and is the only counter
  that advances with the loop. The old code is kept out of the repository, but the proof
  is reproducible: with "Prepare request" frozen the way n8n freezes it, six passes of the
  old validator all report `attempt: 1, done: false`.
- **Usage is the sum over every attempt.** It used to be the last attempt's usage only, so
  a call that was repaired twice reported a third of what it cost. The earlier runs of the
  HTTP node are the only place that history survives, so the validator walks runs 0 to
  `$runIndex` and adds them up. The output field keeps its shape; the number is now true.
- **The call logs itself to workflow 12a.** The ledger used to depend on each caller
  remembering to log, which meant the daily cap was counting a fraction of the spend. Now
  the one place that sees every model call writes the row: `workflow_name` from the
  request, the summed tokens, and a purpose line. Failed calls are logged too, because
  they were paid for. A caller that aggregates a whole batch into one row of its own sends
  `log_spend: false`, which is what workflows 15 and 17 do, so nothing is counted twice.
- **A ledger outage never costs a caller its answer.** "Log the spend" carries
  `onError: continueRegularOutput`, and "Return result" reads the validator by name rather
  than taking whatever arrived on its input, so the spend log sitting in the chain cannot
  change or replace what this workflow returns.
- **The validator is a documented subset**, not full JSON Schema: `type`, `required`,
  `properties`, `enum` and `items`, with the failing path named in each message.
  Anything else in a schema still reaches the model as instruction but is not enforced
  locally. Pretending to implement the whole draft would be worse than saying this.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors. The remaining warnings are generic advice about Code nodes and the credential
type being named explicitly, which is intended.

`tests/run.mjs` drives the whole loop outside n8n: node code is read out of
`workflow.json`, the network call is replaced by canned replies. Fifty checks, all green:

```
node tests/run.mjs
```

**The harness was rewritten in the same change.** It used to thread the loop state from
one pass to the next, which is not what n8n does and is exactly what hid the retry bug: a
green suite over a loop the instance could not run. It now freezes the prepared state the
way n8n freezes it, fails if a pass mutates it, and feeds `$runIndex` and the earlier HTTP
runs instead.

Covered: success on the first attempt, JSON buried in prose and fences, a type error
recovered on the second attempt, missing required property, enum violation, array item
type with the index in the path, an impossible schema exhausting attempts without
throwing, `max_retries: 0`, an API error payload, an empty reply, the 2s then 8s
back-off, and input validation including the model coming from the input. Added with the
ledger: the attempt counter advancing across passes, usage summed over three attempts,
the answer surviving the spend log in front of it, the ledger row's shape and token
rounding, the unnamed-caller marker, a failed call still being logged, and `log_spend`
defaulting to on while only an explicit `false` turns it off.

## Definition of done

- [x] an invalid reply never breaks the workflow
- [x] the attempt count is capped and visible in the output
- [x] token usage is reported in the output

The middle box was ticked before this change and should not have been: the count was
visible but not capped. It is capped now, and a test asserts the three passes a
`max_retries: 2` call is allowed. The third box was true only for the last attempt; the
number is now the sum. This change also ticks the open box in workflow 12's definition of
done, which was waiting on exactly this.

## What is left to a human

1. Create an Anthropic credential named `Anthropic API` and select it in "Call Anthropic".
2. Run it once against the real API to confirm the network path. The tests cover the
   logic and the loop, not the live call.
3. Add `workflow_name: '[NN] <name>'` to the request in every workflow that calls this
   one. Without it the ledger row reads `[03] (caller not named)`: the spend is counted,
   so the daily cap is right, but workflow 12's "most expensive workflows" report cannot
   tell those callers apart. Workflows 15 and 17 already send a name with their own log
   rows; 05, 06, 07, 08, 09, 10, 14 and 16 need the one line.

## Limitations

- Schema support is the subset listed above.
- `max_tokens` is fixed at 2000 in "Prepare request". Long structured outputs need it
  raised there.
- Every attempt resends the whole conversation, so a long repair chain costs more input
  tokens each round. With the default of two retries this is bounded and cheap.
- The ledger row costs one extra sub-workflow execution per call. For a caller that fans
  out dozens of calls per run that is why `log_spend: false` exists.
- The spend log has not been exercised against a live workflow 12a. The row that leaves
  this workflow is tested; whether 12a accepts it is checked only by reading 12a's own
  validation, which rejects a blank name, a missing model and non-integer tokens, none of
  which this node can now produce.
