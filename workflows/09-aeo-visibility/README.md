# 09. AI search visibility monitor

Built from `SPEC.md`. Asks a model a set of target prompts every week and records
whether a brand appears in the answers, where, and whether its domain is cited.

## What it does

| Node | Type | Role |
|---|---|---|
| Every Monday at 09:00 | `scheduleTrigger` v1.3 | weekly measurement |
| Config | `code` v2 | database url, chat, model, run date |
| Load brands | `httpRequest` v4.4 | brands, aliases and competitors are rows |
| Load prompts | `httpRequest` v4.4 | prompt set is data, not code |
| Build measurement requests | `code` v2 | one request per prompt |
| Ask the model | `httpRequest` v4.4 | plain question, no schema attached |
| Detect mentions | `code` v2 | name, alias and domain detection, position ranking |
| Load previous runs | `httpRequest` v4.4 | the baseline for the delta |
| Compare and report | `code` v2 | shares, delta, lost and gained |
| Store measurements | `httpRequest` v4.4 | one batch insert, duplicates ignored |
| Send report | `telegram` v1.2 | one weekly message |

## The decisions that matter

**It does not use workflow 03.** Every other composite here routes model calls through
03 for schema validation and retries. Doing that here would break the measurement: 03
appends "answer with a single JSON object and nothing else" plus a schema to the system
prompt, and that changes the answer being measured. The whole point is to see what a
normal user would get, so the prompt is sent exactly as written and the structure is
extracted afterwards, in code. A test asserts the request carries no JSON instruction.

**A failed call is a gap, not a zero.** If the API errors, that prompt is not recorded.
Writing it as `mentioned: false` would manufacture a drop in the series that never
happened. The report says how many prompts failed, so a suspiciously good or bad week is
explainable.

**Detection uses word boundaries, not substrings.** A brand called Lunela must not match
"Lunelabs", and a brand called Lune must not match "Lunela". Names are regex-escaped and
wrapped in explicit non-alphanumeric boundaries with the Unicode flag, so accented names
work too. Domains are matched as plain substrings, since a domain is already unambiguous.

**Position is a rank, not an offset.** "Third thing mentioned" is what a human means by
position, and it stays comparable across answers of different lengths. Competitors come
from the brand row, so the ranking is against a tracked set rather than against whatever
the model happened to name.

**The baseline is the most recent earlier run, not "seven days ago".** A skipped week
still compares against a real measurement instead of against nothing. History from a
different model is ignored entirely, because a share is only comparable within one model.

**Re-running the same day is a no-op.** The primary key is
`(run_date, prompt_id, model)` and the insert sends `resolution=ignore-duplicates`.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors.

`tests/run.mjs` runs the three Code nodes against canned answers. Thirty-three checks,
all green:

```
node tests/run.mjs
```

Covered: the request carrying no JSON instruction, a mention ranked second behind a
competitor, an alias match, a domain citation, a prompt with no mention, "Lunelabs" and
"Lune" correctly not matching "Lunela", a failed call absent rather than recorded as a
miss, run date and model on every row, the duplicate-ignoring insert header, the delta
against the latest earlier run, lost and gained prompts, history from another model
ignored, a first ever run inventing no baseline, and the footer naming model and date.

## Definition of done

- [x] the same week is never recorded twice for the same prompt and model
- [x] the model and its version are stored on every row
- [x] the report shows a delta, not only absolute numbers

## What is left to a human

1. Apply `schema.sql`, insert a brand with its aliases and competitors, and a set of
   prompts.
2. Create the `Supabase (dev)`, `Anthropic API` and `Telegram Bot (alerts)` credentials
   and select them.
3. Set `SUPABASE_URL`, `CHAT_ID` and `MODEL` in "Config".
4. Run it once by hand. The first run has no baseline and will say so.

## Limitations

- One model per workflow copy. Measuring several means several copies, each with its own
  `MODEL`, which is deliberate: the rows stay comparable within a model.
- Model answers vary between identical calls. A single weekly sample is a signal, not a
  measurement with error bars. Reading week-to-week noise as a trend is the main way to
  misuse this.
- Detection is lexical. A model that describes the product without naming it counts as
  not mentioned, which is the honest reading for visibility.
- No web-search variant. Answers reflect the model alone, not a retrieval layer.
