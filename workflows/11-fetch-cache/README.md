# 11. Rate-limited HTTP fetcher with cache

Built from `SPEC.md`. A sub-workflow other workflows call instead of reaching the network
themselves, so pacing, retries and the page cache live in one place rather than being
reinvented, slightly differently, in every monitor.

Input `{ urls: [], ttl_hours, timeout_ms }`, output
`{ results: [{ url, status, from_cache, content }], errors: [], stats: {} }`.

## Nodes

| Node | Type | Role |
|---|---|---|
| When called by another workflow | `executeWorkflowTrigger` v1.2 | passthrough input |
| Prepare batch | `code` v2 | validates, dedupes, hashes, builds the cache query |
| Read cache | `httpRequest` v4.4 | one rpc lookup for the whole batch |
| Split cache hits | `code` v2 | fresh rows served, the rest queued |
| Anything to fetch? | `if` v2.3 | the all-cached shortcut |
| Fan out misses | `code` v2 | one item per url, loop re-entry point |
| Fetch pages | `httpRequest` v4.4 | paced, with timeout and redirects |
| Classify responses | `code` v2 | fetched, retryable, or permanently failed |
| Retry anything? | `if` v2.3 | loop or finish |
| Which pause? | `switch` v3.4 | picks the wait length |
| Wait 2 / 8 / 30 seconds | `wait` v1.1 | the backoff ladder |
| Build result | `code` v2 | the shape callers rely on |
| Anything to cache? | `if` v2.3 | skip the write when nothing was fetched |
| Write cache | `httpRequest` v4.4 | upsert |
| Nothing fetched | `noOp` v1 | quiet end |

## The decisions that matter

**The pace is configuration, not a parameter.** `SPEC.md` had `max_rps` as a caller
argument. It is not one here. The pacing is done by the fetch node's own batching
settings, which are fixed in the file; a caller who passed `max_rps: 20` would be told
yes and then throttled at 3 anyway. So the knob does not exist, `RATE_PER_SECOND` is a
constant next to the node it describes, and a test fails if the constant and the node's
`batchSize` ever drift apart.

**404 and 500 are answers, not accidents.** Only 429, 502, 503 and 504 are retried, up to
three attempts. A 404 will still be a 404 on the third try; retrying it is how one dead
url turns into a hundred wasted requests against a host that is already unhappy with you.

**Retry-After beats the ladder, but only upward.** The pause is 2s, then 8s, then 30s. If
the server sends `Retry-After` asking for longer, that wins, because the server is the one
holding the rate limiter. If it asks for less, the ladder holds. A `Retry-After` sent as
an HTTP date rather than a number is ignored rather than read as zero.

**The accumulator travels inside the item.** Results collected on attempt one have to
survive the wait and reappear on attempt two. The obvious place to keep them is workflow
static data, which is also how a crashed execution leaves its leftovers for the next run
to silently inherit. Instead the accumulator rides on the first fanned-out item and is
read back by the classifier, so a run that dies takes its state with it.

**Nothing but a 2xx is ever written to the cache.** A 404 stored with a 24 hour ttl would
be served to every caller as though it were the truth until it expired.

**The cache read always emits an item.** PostgREST answers an empty cache with `[]`, which
n8n turns into zero items, which would skip every node downstream and hand the caller
nothing at all - on the cold-cache run, the most common one there is. The node runs with
`fullResponse` so an empty result is still one item with an empty body.

**A network error does not kill the batch.** `neverError` covers status codes, not a
timeout or a dns failure, so `Fetch pages` also runs with `onError: continueRegularOutput`
and the classifier treats a response with no status as a retryable failure.

**There is no hash, because the sandbox has none.** The first draft keyed the cache with
SHA-256 via `crypto.subtle`. A probe workflow run against the live instance came back with
`crypto is not defined`, and builtin module imports refused, so that draft would have died
on its very first node. The key is now a base64url encoding of the url: longer than a
digest, deterministic, and collision-free, which is the only property a cache key needs. It
will stay that way even if a future n8n exposes a hash, because changing the encoding would
change every key at once and silently empty the whole cache.

