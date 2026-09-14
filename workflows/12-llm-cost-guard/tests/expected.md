# Expected behaviour

Run the suite with `node tests/run.mjs` from this folder's parent. It needs Node 18 or
newer and `luxon`, which is the one thing the Code nodes here depend on that plain Node
does not provide - n8n injects `DateTime` into every Code node, confirmed by probing the
live instance. No n8n, no network and no database are needed.

Every test reads the code it exercises out of `workflow-guard.json` or
`workflow-report.json`, so a test can only pass against the files that actually ship.

## What the sample input demonstrates

`input.json` holds one call of each kind. The `log` call prices 1200 input and 300 output
tokens of `claude-haiku-4-5` at the table rate of $1 and $5 per million, which is
$0.0027, and writes one ledger row. The `check` call adds $0.05 to whatever has been spent
since local midnight and compares the total to the cap in `llm_guard_config`.

## The 82 checks

**Prepare, mode and configuration (9).** Refuses to run with no project url and refuses to
run with no alert chat, and both placeholders are still blank in the shipped files. Infers
`log` from a `usage` field and `check` from an `estimated_cost_usd` field, refuses a
request carrying both rather than guessing between them, refuses one carrying neither, lets
an explicit `mode` win over the inferred one, and rejects any other mode.

**Prepare, logging (13).** Accepts a well-formed call. Requires `workflow_name` and
`model`. Rejects a negative, fractional, textual, missing or absurd token count for both
`input_tokens` and `output_tokens`, while accepting zero as a real call. Turns a missing
`purpose` into null rather than the string "undefined", truncates an overlong one instead of
rejecting it, and percent-escapes a model name containing spaces, slashes or plus signs
before putting it in the price lookup url.

**Prepare, the gate (6).** Accepts a well-formed estimate, including zero, and rejects a
negative or non-numeric one. The day starts at local midnight, in a named timezone that is
not UTC, and the spend lookup is an rpc rather than a row scan.

**Price the call (9).** Cost is tokens times the table price, rounded to six places so
float noise does not reach the ledger, and the row written matches what was priced. A model
that is not in the table is recorded with its real token counts, a cost of zero, `priced`
false and an alert - never a guessed price. A price row for a different model is not used
by mistake. A price that is not a number, or is negative, throws rather than silently
costing nothing. Zero tokens costs zero but still counts as priced, and a priced call
raises no alert.

**Log result (1).** The caller is told whether the call was actually priced, so it cannot
mistake "no price on file" for "free".

**Decide (13).** Under the cap is allowed, exactly at the cap is allowed, and a cent over
is refused with an alert. A total already past the cap refuses even a zero-cost call. An
empty ledger means nothing spent rather than an error. A cap that is missing, non-numeric
or negative refuses the call instead of reading as "no limit". A total that is null or
absent refuses too, because `Number(null)` is zero and a broken answer must not look like a
quiet day. Unpriced calls are carried into the verdict, a refusal says the total is a floor
when any exist and stays quiet when none do, and float addition does not leak into the
projection.

**Check result (1).** The verdict carries the numbers behind it: spend, estimate,
projection, cap, call count, unpriced count, and the day window it all refers to.

**Report window (3).** The window is a complete local day that has already closed, in the
same timezone the cap uses, and the schedule fires after it closes rather than before.

**Summarise (13).** The total is the sum of the groups and spend is grouped per workflow
across models. The three most expensive workflows lead the report, the rest are counted
rather than dropped, and a tie breaks on the name so the order does not wander between
runs. Models are broken out separately. Unpriced calls are called out, and a clean day says
nothing about them. A day with no spend sends nothing. Percentages do not divide by zero on
a free day. A cost that is not a number throws instead of vanishing from the total. Small
amounts keep four decimals and large ones two, and the message names the day it covers.

**Schema and workflow files (14).** Every rpc the workflows call exists in `schema.sql` and
every function in the schema is called by a workflow. The price list and the cap are both
tables, so neither can be changed by editing a node. The config table cannot grow a second
row. The ledger rejects negative tokens and negative money. Both workflows ship inactive
with no credentials, every node is reachable from a trigger, and both gate branches return
something to the caller. A Telegram outage cannot swallow the verdict, while the daily
report is deliberately left to fail loudly instead. No node undoes spending after the fact
and the ledger is only ever appended to. Nothing in either file, or in the schema, is
written in anything but English.
