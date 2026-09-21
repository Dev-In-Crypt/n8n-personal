# 14. Weekly instance health report

- **slug:** `instance-health`
- **category:** ops
- **depends_on:** 01, 03

**Goal.** Know which of the workflows actually work and which have been quietly failing
for three weeks. Without it the collection rots unnoticed.

**Trigger.** `Schedule Trigger`, Sunday 20:00.

**Flow.**
1. n8n API: executions for the last 7 days, page by page.
2. Aggregate per workflow: runs, error rate, median and worst duration, last success.
3. Flags: `never_ran_this_week`, error rate above 20%, median duration doubled against
   last week (compared with `health_snapshots`).
4. LLM via workflow 03, a short read-out with the schema
   `{ summary_ru, top_issues: [{ workflow, issue, suggested_check }] }`.
5. Store the week in `health_snapshots` and send the report to Telegram.

**Input.** None. **Output.** A report and a snapshot row.
**Credentials.** n8n API, `Anthropic API` (through 03), `Supabase (dev)`, `Telegram Bot (alerts)`.

**Definition of done.**
- [ ] a workflow that did not run all week appears in the report
- [ ] the week-on-week comparison works when a snapshot exists and does not fail when it does not
- [ ] the report fits in one Telegram message

**Out of scope.** Never disable a problematic workflow automatically.
