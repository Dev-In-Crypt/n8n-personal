# 04. Human approval gate via Telegram

Built from `SPEC.md`. Send a draft to a human, suspend the execution, resume with their
decision. The building block for anything that would otherwise publish or send without
a person having seen it.

## Interface

Input:

```json
{
  "source": "changelog-to-posts",
  "title": "Draft post for review",
  "body": "the text a human should judge",
  "chat_id": "123456789",
  "timeout_hours": 24
}
```

Output:

```json
{ "request_id": "uuid", "decision": "approved", "decided_at": "", "timed_out": false, "title": "", "source": "" }
```

`decision` is `approved`, `rejected` or `expired`. `chat_id` falls back to a configured
default, `timeout_hours` defaults to 24 and is capped at 168.

## What it does

| Node | Type | Role |
|---|---|---|
| When called by another workflow | `executeWorkflowTrigger` v1.2 | entry point |
| Prepare request | `code` v2 | validates input, mints the uuid, composes the message |
| Log request | `httpRequest` v4.4 | writes the audit row as `pending`, before the human sees anything |
| Ask for approval | `telegram` v1.2 | `sendAndWait`, approve and reject buttons, suspends the execution |
| Record decision | `code` v2 | turns the resume payload into one of three outcomes |
| Save decision | `httpRequest` v4.4 | writes the decision, filtered on `status=pending` |
| Return result | `code` v2 | single exit shape |

Decisions the spec did not spell out:

- **The built-in `sendAndWait` replaces the hand-rolled webhook.** The spec sketched a
  separate webhook node, a callback handler and a polling wait loop. The Telegram node
  does that natively: it posts the buttons, suspends the execution and resumes on the
  click. Hand-rolling it would have meant an extra public endpoint, a second workflow to
  keep in sync, and a polling loop that burns executions while waiting. The audit table
  from the spec is kept, because that part earns its place.
- **The audit row is written before the message is sent.** If Telegram delivery fails,
  there is still a record that approval was requested. The reverse order would lose that.
- **First decision wins, enforced in the database.** The decision write targets
  `?id=eq.<uuid>&status=eq.pending`, so a late or duplicated resume matches no rows and
  cannot overwrite what was already recorded.
- **A timeout is a decision, not an error.** A limited wait resumes with no approval
  field; that becomes `expired`, and the outcome is still written. The caller never
  hangs and never has to distinguish "no answer" from "crashed".
- **The message is plain text, not HTML.** The body is arbitrary draft content; one
  unbalanced tag in a draft would make Telegram reject the very message under review.
  Bodies over 3000 characters are truncated and marked, well under the 4096 limit.
- **No free-text comment.** The spec's output mentioned one, but button approval carries
  no text. Returning an always-null field would be noise, so it is left out. A workflow
  that needs a reason should ask for it as its own step.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors. Remaining warnings are the usual advice about Code nodes and the credential type
being named explicitly.

`tests/run.mjs` runs the gate's logic outside n8n, with the Telegram wait replaced by
canned resume payloads. Twenty-six checks, all green:

```
node tests/run.mjs
```

Covered: approved, rejected and timed out; the decision write being filtered on
`pending`; a fresh uuid per call present in the row, the filter and the output; the
message carrying only title and body; long bodies truncated below the Telegram limit;
and every input validation branch.

## Definition of done

- [x] the decision is stored, and a second press cannot change a decided request
- [x] a timeout returns `expired` instead of hanging forever
- [x] the message carries no payload beyond the draft itself

## What is left to a human

1. Apply `schema.sql` to the database.
2. Create the `Telegram Bot (alerts)` and `Supabase (dev)` credentials and select them
   in the three nodes that need them.
3. Set `SUPABASE_URL` and, if you want one, `DEFAULT_CHAT_ID` in "Prepare request".
4. Run it once end to end and press a button. The tests cover the logic, not the live
   Telegram round trip.

## Limitations

- Approve and reject only. Anything richer, such as an edit flow, belongs in the calling
  workflow rather than in the gate.
- The execution stays suspended for up to `timeout_hours`. Long timeouts mean long-lived
  executions, which matters if you keep many gates open at once.
- The gate does not check who pressed the button. Anyone with access to the chat can
  decide; restrict the chat, not the workflow.

## Fix, 22 September 2026

"Prepare request" called `crypto.randomUUID()`, which this instance's Code node sandbox
does not have, so the gate threw before asking anything. Found while building workflow 15;
strict validation cannot catch it because it never runs the code. The id is now a version
4 UUID built from `Math.random`. It is a row key, not an access token: the reply resumes
the execution through n8n's own signed wait url. A test generates 2000 ids and checks the
format and that they are distinct.

The test suite used to install Node's `crypto` as a global, which is how this passed. It
no longer does, and it fails if any Code node calls into `crypto`.
