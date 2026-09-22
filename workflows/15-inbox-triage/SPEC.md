# 15. Inbox triage into tasks

- **slug:** `inbox-triage`
- **category:** ops
- **depends_on:** 01, 02, 03, 12

**Goal.** Pull out of the inbox what needs doing and put it in one list. Leave everything
else alone.

**Trigger.** `Schedule Trigger`, every 2 hours during working hours.

**Flow.**
1. Gmail: messages matching `is:unread -category:promotions -category:social`.
2. Dedup through workflow 02, `source = 'gmail'`, by message id.
3. The cost gate from workflow 12 before the LLM batch.
4. LLM through workflow 03 with the schema `{ needs_action, action, deadline_hint,
   urgency: low|normal|high, category, one_line_context }`. The model sees only `from`,
   `subject` and the first 1500 characters of the body.
5. `needs_action: true` -> a row in `tasks(source, source_url, action, urgency,
   deadline_hint, status)` and the `Triaged` label in Gmail.
6. `urgency: high` -> an immediate Telegram alert. The rest waits for the morning digest.

**Input.** None. **Output.** Tasks in the database, labels in Gmail.
**Credentials.** Gmail, `Supabase (dev)`, `Anthropic API` (through 03), `Telegram Bot (alerts)`.

**Test.** A fixture of 10 emails: 3 need action, 1 urgent, 6 informational. Expected:
3 tasks, 1 alert, 0 duplicates on a second run.

**Definition of done.**
- [ ] mail is never marked read or archived
- [ ] no email body reaches the database, only a link and one line of context
- [ ] when the LLM is unavailable, mail stays untriaged rather than lost

**Out of scope.** Never reply to mail. Never delete anything.
