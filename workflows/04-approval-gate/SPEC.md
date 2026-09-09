# 04. Human approval gate via Telegram

- **slug:** `approval-gate`
- **category:** template
- **depends_on:** 01, 02

**Goal.** A pause with buttons: send a draft to a human, wait for a decision, return it
to the calling workflow. The building block for anything that publishes or sends
something outward.

**Trigger.** `Execute Workflow Trigger`.

**Flow.**
1. Input: `{ title, body, chat_id, timeout_hours }`.
2. Record the request in `approvals(id, title, status, created_at, decided_at)`.
3. Send the draft to Telegram with approve and reject buttons and suspend the execution.
4. On a click, resume, write the decision back, and return it.
5. If nothing is clicked within `timeout_hours`, resume anyway with `expired`.
6. Return `{ request_id, decision, decided_at, timed_out }`.

**Credentials.** `Telegram Bot (alerts)`, `Supabase (dev)`.

**Test.** Three outcomes: approve, reject, and timeout.

**Definition of done.**
- [ ] the decision is stored, and a second press cannot change a decided request
- [ ] a timeout returns `expired` instead of hanging forever
- [ ] the message carries no payload beyond the draft itself

**Out of scope.** No publish button. The gate returns a decision, nothing else.
