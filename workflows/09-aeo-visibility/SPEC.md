# 09. AI search visibility monitor

- **slug:** `aeo-visibility`
- **category:** product
- **depends_on:** 02, 03

**Goal.** Measure whether a brand appears in model answers to a set of target prompts,
and how that changes week over week.

**Trigger.** `Schedule Trigger`, weekly, Monday 09:00.

**Flow.**
1. Read `brands(id, name, domain, aliases)` and `prompts(id, brand_id, text, intent)`.
2. Ask the model each prompt and keep the answer.
3. Detect mentions of the brand and of its competitors by name, alias and domain.
   Record `mentioned`, `position`, `cited`.
4. Write one row per prompt per model into `visibility_runs(run_date, brand_id,
   prompt_id, mentioned, position, cited, model)`.
5. Compare with the previous run and report share of mentions, the delta, and where
   the brand lost ground.

**Credentials.** `Supabase (dev)`, `Anthropic API`, `Telegram Bot (alerts)`.

**Test.** One brand, five prompts, canned answers. Check that `position` is computed
correctly and that an alias match counts, not only the exact name.

**Definition of done.**
- [ ] the same week is never recorded twice for the same prompt and model
- [ ] the model and its version are stored on every row
- [ ] the report shows a delta, not only absolute numbers

**Out of scope.** Do not draw conclusions about causes. Record the fact.
