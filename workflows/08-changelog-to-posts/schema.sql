-- Tables for workflow 08.

create table if not exists changelog_sources (
  product     text primary key,
  url         text not null,          -- GitHub releases API or a JSON changelog feed
  items_path  text,                   -- dot path to the array; empty means the root
  field_map   jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true
);

create table if not exists post_drafts (
  id           uuid primary key default gen_random_uuid(),
  product      text not null,
  occasion     text not null,
  platform     text not null,
  text         text not null,
  cta          text,
  source_url   text not null,         -- not null on purpose: no post without a source
  evidence     text not null,
  status       text not null default 'ready',
  approval_id  uuid,
  created_at   timestamptz not null default now()
);

create index if not exists post_drafts_status_idx on post_drafts (status, created_at desc);

-- Workflow 08 also relies on seen_items from workflow 02 and approvals from workflow 04.
