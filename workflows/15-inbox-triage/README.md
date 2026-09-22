# 15. Inbox triage into tasks

Built from `SPEC.md`. Every two hours on workdays: unread mail is read, what needs doing
becomes a row in `tasks`, urgent items go to Telegram, and everything else is left exactly
as it was.

## Nodes

| Node | Type | Role |
|---|---|---|
| Every 2 hours on workdays | `scheduleTrigger` v1.3 | 08:00 to 20:00, Monday to Friday |
| Config | `code` v2 | every setting in one place |
| Fetch unread mail | `gmail` v2.2 | read only, never modifies |
| Prepare batch | `code` v2 | from, subject, 1500 characters of body, and the dedup key |
| Anything new? | `if` v2.3 | quiet inbox, quiet run |
| Read triaged ids | `httpRequest` v4.4 | read-only lookup in workflow 02's table |
| Drop already triaged | `code` v2 | and prices the rest for the gate |
| Anything to classify? | `if` v2.3 | |
| Check the budget | `executeWorkflow` v1.3 | workflow 12a, check mode |
| Within budget? | `if` v2.3 | over budget: stop, touch nothing |
| One request per email | `code` v2 | the prompt and schema |
| Classify each email | `executeWorkflow` v1.3 | workflow 03, once per email |
| Collect results | `code` v2 | classified or failed, and the task rows |
| Build spend log / Log spend | `code` v2, `executeWorkflow` v1.3 | workflow 12a, log mode |
| Anything actionable? | `if` v2.3 | |
| Save tasks | `httpRequest` v4.4 | insert, duplicates ignored |
| Label in Gmail | `httpRequest` v4.4 | adds `Triaged`, one call for the batch |
| Plan alerts / Anything urgent? / Alert urgent mail | `code`, `if`, `telegram` | one message |
| Build triaged record / Anything classified? / Record as triaged | `code`, `if`, `executeWorkflow` | workflow 02, last |

## The decisions that matter

**02 is read first and written last - the spec's order would lose mail.** The spec put
the dedup call before the LLM. Workflow 02 records everything it is given as seen at the
moment it is called, so any email whose classification then failed would be marked done
and never looked at again: exactly the loss the third definition-of-done item forbids. So
this workflow only *reads* 02's table at the start, with the same key 02 would compute,
and hands 02 the successfully classified mail at the very end, after the tasks are saved.
A run that dies anywhere before that point leaves the mail to be triaged again; the unique
`source_url` on `tasks` absorbs the repeat. A test runs workflow 02's own code to prove the
keys are byte-identical.

**Informational mail is recorded, not labelled.** Only mail that needs action gets the
`Triaged` label, as the spec said. Everything else is left untouched in Gmail and recorded
in 02 instead, so it is not classified - and paid for - again every two hours.

**The only change ever made to a message is adding one label.** No node marks mail read,
archives, trashes, sends or replies, and a test scans the file for every one of those.
Labelling goes through the Gmail API's `batchModify` with `addLabelIds` only.

**The body stops at the classifier.** The model sees 1500 characters of it. The database
sees a link, an action, a deadline hint, a category and one line of context, each cut to a
fixed length. `schema.sql` enforces the same limits, so a body cannot land in the table
even if a model tried to put one there.

**The email is untrusted input.** The prompt says so, and says never to follow
instructions inside it. The fixture includes a message trying exactly that. The worst a
successful injection could do is create a task and send an alert - there is no node that
could reply, forward or delete.

**The budget gate runs before any money is spent.** Workflow 12a is asked about this
batch, priced at a fixed estimate per email. An over-budget run stops before the first
classification and touches nothing, so the mail waits for tomorrow's budget.

**Alerts go out once.** Tasks are inserted with duplicates ignored and the insert returns
only the rows it actually created, so a re-run cannot alert twice about the same email. All
urgent mail from one run is one Telegram message, capped at ten lines.

**Empty answers never stop the run.** An empty lookup and an empty insert both still emit
an item, the same trap found in workflows 11 and 02.

## Verification

`validate_workflow` with the `strict` profile **against the live instance** (n8n-mcp
2.65.1): 24 nodes, 25 connections, 14 expressions, **zero errors**. The three sub-workflow
calls point at the real ids of 02, 03 and 12a on this instance.

Building this surfaced two defects in workflow 02 and one in workflow 04, fixed in the
commit before this one: see their READMEs.

`tests/run.mjs` runs the Code nodes straight out of `workflow.json` against the ten-email
fixture the spec asked for. Fifty-two checks, all passing:

```
node tests/run.mjs
```

`tests/expected.md` has the fixture table and lists all fifty-two.

## Definition of done

- [x] mail is never marked read or archived
- [x] no email body reaches the database, only a link and one line of context
- [x] when the LLM is unavailable, mail stays untriaged rather than lost

The first is a test that scans the file for every operation that could change a message
beyond adding a label. The second is two tests - the exact columns of a task row, and a
scan of the rows for body text - plus the length limits in `schema.sql`. The third is a
test that fails classification for all ten emails and asserts nothing is recorded, plus a
re-run test that shows the one failed email in the fixture is picked up again.

## What is left to a human

1. Apply `schema.sql`, and workflow 02's if it is not applied yet.
2. Create the Gmail credential (OAuth2), and `Supabase (dev)` and `Telegram Bot (alerts)`.
3. Create a `Triaged` label in Gmail and put its id in `TRIAGED_LABEL_ID`. Label ids look
   like `Label_123`, not the display name.
4. Set `SUPABASE_URL` and `ALERT_CHAT_ID` in "Config".
5. Repoint the three `executeWorkflow` nodes at your copies of 02, 03 and 12a.
6. Run it once by hand on a small inbox, check `tasks`, then run it again and confirm
   nothing new is inserted and nothing is classified twice.

## Limitations

- **Non-urgent tasks wait in the table.** The spec mentions a morning digest; this workflow
  only fills `tasks`. Nothing here sends that digest.
- **An email that always fails to classify is retried every run**, costing a call each
  time. The fetch limit of 25 and the budget gate bound the damage, but they do not stop it.
- **The spend log undercounts retries.** Workflow 03 reports the usage of its last attempt,
  not the sum of all of them.
- **25 emails per run.** A backlog clears over several runs, newest first as Gmail returns
  them.
- **The dedup key lives in two places.** This workflow computes 02's key to read its table
  without writing. If 02's key scheme ever changes, this breaks; the contract test is what
  would catch it.
