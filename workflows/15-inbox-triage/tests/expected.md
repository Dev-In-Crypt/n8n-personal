# Expected behaviour

`node tests/run.mjs` from this folder's parent. Needs Node 18+ and nothing else: no n8n,
network, mailbox, database or model. Every test reads its code out of `workflow.json`.
The two contracts this workflow leans on are checked against the other workflows' own
files: the dedup key against workflow 02's "Build keys", and the answer schema against
workflow 03's validator. No `crypto` is provided to the node code, because the live
sandbox has none.

## The fixture

The spec asked for ten emails, "3 need action, 1 urgent, 6 informational", and for 3 tasks
and 1 alert. Read literally that is nine emails with the urgent one among the three. The
tenth is used to exercise the third definition-of-done item in the same run: it is a
prompt-injection attempt whose classification fails, standing in for an outage.

| Email | What the model says | Result |
|---|---|---|
| m01 invoice overdue | action, **high** | task, alert, label |
| m02 contract review | action, normal | task, label |
| m03 call request | action, low | task, label |
| m04 to m09 | no action | recorded as triaged, left untouched |
| m10 injection attempt | classification fails | nothing recorded, retried next run |

Expected: 3 tasks, 1 alert, 9 recorded, 1 retried. On a second run over the same mail only
m10 is classified again.

## The 52 checks

**Config (4).** Refuses to run unconfigured, and ships with all three placeholders blank.
The query skips promotions, social and anything already labelled. The tasks upsert names
its conflict column.

**Prepare batch (9).** Ten in, ten out. The model sees at most 1500 characters of body,
and a long body is cut to exactly that. HTML is reduced to text. The key is byte-identical
to what workflow 02 stores, checked by running 02's own code, and is a real SHA-256. The
link points at the thread. An empty batch still builds a valid lookup url, a message
without an id is skipped, and headers are read from the raw payload shape too.

**Drop already triaged (4).** Nothing seen means everything is classified; mail 02 has
recorded is not classified again; the gate is asked about exactly this batch; and an empty
answer from the lookup is not mistaken for a seen id.

**The classification request (6).** One request per email. The model sees from, subject
and body and nothing else. The prompt treats the email as data. Workflow 03's validator
accepts a well-formed answer against this schema and rejects an invented urgency and a
string where a boolean belongs.

**The spec fixture (11).** Three tasks, one urgent. Nine classified, one failed. The failed
email is not recorded, so it is retried. Informational mail is recorded so it is never paid
for twice. Only actionable mail is labelled. A task row has exactly eight columns, a link
and one line of context, and nothing in the rows comes from a body. An overlong answer is
cut to fit the table. A `needs_action` with an empty action counts as a failure. Usage is
summed across every attempt, failed ones included.

**Failure modes (3).** An LLM outage leaves all ten untriaged and nothing recorded.
Misaligned answers are trusted for nothing. A sub-workflow error item is a failure, not a
crash.

**Re-run (2).** A second run over the same mail classifies only m10, with one request.

**Plan alerts (3).** One alert for the urgent task, with the link. A task that already
existed does not alert again. Twenty-five urgent tasks fit one message with the rest counted.

**Workflow file (10).** No node marks mail read, archives, trashes, sends or replies; the
only change to a message is adding the Triaged label. The fetch limit matches the code.
An empty lookup answer and an empty insert answer both still reach the next node. The
budget is checked before anything is classified, and an over-budget run simply stops. Mail
is recorded as triaged last, after the tasks are saved. A failed classification or spend
log cannot stop the run. The sub-workflows are 02, 03 and 12a. Ships inactive, without
credentials, without `crypto`, in English only.
