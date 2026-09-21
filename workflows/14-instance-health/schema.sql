-- Workflow 14: one row per week of instance health.

create table if not exists health_snapshots (
  week_start   date primary key,          -- the Monday of the week the report ran in
  taken_at     timestamptz not null default now(),
  window_since timestamptz not null,
  window_until timestamptz not null,
  totals       jsonb not null,
  -- keyed by workflow id: { name, runs, errors, p50Ms, maxMs, lastSuccessAt }
  stats        jsonb not null
);
