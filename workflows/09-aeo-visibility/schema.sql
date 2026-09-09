-- Tables for workflow 09.

create table if not exists brands (
  id           text primary key,
  name         text not null,
  domain       text,
  aliases      text[] not null default '{}',
  competitors  jsonb not null default '[]'::jsonb,  -- [{name, domain, aliases}]
  enabled      boolean not null default true
);

create table if not exists prompts (
  id        text primary key,
  brand_id  text not null references brands (id),
  text      text not null,
  intent    text not null default 'informational',  -- informational | comparison | transactional
  enabled   boolean not null default true
);

create table if not exists visibility_runs (
  run_date   date not null,
  brand_id   text not null,
  prompt_id  text not null,
  model      text not null,
  mentioned  boolean not null,
  position   int,                    -- rank of the brand's first mention among tracked names
  cited      boolean not null default false,
  answer     text,
  measured_at timestamptz not null default now(),
  -- One measurement per prompt per model per day. The insert relies on this to make a
  -- repeated run in the same week a no-op rather than a duplicate.
  primary key (run_date, prompt_id, model)
);

create index if not exists visibility_runs_brand_idx on visibility_runs (brand_id, run_date desc);
