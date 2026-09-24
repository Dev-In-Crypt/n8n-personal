# 17. Competitor page change monitor

- **slug:** `competitor-diff`
- **category:** product
- **depends_on:** 02, 03, 11, 12

**Goal.** Watch competitors' pricing, changelog and landing pages and get not the fact that
a page changed, but a clear description of what changed.

**Trigger.** `Schedule Trigger`, daily at 09:30.

**Flow.**
1. The list from Supabase `competitor_pages(url, competitor, page_type, selector, enabled)`.
2. Fetch through workflow 11 with `ttl_hours: 0` (the cache here is only for history).
3. `Code`: extract the text under `selector`, normalise it (drop timestamps, counters,
   random ids), compute a hash.
4. Hash equal to last time means stop. Otherwise build a text diff against the snapshot
   in `page_snapshots`.
5. The cost gate (workflow 12), then the LLM (workflow 03) with the schema
   `{ change_type: pricing|feature|copy|noise, summary_ru, significance_0_10, quote }`.
6. `significance >= 6` goes to Telegram with the diff. Everything else becomes a row in a
   Google Sheet.
7. Save the new snapshot.

**Input.** The page list. **Output.** Alerts, the sheet, snapshots.
**Credentials.** `Supabase (dev)`, `Anthropic API`, `Telegram Bot (alerts)`, `Google (john)`.

**Test.** Two versions of one HTML page as fixtures: a changed price (expecting
`change_type: pricing`, high significance) and a changed year in the footer (expecting
`noise`).

**Definition of done.**
- [ ] noise such as counters and dates produces no alerts
- [ ] the first run only takes the baseline snapshots, with nothing sent
- [ ] the alert shows the old and the new value, not only that something changed

**Out of scope.** Do not bypass bot protection and do not ignore robots.txt.