**The lookup is an rpc, not a query string.** Two hundred keys in a `url_hash=in.(...)`
filter is tens of kilobytes of url, which proxies and servers truncate or reject - and a
truncated filter does not error, it just returns fewer rows, so the cache would appear to
miss and every page would be refetched. `schema.sql` creates `page_cache_lookup(keys
text[])` and the keys travel in the request body. A test asserts the function the workflow
calls is the one the schema creates.

## Verification

`validate_workflow` with the `strict` profile **against the live instance** (n8n-mcp
2.65.1): 17 nodes, 20 connections, 12 expressions, **zero errors**. The `switch` node was
bumped to v3.4, the latest the instance offers, and all three of its outputs verified still
wired afterwards.

A throwaway probe workflow was deployed, executed and deleted to answer what the Code node
sandbox actually provides. It reported `crypto` undefined, `require('crypto')` refused as a
disallowed module, and `Buffer`, `btoa` and `TextEncoder` present. The cache key is built
from what that probe found, not from what the documentation implies.

`tests/run.mjs` executes the Code nodes straight out of `workflow.json` - no copies, so a
green run is about the file that ships. Seventy checks, all passing:

```
node tests/run.mjs
```

Covered: input validation and its bounds, duplicate urls collapsing to one fetch, keys
that are url-safe, deterministic, decodable and need neither `crypto` nor `Buffer`, a full
batch of two hundred keeping the lookup url under 200 characters, cold cache, fresh hit, stale row, `ttl_hours: 0` forcing a
refresh, a foreign cache row not being matched, classification of 2xx / 404 / 500 / 429 /
502 / 503 / 504 and of no response at all, the three-attempt cap, the 2-8-30 ladder,
`Retry-After` in both directions and when malformed, results surviving the retry loop, one
bad url not taking the good ones with it, non-2xx never cached, and the stats accounting
for every unique url. `tests/expected.md` lists all seventy.

## Definition of done

- [x] the pace is enforced by configuration, not by hope, and is visible in the workflow
- [x] 404 and 500 are not retried
- [x] one bad url does not fail the batch; it lands in `errors`

All three are backed by tests. The first is checked structurally: the test reads
`RATE_PER_SECOND` out of the code and `batchSize` out of the node and fails if they
disagree. Measuring the actual wall-clock spacing needs a live run, which is the open item
below.

## What is left to a human

1. Apply `schema.sql`. It creates the table and the `page_cache_lookup` function the
   workflow calls; the workflow will not find anything in the cache without the function.
2. Create the `Supabase (dev)` credential.
3. Set `SUPABASE_URL` in "Prepare batch". The workflow refuses to run until you do.
4. Smoke-test against a slow endpoint and confirm from the execution timestamps that
   requests really land three per second. This is the one claim no test can make.
5. Repoint your other workflows at this one.

## Limitations

- `respect_robots` from the original brief is not implemented. Honouring robots.txt means
  fetching and parsing it per host and caching that separately, which is a workflow of its
  own rather than a flag on this one.
- Pacing is per execution. Two runs of this workflow at the same time will each pace
  themselves to 3 per second and together hit 6.
- The pace is global, not per host. A batch spread over ten domains is still limited to 3
  requests per second in total.
- Content is truncated at 200,000 characters, and the whole body is stored in the database
  as text. A binary response will be stored as whatever its text decoding produced.
- Keys are the urls themselves, base64url encoded, so anyone with read access to
  `page_cache` can recover every url that was fetched. That is already true of the `url`
  column, but worth saying out loud before this is pointed at anything private.
- Cache rows are never expired by the workflow. `schema.sql` has the index for it; the
  cleanup is left to a scheduled delete.
