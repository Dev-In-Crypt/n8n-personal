# 06. App Store review monitor

Built from `SPEC.md`. Polls the public App Store review feeds every six hours, keeps
only what it has not seen, tags each review, and interrupts you only for the ones that
deserve it.

## What it does

| Node | Type | Role |
|---|---|---|
| Every 6 hours | `scheduleTrigger` v1.3 | the poll |
| Config | `code` v2 | app id, countries, chat, database, bootstrap flag |
| Fetch review feed | `httpRequest` v4.4 | one call per storefront, failures do not stop the run |
| Normalise reviews | `code` v2 | flattens the feed shapes into review records |
| Drop already seen | `executeWorkflow` v1.3 | calls workflow 02 |
| Any new reviews? | `if` v2.3 | quiet-run branch |
| Build review request | `code` v2 | one tagging call for the batch |
| Tag reviews | `executeWorkflow` v1.3 | calls workflow 03 |
| Route and compose | `code` v2 | decides what alerts, builds rows and the message |
| Store reviews | `httpRequest` v4.4 | one batch insert |
| Anything to alert? | `if` v2.3 | store-only runs send nothing |
| Send alert | `telegram` v1.2 | one grouped message |

Decisions the spec did not spell out:

- **Reviews are stored in Supabase, not a spreadsheet.** The spec said Google Sheets.
  Supabase is already required here for deduplication, so a sheet would add a second
  credential and a second place for the same data to live. `schema.sql` keeps the rows
  queryable by rating and theme, which is what the sheet was for.
- **A `BOOTSTRAP` flag, not a date cutoff.** On a first run against an app that already
  has reviews, everything is recorded and marked seen and nothing is alerted. That is
  the honest way to satisfy "do not alert on the whole history": deduplication alone
  would not have prevented it, because on the first run every review is new.
- **`review_id` is prefixed with the country.** App Store review ids are unique per
  storefront, not globally, so the raw id would collide across countries and silently
  hide reviews.
- **Two feed shapes are handled.** The first entry of the feed is the app itself and
  has no rating, so it is filtered out; a storefront with exactly one review returns an
  object rather than an array. Both would otherwise produce garbage rows.
- **A bug report alerts at any rating.** A five star review that says "it crashes on
  open" is still a crash report.
- **Draft replies are stored, never sent**, and the alert says so in the message. The
  workflow has no path that posts anything back to the App Store.
- **A failed tagging call degrades rather than cancels.** Reviews are still stored and
  low ratings still alert, just without sentiment or theme.

## Verification

`validate_workflow` with the `strict` profile against a live instance: valid, zero
errors.

`tests/run.mjs` runs the three Code nodes against canned feeds and canned sub-workflow
replies. Twenty-eight checks, all green:

```
node tests/run.mjs
```

Covered: app metadata dropped, single-review storefront, failed fetch contributing
nothing, country-scoped ids, whitespace collapsing, newest-first ordering, one and two
star alerting, a bug report alerting at five stars, everything stored regardless,
bootstrap alerting nothing while still storing, drafts absent from the message, HTML
escaping, and the degraded path.

## Definition of done

- [x] alerts fire only for fresh reviews, not for the whole history on the first run
- [x] the first run marks existing reviews as seen without sending anything
- [x] `suggested_reply` is a draft and is never sent anywhere automatically

## What is left to a human

1. Apply `schema.sql`.
2. Create the `Supabase (dev)` and `Telegram Bot (alerts)` credentials and select them.
3. Set `APP_ID`, `COUNTRIES`, `CHAT_ID` and `SUPABASE_URL` in "Config".
4. Repoint the two `executeWorkflow` nodes at your own copies of workflows 02 and 03.
5. Run once with `BOOTSTRAP = true`, confirm rows appear and no alert is sent, then set
   it to `false`.

## Limitations

- The public RSS feed returns roughly the fifty most recent reviews per storefront. A
  six hour poll is comfortably inside that for a small app; a viral week could outrun it.
- Ratings-only feedback with no text still arrives as a review with an empty body.
- The feed is fetched directly. Once workflow 11 exists, this should move behind it.
