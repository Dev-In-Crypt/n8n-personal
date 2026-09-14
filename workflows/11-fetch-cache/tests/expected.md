# Expected behaviour

Run the suite with `node tests/run.mjs` from this folder's parent. It needs nothing but
Node 18 or newer: no n8n, no network, no database. Every test reads the code it exercises
out of `workflow.json`, so a test can only pass against the file that actually ships.

## What the sample input demonstrates

`input.json` asks for five urls, one of which is a duplicate. The workflow treats it as
four fetches, not five: `stats.requested` reports 5 and `stats.unique` reports 4.

With a cold cache and a server that answers 200, 200, 404 and 503-then-200, the caller
gets back three entries in `results`, one entry in `errors` for the 404, and two rows
written to the cache. The 404 is never cached, and the 503 is retried after a two second
pause before it succeeds.

## The 70 checks

**Prepare batch (21).** Rejects `urls` that is not an array, an empty list, more than 200
urls, a non-http scheme, and a blank entry. Rejects a negative or non-numeric `ttl_hours`,
and a `timeout_ms` outside 1000-120000. Accepts `ttl_hours: 0`. Collapses a repeated url
to one fetch. Produces url-safe keys that differ per url, are the same on
every run, and decode back to the url they came from. Sends those keys in the request body
of an rpc call rather than in a query string, and keeps the lookup url short even with a
full batch of two hundred. Defaults to a 24 hour ttl and a 15 second timeout. Confirms
the shipped file has no project url baked into it, and that it refuses to run until one is
set. Asserts the code calls into neither a crypto global nor a module import, both of
which the live sandbox refuses, and still produces unique url-safe keys on a host with no
`Buffer`.

**Split cache hits (7).** An empty cache still produces one item with every url pending -
the case that would break silently if the cache read did not use `fullResponse`. A row
inside the ttl is served from cache; a row older than the ttl is refetched; `ttl_hours: 0`
ignores a row written one second ago. A cache row belonging to some other url is not
matched. The accumulator starts empty, and no node in the workflow touches workflow static
data.

**Fan out misses (3).** One item per pending url, each carrying the timeout and user agent
it needs. The accumulator rides on the first item only, never duplicated onto later ones.
An empty pending list fans out to nothing.

**Classify responses (19).** A 200 is kept with its body and content type. A 404 and a 500
are permanent errors and are never retried. Each of 429, 502, 503 and 504 is retried. A
missing response is retried as a timeout, and becomes an error rather than an endless loop
once the attempts run out. Three attempts is the cap. The pause ladder is 2, then 8, then
30 seconds; a `Retry-After` header wins when it asks for longer, does not shorten the
ladder when it asks for less, and is ignored when it is a date rather than a number. One
bad url does not take the good ones down with it. Results and cache hits from earlier
attempts survive the loop. A non-string body is stringified rather than dropped, and
content is truncated to the 200,000 character cap.

**Build result (5).** Cache hits and fresh fetches land in one list with correct
`from_cache` flags. Only fetched rows are written to the cache: a cache hit is not written
back, and a failure is never cached at all. The stats account for every unique url -
`from_cache + fetched + failed == unique`. Every cache row carries a fresh timestamp.

**Workflow file (15).** The declared `RATE_PER_SECOND` matches the fetch node's
`batchSize`, so the documented pace and the enforced pace cannot drift apart. The fetch
node never throws on a status code, and a network error keeps the batch alive. The cache
read posts its keys in the body, calls the rpc that `schema.sql` actually creates, and
always emits an item. The cache write merges rather than duplicating. Every Wait node
uses a plain number, all three pauses match the ladder in the classifier, and each one
loops back into the fetch. The switch has an output for every Wait node. The workflow
ships inactive, bundles no credentials, contains no non-English text, and has no node
unreachable from the trigger.
