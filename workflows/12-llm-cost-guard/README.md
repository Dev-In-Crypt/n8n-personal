# 12. LLM spend log and daily cap

Built from `SPEC.md`. Two workflows, because a thing other workflows call and a thing the
clock calls have nothing in common but the ledger: `workflow-guard.json` and
`workflow-report.json`.

The guard does two jobs on one trigger. `mode: "log"` records what a call cost.
`mode: "check"` says whether the next call may happen.

```
{ mode: "log", workflow_name, model, usage: { input_tokens, output_tokens }, purpose }
  -> { logged, cost_usd, priced, ... }

{ mode: "check", estimated_cost_usd }
  -> { allowed, spent_today, projected, limit, unpriced_today, day_start, timezone }
```

## The guard

| Node | Type | Role |
|---|---|---|
| When called by another workflow | `executeWorkflowTrigger` v1.2 | passthrough input |
| Prepare | `code` v2 | validates, picks the mode, builds the day window |
| Log or check? | `switch` v3.4 | the two jobs part company here |
| Read price | `httpRequest` v4.4 | one row from `model_prices` |
| Price the call | `code` v2 | tokens into money, or an honest refusal to guess |
| Write usage | `httpRequest` v4.4 | one row into the ledger |
| Priced? | `if` v2.3 | was the model in the price list |
| Alert unpriced model | `telegram` v1.2 | tells you the cap has a blind spot |
| Log result | `code` v2 | what was recorded |
| Read the cap | `httpRequest` v4.4 | `daily_limit_usd` |
| Read today | `httpRequest` v4.4 | today's total, aggregated in the database |
| Decide | `code` v2 | spend plus estimate against the cap |
| Allowed? | `if` v2.3 | verdict |
| Alert cap reached | `telegram` v1.2 | says why a call was refused |
| Check result | `code` v2 | the verdict and the numbers behind it |

## The report

| Node | Type | Role |
|---|---|---|
| Just after midnight | `scheduleTrigger` v1.3 | 00:05 local |
| Prepare window | `code` v2 | the local day that just ended |
| Read the day | `httpRequest` v4.4 | grouped totals via rpc |
| Summarise | `code` v2 | ranking, shares, the message |
| Anything spent? | `if` v2.3 | silence on a quiet day |
| Send report | `telegram` v1.2 | one message |
| Nothing spent | `noOp` v1 | quiet end |

## The decisions that matter

**An unknown model is recorded, never priced.** The obvious shortcut is to treat a model
missing from `model_prices` as costing zero. That is how a cap becomes decorative: the
tokens are real, the spend is real, and the number guarding your wallet does not move. The
tokens are written to the ledger with `priced: false`, a Telegram alert fires immediately,
and every verdict carries `unpriced_today`. Where that count is above zero, `spent_today` is
a floor, not the truth, and the workflow says so rather than letting you assume otherwise.
Inventing a plausible price instead would have been worse: a wrong number that looks right.

**The totals are computed in the database.** `llm_spend_since` and `llm_spend_report` are
SQL functions. Selecting the day's rows and summing them in a Code node would be simpler and
would work perfectly until the day a busy run pushes the row count past the REST limit, at
which point the total silently shrinks and the cap starts letting everything through. A cap
that under-reports is not a cap.

**A missing cap refuses.** If `llm_guard_config` cannot be read, or holds something that is
not a number, `Decide` throws. It would be easy to fall back to "no limit found, carry on",
and that is exactly the behaviour you do not want at 3am. A blocked call is a nuisance; an
unbounded bill is not.

**`Number(null)` is zero, which nearly cost this workflow its purpose.** A null total from
the spend query would have read as "nothing spent today" and waved through a call the real
total might have blocked. A total that is absent or null is now treated as a broken answer,
not a quiet day. A test caught this; the first draft had the bug.

**The day is local, not UTC.** A UTC day resets the budget at 01:00 or 02:00 in Spain,
which is neither what a daily limit means to a person nor what the report covers. The
boundary comes from luxon's `DateTime` with a named timezone, so it survives daylight
saving. Both workflows read the same `TIMEZONE` constant, and a test asserts they agree.

