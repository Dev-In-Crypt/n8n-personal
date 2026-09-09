-- Tables and the search function for workflow 10.
-- Requires pgvector: create extension if not exists vector;

create extension if not exists vector;

create table if not exists vault_chunks (
  id          text primary key,          -- path + heading + content hash
  path        text not null,
  heading     text,
  content     text not null,
  embedding   vector(1536) not null,     -- text-embedding-3-small
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                -- set when the note disappears, never hard deleted
);

create index if not exists vault_chunks_path_idx on vault_chunks (path);
create index if not exists vault_chunks_live_idx on vault_chunks (deleted_at) where deleted_at is null;

-- Approximate nearest neighbour index. Build it after the first bulk load, and set
-- lists to roughly rows/1000 for a large vault.
create index if not exists vault_chunks_embedding_idx
  on vault_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Similarity search, exposed to PostgREST as /rest/v1/rpc/match_vault_chunks.
create or replace function match_vault_chunks(query_embedding vector(1536), match_count int default 8)
returns table (id text, path text, heading text, content text, similarity float)
language sql stable
as $$
  select c.id, c.path, c.heading, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from vault_chunks c
  where c.deleted_at is null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Workflow 10 also relies on seen_items from workflow 02 to skip unchanged chunks.
