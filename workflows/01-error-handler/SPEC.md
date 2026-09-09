# 01. Error handler with Telegram alert

- **slug:** `error-handler`
- **category:** template
- **status:** built
- **depends_on:** none

**Goal.** One place that handles failures: any workflow in the instance that errors
sends a structured alert to Telegram instead of failing silently.

**Trigger.** `Error Trigger`.

**Flow.**
1. `Error Trigger` catches a failed execution.
2. `Code`: build a compact payload, workflow name, execution id, failed node name,
   the first 500 characters of the error message, and a link to the execution.
3. `IF`: if the same combination (workflow + node + error text) already alerted
   within the last hour, do not send again. State lives in workflow static data.
4. `Telegram`: send to the ops chat with `parse_mode: HTML`.

**Input.** The Error Trigger payload.
**Output.** A Telegram message. Returns `{ alerted: true|false, reason }`.

**Credentials.** `Telegram Bot (alerts)`.

**Test.** `tests/input.json`, a synthetic Error Trigger payload. A second run with the
same payload inside the hour must not send a message.

**Definition of done.**
- [ ] the message arrives and is readable, the link works
- [ ] a duplicate inside the hour is suppressed
- [ ] no secrets and no full stack trace in the message text

**Out of scope.** Do not retry the failed workflow. Do not write to a database.
