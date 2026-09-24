# 17. Competitor page change monitor

Built from `SPEC.md`. Every morning it reads a list of competitor pages, compares each one
against what it said yesterday, and sends you the ones that actually changed - with the old
line and the new line side by side.

## Nodes

| Node | Type | Role |
|---|---|---|
| Every day at 09:30 | `scheduleTrigger` v1.3 | the daily run |
| Config | `code` v2 | every knob a human sets |
| Read the page list | `httpRequest` v4.4 | `competitor_pages` where enabled |
| Prepare the batch | `code` v2 | validates, dedupes, hashes urls, builds the fetch request |
| Fetch the pages | `executeWorkflow` v1.3 | workflow 11, `ttl_hours: 0` |
| Fan out pages | `code` v2 | one item per page, fetch failures kept in line |
| Extract the section | `html` v1.2 | the text under the page's own selector |
| Read the last snapshots | `httpRequest` v4.4 | one lookup for the whole batch |
| Detect changes | `code` v2 | normalise, hash, compare, diff |
| Any baselines? / Save baseline snapshots | `if` v2.3, `httpRequest` v4.4 | first sightings, stored and not sent |
| Anything changed? | `if` v2.3 | the only door to spending anything |
| Build the budget check / Check the budget / Within budget? | `code` v2, `executeWorkflow` v1.3, `if` v2.3 | workflow 12a |
| One request per change | `code` v2 | prompt and schema |
| Classify each change | `executeWorkflow` v1.3 | workflow 03, one call per change |
| Collect verdicts | `code` v2 | pairs verdicts with pages, splits alerts from sheet rows |
| Build the spend log / Log spend | `code` v2, `executeWorkflow` v1.3 | what the run cost, into the ledger |
| Any alerts? / One message per alert / Alert in Telegram | `if` v2.3, `code` v2, `telegram` v1.2 | the loud path |
| Any sheet rows? / One row per change / Append to the sheet | `if` v2.3, `code` v2, `googleSheets` v4.7 | the quiet path |
| Save changed snapshots | `httpRequest` v4.4 | only what was classified |
| Nothing changed / Over budget | `noOp` v1 | quiet ends |

## The decisions that matter

**Noise is killed before the hash, not after.** The spec's test expects the footer-year
change to come back from the model as `change_type: noise`. It never reaches the model
here. Dates, timestamps, relative times ("2 hours ago"), copyright years, uuids, long hex
ids, cache-busting query parameters and counters ("1,240 companies") are replaced with
placeholders before the text is hashed, so a page that only moved its clock hashes
identically to yesterday and the run ends there. That is a deviation from the letter of the
spec's test and the point of its first definition-of-done box: a monitor that pays a model
to tell it "this was noise" every morning is a monitor that gets muted. `noise` still
exists as a class, for whatever slips through.

**Prices are numbers too.** The obvious way to kill counter noise is to scrub numbers, and
it would blind the whole workflow. Every counter rule here requires a noun next to the
number - `users`, `companies`, `downloads` and so on - so `$19/month` survives untouched.
The test asserts both halves: the counter is normalised and the price is still there.

**An empty extraction is never an empty page.** A selector that stops matching, because the
competitor redesigned, yields no text. Treating that as "the page is now blank" would
overwrite a good snapshot with nothing and produce one enormous fake diff the next morning.
Those pages are recorded as failures and their snapshots are left alone.

**Nothing is marked as seen until it has been explained.** Snapshots for changed pages are
written at the very end, and only for changes the model classified. A run that dies at
Telegram, or a page the model could not make sense of, is picked up again tomorrow rather
than being silently swallowed. The cost is one repeated classification per failed page.

**The first run is quiet by construction.** A page with no stored snapshot takes a baseline
and stops. It is not a flag that has to be reset; it is what "no previous hash" means.

**The alert leads with the old and the new line.** The model's summary is above them, but
the removed and added lines are the message - a summary alone is something you have to
trust. If the diff cannot fit in one Telegram message it is cut down to the first five
lines of each side, with the rest still in the sheet, rather than being sent as two
messages or failing to send.

**The diff is bounded on both axes.** LCS is quadratic, so each side is capped at 600 lines
and the carried changes at 60. A competitor who ships a ten-thousand-line page does not get
to turn one run into a stalled execution.

**The sheet is written as RAW.** A removed line that starts with `=` or `+` would be
interpreted as a formula by Google Sheets and land in the sheet as an error.

## Verification

Deployed to the live instance as `nGZJN72kgQmNlztF` and validated with n8n-mcp's **strict**
profile: **0 errors**, 19 warnings. The deployed graph was read back and matches this file
node for node. The warnings are the accepted classes: "Code nodes can throw errors" (they
are meant to), "Hardcoded nodeCredentialType" on the four Supabase calls, the three
deliberate `executeOnce` flags, and one stale warning asking for `valueInputMode` on a
Google Sheets node whose current version calls that option `cellFormat`, which is set.

`tests/run.mjs` runs every Code node straight out of `workflow.json`, with `crypto` left
undefined so any node reaching for it fails here rather than in production. Sixty-three
checks, all passing:

```
npm i luxon
node tests/run.mjs
```

Both copies of the SHA-256 implementation are checked against Node's own `createHash`, and
against each other, so the two cannot drift apart.

## Definition of done

- [x] noise such as counters and dates produces no alerts
- [x] the first run only takes the baseline snapshots, with nothing sent
- [x] the alert shows the old and the new value, not only that something changed

All three are checked by tests that run the real node code: the footer-year and counter
fixture produces zero changes, a page with no snapshot produces a baseline and no change,
and the message built for the price fixture contains both `$19/month` and `$24/month`.

**What is not verified:** no live run. The HTML node's own extraction is not exercised by
the tests - they use a small stand-in that turns the fixtures into text - and no real
competitor page has been fetched. The first real run is what proves the selector column.

## What is left to a human

1. Apply `schema.sql`, then fill `competitor_pages` with the pages worth watching. A
   narrow `selector` (`main`, `.pricing`, `.changelog`) is worth the minute it takes; the
   whole `body` works but diffs noisily.
2. Set `SUPABASE_URL`, `ALERT_CHAT_ID` and `SHEET_ID` in "Config", and create the sheet tab
   with a header row matching the columns: `checked_at, competitor, page_type, url,
   change_type, significance, alerted, summary, quote, removed, added`.
3. Attach the credentials and repoint the three sub-workflow nodes at your copies of 11,
   12a and 03.
4. Run it once by hand. Every page becomes a baseline and nothing is sent; that is correct.
   Run it again the next day to see the first real comparison.
5. Activate it.

## Limitations

- **It reads pages as a plain HTTP client.** A page rendered entirely in JavaScript will
  look empty, and a page behind bot protection will answer with a challenge. Neither is
  worked around on purpose: the spec puts that out of scope. Such pages show up as failures
  in the run, not as silent gaps.
- **robots.txt is not fetched.** The page list is owner-curated, so the decision about what
  may be watched is made by a human when the row is added, not by the workflow.
- **A redesign looks like a huge change.** The first run after a competitor rebuilds a page
  produces one very large diff, and after it the new shape becomes the baseline.
- **One row per page, no history.** `page_snapshots` keeps the latest text only. The trail
  of what changed over time is the Google Sheet.
- **Significance is a model's opinion.** The threshold of 6 is a knob in "Config", and the
  sheet holds everything, so a threshold set too high loses nothing but immediacy.
