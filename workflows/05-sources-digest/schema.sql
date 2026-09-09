-- Source list for workflow 05. The digest reads it on every run, so adding a feed is
-- an insert, not a workflow edit.

create table if not exists sources (
  url       text primary key,
  title     text not null,
  category  text not null default 'general',
  enabled   boolean not null default true
);

-- Workflow 05 also relies on seen_items from workflow 02 for deduplication.

-- insert into sources (url, title, category) values
--   ('https://blog.n8n.io/rss/', 'n8n blog', 'tooling');
