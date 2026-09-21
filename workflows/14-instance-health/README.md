# 14. Weekly instance health report

Built from `SPEC.md`. Every Sunday evening: what ran, what failed, what got slower, and
what should have run and did not, in one Telegram message, with a week-by-week record in
`health_snapshots`.

## Nodes

| Node | Type | Role |
|---|---|---|
| Every Sunday at 20:00 | `scheduleTrigger` v1.3 | weekly run |
| Prepare | `code` v2 | config and the seven-day window |
| List workflows | `httpRequest` v4.4 | which workflows exist and which are active |
| Read executions | `httpRequest` v4.4 | paginated, stops at the start of the week |
| Read last snapshot | `httpRequest` v4.4 | last week's numbers, if any |
| Aggregate | `code` v2 | per-workflow numbers and the flags |
| Anything flagged? | `if` v2.3 | a clean week skips the model |
| Build summary request | `code` v2 | the request for workflow 03 |
| Ask for a summary | `executeWorkflow` v1.3 | calls workflow 03 |
| Build report | `code` v2 | one Telegram message, always |
| Save snapshot | `httpRequest` v4.4 | upsert on the week |
| Send report | `telegram` v1.2 | the message |

## The decisions that matter

**Silence is the thing this report exists to catch.** Every active workflow gets a row even
with zero executions, so "did not run" is a flag rather than an absence. Inactive workflows
are the exception: they are not supposed to run, and flagging a dozen of them every Sunday
would teach you to skip the report. They are counted in one line instead.

**The numbers are the report; the model is an extra.** The summary from workflow 03 can be
missing, malformed or late, and the report still goes out with every number in it, saying
the summary was unavailable. The call carries `onError: continueRegularOutput`, and a clean
week does not call the model at all.

**The model only explains, it does not discover.** It is sent the flagged workflows and
nothing else, told to name them exactly, and any issue it raises about a workflow that was
not flagged is dropped and counted. A model inventing a problem with a healthy workflow is
worse than one that says nothing.

**A slowdown needs a real change, not a ratio.** The spec said "median doubled". A
workflow going from 200 ms to 500 ms has more than doubled and means nothing. So a slowdown
is flagged only when the median at least doubled *and* grew by at least a second. Both
thresholds are constants in "Prepare".

**Exactly 20% is not flagged.** The spec said above 20%, and a test pins the boundary with
a workflow that fails exactly one run in five.

**A partial week says so.** Executions are paged with a cap of 40 pages of 250. If the cap
is hit before reaching the start of the week, the report opens with a line saying the
counts are a subset. Presenting a truncated week as a full one would be the one thing worse
than not reporting.

**Last week is read strictly before this week.** The snapshot is keyed by the Monday of
the report's week and saved as an upsert, so a re-run on the same Sunday overwrites its own
row, and the comparison query asks for `week_start < this Monday` so it never compares the
week with itself.

**Last success carries over.** A workflow that did not succeed this week keeps the date it
last succeeded from the previous snapshot, so the report can say how long something has
really been broken, not merely that it failed this week.

**One message, always.** Lines are added until the next one would pass Telegram's 4096
characters, and anything left out is counted in the final line. The model's summary is
capped at 700 characters so it cannot crowd out the numbers. Plain text, no parse mode, so
a workflow name with an underscore cannot break the message.

**The snapshot is saved before the message is sent.** If Telegram fails, the week is still
on record and the error handler in workflow 01 reports the failure.

## Verification

`validate_workflow` with the `strict` profile **against the live instance** (n8n-mcp
2.65.1): 12 nodes, 12 connections, 10 expressions, **zero errors**. That includes the
pagination block on "Read executions" and the call to workflow 03 by its real id on this
instance.

The validator suggested `alwaysOutputData` on the two n8n API reads. Declined on purpose:
if the API call fails, an empty result would make every active workflow look silent, and
the report would announce that nothing ran. Failing loudly lets workflow 01 report the real
problem instead.

`tests/run.mjs` runs the Code nodes straight out of `workflow.json`, including the
200-execution fixture the spec asked for, with every metric known in advance. Fifty-eight
checks, all passing:

```
npm i luxon
node tests/run.mjs
```

`tests/expected.md` has the fixture table and lists all fifty-eight.

## Definition of done

- [x] a workflow that did not run all week appears in the report
- [x] the week-on-week comparison works when a snapshot exists and does not fail when it does not
- [x] the report fits in one Telegram message

Each is a test: the silent active workflow in the fixture is flagged; the comparison is run
with a snapshot, with an empty snapshot, and with the snapshot read never having happened;
and a hundred flagged workflows with long names and a 2000-character summary still produce
a message under 4096 characters.

## What is left to a human

1. Apply `schema.sql`.
2. Create the **n8n API**, `Supabase (dev)` and `Telegram Bot (alerts)` credentials; the
   Anthropic credential lives in workflow 03.
3. Set `SUPABASE_URL` and `ALERT_CHAT_ID` in "Prepare".
4. Repoint "Ask for a summary" at your copy of workflow 03.
5. Run it once by hand. The first report will say there is no earlier snapshot; that is
   expected, and the second week will compare.

## Limitations

- **The window is rolling seven days**, Sunday 20:00 to Sunday 20:00, not a calendar week.
- **Executions n8n has pruned are invisible.** If execution data is kept for less than a
  week, the report sees less than a week and cannot tell.
- **Sub-workflows that were not called are not flagged** if they are inactive, which they
  usually are. Whether they should have been called is their caller's problem to report.
- **The model's summary costs a call on every week with a flag.** Haiku keeps that to a
  fraction of a cent, and the call goes through workflow 03, so it lands in the ledger of
  workflow 12 once 03 reports its usage there.
