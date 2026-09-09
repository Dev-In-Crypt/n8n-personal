-- Table backing workflow 02 (dedup store).
-- Apply once against the Supabase / Postgres database the workflow points at.

create table if not exists seen_items (
  hash            text primary key,
  source          text not null,
  first_seen_at   timestamptz not null default now(),
  payload_preview text
);

create index if not exists seen_items_source_idx
  on seen_items (source, first_seen_at desc);

-- Retention. Run on a schedule of its own, not from the workflow:
-- the dedup path must stay a pure read plus insert.
-- delete from seen_items where first_seen_at < now() - interval '180 days';
