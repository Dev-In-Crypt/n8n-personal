# Expected result

Input: `tests/input.json` holds one brand with two competitors, five prompts and the
answers the model would return. The harness runs the Code nodes; the API calls, the
write and Telegram are canned.

## Detection

- `p1`: brand mentioned, and `position` is 2 because Moonlit is named first
- `p2`: brand mentioned by alias, and the domain appears, so `cited` is true and
  `position` is 1
- `p3`: brand not mentioned, `position` null, competitors present
- `p4`: "Lunelabs" and "Lune" must not count as "Lunela". Word boundaries, not substrings
- `p5`: the call failed, so nothing is recorded for that prompt

A failed call is not recorded as a miss. Writing it as `mentioned: false` would invent a
drop that never happened, which is worse than a gap in the series.

## Rows

- every row carries `run_date`, `model`, `brand_id`, `prompt_id`
- the primary key is `(run_date, prompt_id, model)` and the insert uses
  `resolution=ignore-duplicates`, so re-running the same day changes nothing

## Comparison

- with a previous run present, the report shows both shares and the delta in points
- prompts that were mentioned before and are not now are listed as lost
- prompts newly mentioned are listed as gained
- history from a different model is ignored, since a share is only comparable within one
  model
- with no history at all, the report says so instead of inventing a baseline
- the previous run is the most recent earlier `run_date`, so a skipped week still
  compares against a real measurement

## Report

- HTML is escaped
- the footer names the model and the run date and states that this is measurement only
