# Expected behaviour

`node tests/run.mjs` from this folder's parent. Needs Node 18+ and `luxon`, which n8n
injects into Code nodes as `DateTime`. No n8n, network, database or model needed. Every
test pulls its code out of `workflow.json`.

## The fixture the spec asked for

200 executions with metrics known in advance:

| Workflow | Runs | Failed | Error rate | Median | Worst |
|---|---|---|---|---|---|
| Alpha | 100 | 20 | 20% | 1495 ms | 1990 ms |
| Beta | 80 | 0 | 0% | 500 ms | 500 ms |
| Gamma | 20 | 10 (crashed) | 50% | 3950 ms | 4900 ms |
| Delta | 0 | - | - | - | - |
| Epsilon (inactive) | 0 | - | - | - | - |

Alpha sits exactly on the 20% line and is not flagged; Gamma is. Delta is active and silent
and is flagged. Epsilon is inactive and is counted, not flagged.

## The 58 checks

**Prepare (6).** Refuses to run unconfigured and ships with blank placeholders. The window
is exactly seven days, the snapshot key is a Monday, last week is read strictly before this
week so a re-run never compares with itself, and executions are listed without their data.

**The 200-execution fixture (10).** All 200 counted, crashed runs count as errors, per
workflow error rates, the median of an even count averages the middle pair, a constant
series has itself as the median, worst is the maximum, exactly 20% is not flagged while 50%
is, the silent active workflow is reported, the inactive one is counted instead, last
success is the latest successful stop, and flagged rows come first.

**Edges (9).** Executions outside the window are ignored, pages are merged, a running
execution is a run without a duration, a missing status is read from `finished`, a deleted
workflow still gets a named row, a canceled run is not an error, hitting the page cap
inside the week is reported as partial, reaching the start of the week is not, and a
paginated workflow list is reported as partial.

**Week on week (7).** No snapshot does not fail and flags no slowdown, a snapshot read that
never ran does not fail either, a doubled median over a second is a slowdown, a doubled
median of a few hundred milliseconds is noise, a slower-but-not-doubled median is not
flagged, last success carries over from last week when there is none this week, and the
snapshot row carries every workflow and the totals.

**The summary request (4).** Only flagged workflows reach the model, the schema is the one
the spec defined, the prompt names the report language, and a clean week asks the model
nothing.

**Build report (11).** Every flagged workflow is named. An issue the model raised about a
workflow that was not flagged is dropped and counted. The summary is used when it comes
back, a failed summary leaves the numbers intact, and a summary call that errored out
entirely does not break the report. A clean week says so. The first week says there is
nothing to compare with, and a partial week says so. A hundred flagged workflows still fit
one Telegram message, with the omitted lines counted. The summary is capped so it cannot
crowd out the numbers. The snapshot is passed through for saving.

**Workflow file (10).** Sunday 20:00. The snapshot read and the execution read run once
however many items precede them. Executions are paginated with a cap that stops at the
start of the week, and that cap matches what the code believes it is. A failed summary
call cannot stop the report, and the summary goes through workflow 03. The snapshot is
saved before the message is sent, and a re-run replaces the week. Nothing on the instance
is disabled or changed. Ships inactive, without credentials, in English only.
