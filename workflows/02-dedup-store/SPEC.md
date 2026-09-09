# 02. Dedup / state store on Supabase

- **slug:** `dedup-store`
- **category:** template
- **depends_on:** 01

**Goal.** A sub-workflow that takes a list of items and a key field and returns only
the ones never seen before. The base every monitor is built on.

**Trigger.** `Execute Workflow Trigger`.

**Flow.**
1. Input: `{ source: string, key_field: string, items: [] }`.
2. `Code`: compute `hash = sha256(source + ':' + item[key_field])`.
3. Select from `seen_items` filtered by those hashes.
4. `Code`: subtract the ones already seen.
5. Insert the new hashes with `hash`, `source`, `first_seen_at`, `payload_preview`.
6. Return `{ new_items: [], skipped: n }`.

**Table.** `schema.sql` in this folder:
`seen_items(hash text primary key, source text, first_seen_at timestamptz default now(), payload_preview text)`
plus an index on `source, first_seen_at`.

**Credentials.** `Supabase (dev)`.

**Test.** Run the same set of five items twice: five new the first time, zero new and
five skipped the second.

**Definition of done.**
- [ ] idempotency confirmed by two runs
- [ ] insert is a single batch, not one call per item
- [ ] a TTL cleanup query for rows older than 180 days exists in `schema.sql`

**Out of scope.** Do not store the full payload, only a preview of up to 200 characters.