**The report runs after midnight, not at 23:00.** The brief said 23:00. A report that runs
at 23:00 and covers midnight to 23:00 leaves the last hour of every single day in no report
at all - this run's window ends before it and the next run's window starts after it.
Running at 00:05 over the day that just closed has no gap, no overlap, and covers exactly
the same day the cap counts.

**A Telegram outage cannot swallow the verdict.** Both alert nodes in the guard run with
`onError: continueRegularOutput`, so if Telegram is unreachable the alert is lost but the
caller still learns whether it may spend. The daily report does the opposite on purpose: it
is allowed to fail loudly, because a report that quietly fails to arrive is worse than one
that raises an error for workflow 01 to catch.

**Ties break on the name.** Two workflows that cost exactly the same would otherwise swap
places between runs depending on row order, which reads as movement that did not happen.

## Verification

`validate_workflow` with the `strict` profile **against the live instance** (n8n-mcp
2.65.1). The guard: 15 nodes, 16 connections, 13 expressions, **zero errors**. The report:
7 nodes, 6 connections, 5 expressions, **zero errors**.

Before writing any of the date handling, a throwaway probe workflow was deployed, executed
and deleted to find out what the Code node sandbox actually provides. It reported luxon's
`DateTime` present with working named-timezone support, along with `Intl`, `$now` and
`$today`. The timezone handling here is built on what that probe found rather than on what
the documentation implies - the same sandbox, as workflow 11 discovered, has no `crypto` at
all.

`tests/run.mjs` executes the Code nodes straight out of both workflow files. Eighty-two
checks, all passing:

```
npm i luxon
node tests/run.mjs
```

`tests/expected.md` lists all eighty-two.

## Definition of done

- [x] the price list lives in a table, not in a node's code
- [ ] workflow 03 reports its usage to this logger
- [x] the report names the three most expensive workflows

The middle box is deliberately unticked. Workflow 03 is already built and committed, and
amending it means changing its `workflow.json`, its tests and its README. `SPEC.md` permits
it; this folder has not done it. Until it is done, nothing is feeding the ledger
automatically and the cap has nothing to count.

## What is left to a human

1. Apply `schema.sql`. It creates three tables and two functions, and seeds four model
   prices. **Check those prices against current published pricing before trusting them** - a
   stale price produces a wrong ledger, which is harder to notice than an empty one.
2. Create the `Supabase (dev)` and `Telegram Bot (alerts)` credentials.
3. Set `SUPABASE_URL` and `ALERT_CHAT_ID` in "Prepare" and in "Prepare window". Both
   workflows refuse to run until you do.
4. Set `daily_limit_usd` in `llm_guard_config`. It seeds at $20.
5. Amend workflow 03 to call the guard with its usage, or the ledger stays empty.
6. Activate the report. The guard stays inactive; it is only ever called.

## Limitations

- **The gate is advisory.** It returns `allowed: false`. Nothing here can stop a caller
  that ignores the answer, and nothing here can undo a call that already happened - which
  is what `SPEC.md` put out of scope.
- **A refused call alerts every time.** A caller that retries in a loop will produce a
  stream of identical Telegram messages. The gate has no memory of having already
  complained.
- **Two callers can both be allowed.** Each checks the total independently, so two
  simultaneous calls can each pass and together cross the cap. The window is milliseconds
  wide and the overshoot is one call.
- **The estimate is the caller's.** The gate compares against whatever `estimated_cost_usd`
  it is handed. A caller that underestimates gets waved through, and only the ledger
  afterwards shows what it really cost.
- **Prices drift.** `model_prices` is a table precisely so it can be corrected, but nothing
  here checks it against reality. An old price is a wrong total, silently.
- **Cached and batch tokens are not modelled.** Prompt caching and batch discounts are
  priced differently by most vendors; this ledger knows only input and output tokens, so it
  will overstate a heavily cached workload.
