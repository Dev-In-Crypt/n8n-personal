# 07. EU Funding Radar

- **slug:** `eu-funding-radar`
- **category:** portfolio
- **depends_on:** 01, 02, 03

**Goal.** Monitor European grants, calls and tenders and score them against an applicant
profile held in configuration. Deliberately generic: no country, legal entity or
applicant is hardcoded anywhere.

**Trigger.** `Schedule Trigger`, daily at 08:00.

**Flow.**
1. Read the applicant profile from the database: domains, keywords, allowed countries,
   budget range, required and disqualifying terms.
2. Read the source list and fetch each one. Every source normalises into
   `{ id, source, title, url, deadline, budget, summary, country }`.
3. Call workflow 02 with `source = 'eu-funding'` to drop anything already seen.
4. Hard filter in code before any model is involved: deadline in the future, budget in
   range, country allowed, required keywords present.
5. Call workflow 03 with the schema `{ relevance_0_100, matched_criteria,
   blocking_reasons, evidence_quote, evidence_url }`.
6. Verify every `evidence_quote` against the fetched text. A quote that is not a literal
   substring marks the item `unverified` and lowers its score.
7. Relevance 70 or higher alerts. Everything else is stored only.

**Credentials.** `Supabase (dev)`, `Telegram Bot (alerts)`, and the credentials of the
workflows it calls.

**Test.** Fixtures per source. An item with a past deadline must be filtered before the
model runs. An item whose quote was fabricated must be marked `unverified`.

**Definition of done.**
- [ ] the hard filter removes most candidates before any model call, visibly in counters
- [ ] quote verification works and catches a fabricated quote
- [ ] the applicant profile is nowhere in the workflow, only in configuration

**Out of scope.** Do not submit applications and do not write emails. Signal only.
