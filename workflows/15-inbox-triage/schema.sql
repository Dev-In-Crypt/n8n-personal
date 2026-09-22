-- Workflow 15: the task list inbox triage writes to.
-- The seen_items table it also reads belongs to workflow 02; apply 02's schema.sql too.

create table if not exists tasks (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  source        text not null,
  -- A link back to the original, never the original: the unique key doubles as the
  -- guard that makes a re-run insert nothing new.
  source_url    text not null unique,
  action        text not null check (char_length(action) between 1 and 200),
  urgency       text not null check (urgency in ('low', 'normal', 'high')),
  deadline_hint text check (char_length(deadline_hint) <= 80),
  category      text check (char_length(category) <= 40),
  -- One line of context. The length limit is the database's half of "no email bodies
  -- are stored": a body cannot fit here even if a model tried to put one here.
  context       text check (char_length(context) <= 200),
  status        text not null default 'open' check (status in ('open', 'done', 'dropped'))
);

create index if not exists tasks_open_idx on tasks (status, urgency, created_at desc);
