-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table if not exists public.boats (
  id text primary key,
  name text not null,
  sail_no text,
  h0 numeric not null check (h0 > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.races (
  id text primary key,
  date date,
  name text,
  time_mode text not null default 'elapsed' check (time_mode in ('elapsed', 'finish')),
  start text,
  -- { "<boat id>": { "status": "FIN", "time": "1:12:30" }, ... }
  entries jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Anyone can read; anyone signed in can change.
alter table public.boats enable row level security;
alter table public.races enable row level security;

create policy "boats are public" on public.boats for select using (true);
create policy "signed-in users edit boats" on public.boats for all to authenticated using (true) with check (true);

create policy "races are public" on public.races for select using (true);
create policy "signed-in users edit races" on public.races for all to authenticated using (true) with check (true);

-- Push changes to open browsers so everyone sees new results without refreshing.
alter publication supabase_realtime add table public.boats, public.races;
