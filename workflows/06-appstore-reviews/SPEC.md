# 06. App Store review monitor

- **slug:** `appstore-reviews`
- **category:** ops
- **depends_on:** 01, 02, 03

**Goal.** Catch new reviews of an app, tag them by sentiment and theme, and alert
immediately on one and two star ratings.

**Trigger.** `Schedule Trigger`, every 6 hours.

**Flow.**
1. Fetch the App Store review feed for the configured app id, across several countries.
2. Normalise to `{ review_id, country, rating, title, body, version, date }`.
3. Call workflow 02 with `source = 'appstore'` to keep only new reviews.
4. Call workflow 03 with the schema
   `{ sentiment, theme, is_bug_report, suggested_reply }` per review.
5. Rating 1 or 2, or a bug report, means an immediate Telegram alert. Everything else
   is only stored.

**Credentials.** `Supabase (dev)`, `Telegram Bot (alerts)`, and the credentials of the
workflows it calls.

**Test.** A fixture of six reviews, two of them one star. Expect two alerted, six
stored, and zero new on a repeat run.

**Definition of done.**
- [ ] alerts fire only for fresh reviews, not for the whole history on the first run
- [ ] the first run marks existing reviews as seen without sending anything
- [ ] `suggested_reply` is a draft and is never sent anywhere automatically

**Out of scope.** Do not reply to reviews.
