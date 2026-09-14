-- Workflow 12: LLM spend ledger, price list and daily cap.

create table if not exists model_prices (
  model        text primary key,
  in_per_mtok  numeric(12, 4) not null check (in_per_mtok  >= 0),
  out_per_mtok numeric(12, 4) not null check (out_per_mtok >= 0),
  updated_at   timestamptz not null default now()
);

create table if not exists llm_usage (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  workflow_name text not null,
  model         text not null,
  input_tokens  int not null check (input_tokens  >= 0),
  output_tokens int not null check (output_tokens >= 0),
  cost_usd      numeric(14, 6) not null check (cost_usd >= 0),
  -- false when the model was not in model_prices. The tokens are still recorded, but
  -- cost_usd is 0 and the day's total is a floor rather than the truth.
  priced        boolean not null default true,
  purpose       text
);

create index if not exists llm_usage_ts_idx on llm_usage (ts desc);

-- One row, enforced. The cap lives here so it can be changed without editing a workflow.
create table if not exists llm_guard_config (
  id              int primary key default 1,
  daily_limit_usd numeric(10, 2) not null check (daily_limit_usd >= 0),
  constraint llm_guard_config_single_row check (id = 1)
);

insert into llm_guard_config (id, daily_limit_usd)
values (1, 20.00)
on conflict (id) do nothing;

-- The gate aggregates in the database, not in the workflow. Selecting the day's rows and
-- summing them in a Code node would silently under-report as soon as a day exceeds the
-- REST row limit, and an under-reported total is a cap that does not cap.
create or replace function llm_spend_since(since timestamptz)
returns table (total_usd numeric, calls bigint, unpriced bigint)
language sql
stable
as $$
  select coalesce(sum(cost_usd), 0)::numeric,
         count(*)::bigint,
         count(*) filter (where not priced)::bigint
  from llm_usage
  where ts >= since;
$$;

-- The report groups by workflow and model, so the row count is small no matter how busy
-- the day was.
create or replace function llm_spend_report(since timestamptz, until timestamptz)
returns table (
  workflow_name text,
  model         text,
  calls         bigint,
  input_tokens  bigint,
  output_tokens bigint,
  cost_usd      numeric,
  unpriced      bigint
)
language sql
stable
as $$
  select workflow_name,
         model,
         count(*)::bigint,
         sum(input_tokens)::bigint,
         sum(output_tokens)::bigint,
         sum(cost_usd)::numeric,
         count(*) filter (where not priced)::bigint
  from llm_usage
  where ts >= since and ts < until
  group by workflow_name, model;
$$;

-- Seed the price list. Check these against current pricing before trusting the numbers;
-- a stale price is a wrong ledger, not a missing one, which is harder to notice.
insert into model_prices (model, in_per_mtok, out_per_mtok) values
  ('claude-sonnet-4-5',        3.00, 15.00),
  ('claude-haiku-4-5',         1.00,  5.00),
  ('gpt-4o-mini',              0.15,  0.60),
  ('text-embedding-3-small',   0.02,  0.00)
on conflict (model) do nothing;
