-- Workflow 11: page cache.

create table if not exists page_cache (
  url_hash     text primary key,
  url          text not null,
  status       int not null,
  content      text,
  content_type text,
  fetched_at   timestamptz not null default now()
);

create index if not exists page_cache_fetched_idx on page_cache (fetched_at desc);

-- The batch lookup is an RPC rather than a url_hash=in.(...) query string. Keys are
-- base64url encodings of the urls, so two hundred of them is tens of kilobytes; that
-- belongs in a request body, not in a url.
create or replace function page_cache_lookup(keys text[])
returns setof page_cache
language sql
stable
as $$
  select * from page_cache where url_hash = any(keys);
$$;

-- Cleanup is not part of the workflow. Run this on a schedule to keep the table small:
--   delete from page_cache where fetched_at < now() - interval '30 days';
