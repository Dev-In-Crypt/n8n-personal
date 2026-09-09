# 03. LLM call with schema and retries

- **slug:** `llm-structured`
- **category:** template
- **depends_on:** 01

**Goal.** A sub-workflow that takes a prompt and a JSON schema and returns a validated
object. Format mistakes are repaired automatically instead of breaking the pipeline.

**Trigger.** `Execute Workflow Trigger`.

**Flow.**
1. Input: `{ system, user, schema, model, max_retries }`, `max_retries` defaults to 2.
2. `HTTP Request` to the Anthropic Messages API.
3. `Code`: parse the reply and validate it against the schema.
4. On failure, append the validation error to the conversation and retry, at most
   `max_retries` times, with an exponential pause (`Wait`, 2s then 8s).
5. Return `{ ok, data, attempts, raw_on_failure }`.

**Credentials.** `Anthropic API`.

**Test.** Three cases: a valid reply on the first attempt; a reply with prose wrapped
around the JSON, which must still be extracted; an impossible schema, which must return
`ok: false` after `max_retries` instead of throwing.

**Definition of done.**
- [ ] an invalid reply never breaks the workflow
- [ ] the attempt count is capped and visible in the output
- [ ] token usage is reported in the output

**Out of scope.** Do not hardcode the model in a node, take it from the input.
