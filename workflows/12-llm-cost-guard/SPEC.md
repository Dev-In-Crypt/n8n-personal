# 12. LLM spend log and daily cap

- **slug:** `llm-cost-guard`
- **category:** template
- **depends_on:** 01, 03

**Goal.** See what all this automation actually costs, and do not wake up to a hundred
dollar bill because a workflow got stuck in a loop.

**Triggers.** `Execute Workflow Trigger` for logging and for the gate,
`Schedule Trigger` for the daily report.

**Logging.**
1. Input: `{ mode: "log", workflow_name, model, usage: { input_tokens, output_tokens }, purpose }`.
2. Cost is computed from the `model_prices(model, in_per_mtok, out_per_mtok)` table.
3. A row goes into `llm_usage(ts, workflow_name, model, input_tokens, output_tokens,
   cost_usd, priced, purpose)`.

**The gate.**
4. Input: `{ mode: "check", estimated_cost_usd }`. Today's total is read from `llm_usage`.
5. If today's spend plus the estimate exceeds `daily_limit_usd`, return
   `{ allowed: false, spent_today, limit }` and send a Telegram alert. The calling
   workflow is expected to stop; nothing here can force it to.

**The report.**
6. Once a day at 23:00: spend broken down by workflow and by model, to Telegram.

**Credentials.** `Supabase (dev)`, `Telegram Bot (alerts)`.

**Definition of done.**
- [ ] the price list lives in a table, not in a node's code
- [ ] workflow 03 reports its usage to this logger
- [ ] the report names the three most expensive workflows

**Out of scope.** No blocking after the fact. The gate runs on the way in or not at all.
