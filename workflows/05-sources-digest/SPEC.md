# 05. Morning digest of sources

- **slug:** `sources-digest`
- **category:** ops
- **depends_on:** 01, 02, 03

**Goal.** One Telegram digest every morning covering a list of sources, with no repeats
and a one-line summary per item.

**Trigger.** `Schedule Trigger`, 07:30 Europe/Madrid.

**Flow.**
1. Read the source list from `sources(url, title, category, enabled)`.
2. Fetch each feed and normalise entries to `{ title, url, published_at, excerpt }`.
3. Call workflow 02 with `source = 'digest'` to drop anything already seen.
4. Call workflow 03 once for the whole batch with the schema
   `{ items: [{ url, one_liner, why_it_matters, tag }] }`. At most 15 items per run,
   the rest carry over to the next day.
5. Compose the message, grouped by tag.
6. Send it. If there is nothing new, send nothing.

**Credentials.** `Supabase (dev)`, `Telegram Bot (alerts)`, and the credentials of the
workflows it calls.

**Test.** Two fixed feeds. First run: N items. Second run on the same data: silence.

**Definition of done.**
- [ ] an empty day means silence, not a "nothing new" message
- [ ] every entry carries a clickable link to its source
- [ ] the 15 item cap holds and the overflow is not lost

**Out of scope.** Do not retell the article. One line per entry.
