-- Workflow 17: the page list and the snapshots it compares against.

create table if not exists competitor_pages (
  url        text primary key,
  competitor text not null,
  page_type  text not null default 'page',
  -- A CSS selector narrowing the page to the part worth watching. Empty means the whole
  -- body, which works but produces noisier diffs.
  selector   text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per page: the latest normalised text and its hash. History is not kept here.
-- The point of comparison is "what did this page say last time", and a growing history
-- table would make the lookup slower every day for a value nothing reads.
create table if not exists page_snapshots (
  url_hash   text primary key,           -- sha256('page:' || url), safe inside a query string
  url        text not null,
  competitor text,
  page_type  text,
  selector   text,
  hash       text not null,              -- sha256 of the normalised text below
  text       text,
  truncated  boolean not null default false,
  taken_at   timestamptz not null default now()
);

create index if not exists page_snapshots_taken_idx on page_snapshots (taken_at desc);

-- Seeding a page list, as an example:
--   insert into competitor_pages (url, competitor, page_type, selector) values
--     ('https://example.com/pricing', 'Example', 'pricing', 'main'),
--     ('https://example.com/changelog', 'Example', 'changelog', '.changelog');

-- Re-baselining one page after a redesign, so the next run compares against the new shape
-- instead of alerting on the whole page:
--   delete from page_snapshots where url = 'https://example.com/pricing';
