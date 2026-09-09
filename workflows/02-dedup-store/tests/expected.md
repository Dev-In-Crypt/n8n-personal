# Expected result

Input: `tests/input.json`, five items keyed by `url`, source `digest`.

## Run 1, empty table

- `new_items` has 5 entries, in input order
- `skipped` is 0
- `rows` sent to the insert carry `hash`, `source`, `first_seen_at`, `payload_preview`
- exactly one insert call for the whole batch

## Run 2, same input, table now holds those hashes

- `new_items` is empty
- `skipped` is 5
- the IF routes to `Return result` and no insert call is made

## Same key twice inside one batch

- the duplicate is collapsed before the database is touched
- `duplicates_in_batch` reports how many were collapsed

## Empty batch

- the select URL degrades to `hash=in.("__none__")` rather than the invalid `in.()`
- `new_items` empty, `skipped` 0, no insert

## Missing key field

- the workflow throws with the offending item named, rather than silently hashing
  `undefined` and poisoning the table

## Preview

- `payload_preview` never exceeds 200 characters
