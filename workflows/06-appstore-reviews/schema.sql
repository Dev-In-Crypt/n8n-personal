-- Storage for workflow 06. Reviews are kept so themes can be read over time, not just
-- when the alert fires.

create table if not exists app_reviews (
  review_id   text primary key,
  country     text not null,
  rating      int  not null,
  title       text,
  body        text,
  version     text,
  reviewed_at timestamptz,
  sentiment   text,
  theme       text,
  is_bug      boolean not null default false,
  draft_reply text,          -- a draft for a human, never sent by this workflow
  alerted     boolean not null default false,
  stored_at   timestamptz not null default now()
);

create index if not exists app_reviews_rating_idx on app_reviews (rating, reviewed_at desc);
create index if not exists app_reviews_theme_idx  on app_reviews (theme, reviewed_at desc);

-- Workflow 06 also relies on seen_items from workflow 02 for deduplication.
