# 02. Dedup store on Supabase

Built from `SPEC.md`. A sub-workflow: give it a batch and a key field, get back only
the items that have never been seen. Call it with `Execute Workflow` from any monitor.

## Interface

Input:

```json
{ "source": "digest", "key_field": "url", "items": [ { "url": "...", "title": "..." } ] }
```

Output:

```json
{ "source": "digest", "new_items": [], "skipped": 5, "duplicates_in_batch": 0 }
```

## What it does

| Node | Type | Role |
|---|---|---|
| When called by another workflow | `executeWorkflowTrigger` v1.2 | entry point for `Execute Workflow` |
| Build keys | `code` v2 | validates input, hashes keys, builds the two REST URLs |
| Fetch seen hashes | `httpRequest` v4.4 | one PostgREST select filtered by the batch hashes |
| Diff against seen | `code` v2 | subtracts known hashes, prepares the insert rows |
| Any new items? | `if` v2.3 | skips the write when there is nothing to write |
| Insert new hashes | `httpRequest` v4.4 | one batch insert, `Prefer: resolution=ignore-duplicates` |
| Return result | `code` v2 | same output shape on both branches |

Decisions the spec did not spell out:

- **PostgREST over the Supabase node.** The dedup query needs `hash=in.(...)` for the
  whole batch in one call. The Supabase node's filters do not express `in`, so it would
  degrade into one request per item, which the definition of done forbids. The HTTP
  Request node uses the `supabaseApi` credential, so no key is stored in the workflow.
- **The batch is deduplicated against itself first.** The same key twice in one call
  must not become two rows. `duplicates_in_batch` reports how many were collapsed.
- **An empty batch keeps a valid URL.** `hash=in.()` is a syntax error in PostgREST,
  so the empty case falls back to `in.("__none__")`.
- **A missing key field throws.** Hashing `undefined` would write one poison row that
  silently swallows every future item with a missing key.
- **The reads are retried, never swallowed.** Both HTTP nodes use `retryOnFail` with
  three tries. They deliberately do not continue on error: if the select fails, every
  item would look new and the caller would re-alert its entire history.
- **`SUPABASE_URL` is a constant at the top of "Build keys"**, so there is a single
  place to edit. The project URL is not a secret; the key lives in the credential.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors. Remaining warnings are generic n8n advice about Code nodes and about the
credential type being named explicitly, which is exactly what is wanted here.

The "Build keys", "Diff against seen" and "Return result" logic is exercised outside
n8n by `tests/run.mjs`, which loads the code straight out of `workflow.json`. Seventeen
checks, all green:

```
node tests/run.mjs
```

Covered: five new on an empty table, zero new and five skipped on a repeat, hash
stability, source being part of the key, in-batch duplicate collapsing, the empty batch
URL, the missing key field throwing, and the 200 character preview cap.

## Definition of done

- [x] idempotency confirmed by two runs (runs 1 and 2 in `tests/run.mjs`)
- [x] insert is a single batch, not one call per item
- [x] a TTL cleanup query for rows older than 180 days exists in `schema.sql`

## What is left to a human

1. Apply `schema.sql` to the database.
2. Create a Supabase credential named `Supabase (dev)` and select it in both HTTP nodes.
3. Put the project URL into `SUPABASE_URL` in "Build keys".
4. Run it once against the real database to confirm the round trip. The offline tests
   cover the logic, not the network path.

## Limitations

- Retention is a query in `schema.sql`, not a schedule. Run it yourself or wire it into
  a maintenance workflow; the dedup path stays a pure read plus insert.
- `payload_preview` is `JSON.stringify(item)` truncated to 200 characters, meant for
  eyeballing rows, not for reconstructing the item.
