# 11. Rate-limited HTTP fetcher with cache

- **slug:** `fetch-cache`
- **category:** template
- **depends_on:** 01, 02

**Goal.** The sub-workflow every other workflow goes through to reach the outside world:
pacing, retries and a page cache in one place. Without it each monitor invents its own
and they collectively hammer the same endpoints.

**Trigger.** `Execute Workflow Trigger`.

**Flow.**
1. Input: `{ urls: [], ttl_hours, timeout_ms }`.
2. Select from `page_cache` by url hash. Anything fresher than `ttl_hours` is returned
   without a request.
3. Misses are fetched, paced so the configured rate per second is not exceeded.
4. Retry only on 429, 502, 503 and 504, up to three attempts, pausing 2s, 8s then 30s,
   honouring `Retry-After` when the server sends one.
5. Successful responses are written to `page_cache`.
6. Return `{ results: [{ url, status, from_cache, content }], errors: [] }`.

**Credentials.** `Supabase (dev)`.

**Definition of done.**
- [ ] the pace is enforced by configuration, not by hope, and is visible in the workflow
- [ ] 404 and 500 are not retried
- [ ] one bad url does not fail the batch; it lands in `errors`

**Out of scope.** Do not cache non-2xx responses. Do not parse HTML here.
