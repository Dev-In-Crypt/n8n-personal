-- Tables for workflow 07. Both the profile and the source list are data, not workflow
-- edits: that is what makes the radar generic.

create table if not exists applicant_profile (
  id             text primary key default 'default',
  domains        text[] not null default '{}',
  keywords       text[] not null default '{}',   -- at least one must appear
  exclude_terms  text[] not null default '{}',   -- any of these disqualifies
  countries      text[] not null default '{}',   -- empty means no country restriction
  budget_min     numeric,
  budget_max     numeric,
  notes          text
);

create table if not exists funding_sources (
  name        text primary key,
  url         text not null,
  kind        text not null default 'json',      -- json | rss
  items_path  text,                              -- dot path to the array, json sources
  field_map   jsonb not null default '{}'::jsonb,-- our field -> their dot path
  enabled     boolean not null default true
);

create table if not exists funding_items (
  id            text primary key,                -- source:native id
  source        text not null,
  title         text not null,
  url           text,
  deadline      date,
  budget        numeric,
  country       text,
  summary       text,
  relevance     int,
  matched       text[],
  blocking      text[],
  evidence      text,
  evidence_url  text,
  unverified    boolean not null default false,
  alerted       boolean not null default false,
  seen_at       timestamptz not null default now()
);

create index if not exists funding_items_relevance_idx on funding_items (relevance desc, deadline);

-- Workflow 07 also relies on seen_items from workflow 02 for deduplication.
