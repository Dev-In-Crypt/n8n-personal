-- Audit table backing workflow 04 (approval gate).
-- Every request is written before the human sees it, so an approval is never
-- something that only ever existed in an execution log.

create table if not exists approvals (
  id          uuid primary key,
  source      text not null,
  title       text not null,
  status      text not null default 'pending',   -- pending | approved | rejected | expired
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  timed_out   boolean not null default false
);

create index if not exists approvals_status_idx on approvals (status, created_at desc);

-- The decision write is filtered on status = 'pending', so the first decision wins and
-- a late or repeated click cannot rewrite it. See "Save decision" in the workflow.
