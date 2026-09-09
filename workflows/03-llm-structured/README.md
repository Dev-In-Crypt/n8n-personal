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
- **The validator is a documented subset**, not full JSON Schema: `type`, `required`,
  `properties`, `enum` and `items`, with the failing path named in each message.
  Anything else in a schema still reaches the model as instruction but is not enforced
  locally. Pretending to implement the whole draft would be worse than saying this.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors. The remaining warnings are generic advice about Code nodes and the credential
type being named explicitly, which is intended.

`tests/run.mjs` drives the whole loop outside n8n: node code is read out of
`workflow.json`, the network call is replaced by canned replies. Twenty-seven checks, all green:

```
node tests/run.mjs
```

Covered: success on the first attempt, JSON buried in prose and fences, a type error
recovered on the second attempt, missing required property, enum violation, array item
type with the index in the path, an impossible schema exhausting attempts without
throwing, `max_retries: 0`, an API error payload, an empty reply, the 2s then 8s
back-off, and input validation including the model coming from the input.

## Definition of done

- [x] an invalid reply never breaks the workflow
- [x] the attempt count is capped and visible in the output
- [x] token usage is reported in the output

## What is left to a human

1. Create an Anthropic credential named `Anthropic API` and select it in "Call Anthropic".
2. Run it once against the real API to confirm the network path. The tests cover the
   logic and the loop, not the live call.

## Limitations

- Schema support is the subset listed above.
- `max_tokens` is fixed at 2000 in "Prepare request". Long structured outputs need it
  raised there.
- Every attempt resends the whole conversation, so a long repair chain costs more input
  tokens each round. With the default of two retries this is bounded and cheap.
