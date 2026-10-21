-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.

-- Each club's data is reached with its code, which the app sends in the
-- x-club-code header. Knowing the code is enough to view and edit that club.
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code = lower(trim(code)) and length(code) >= 6),
  created_at timestamptz not null default now()
);

create table if not exists public.boats (
  club_id uuid not null references public.clubs on delete cascade,
  id text not null,
  name text not null,
  sail_no text,
  h0 numeric not null check (h0 > 0),
  created_at timestamptz not null default now(),
  primary key (club_id, id)
);

create table if not exists public.races (
  club_id uuid not null references public.clubs on delete cascade,
  id text not null,
  date date,
  name text,
  time_mode text not null default 'elapsed' check (time_mode in ('elapsed', 'finish')),
  start text,
  -- { "<boat id>": { "status": "FIN", "time": "1:12:30" }, ... }
  entries jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (club_id, id)
);

-- The club whose code came with this request, or null.
create or replace function public.request_club() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.clubs
  where code = lower(trim(current_setting('request.headers', true)::json ->> 'x-club-code'))
$$;

alter table public.clubs enable row level security;
alter table public.boats enable row level security;
alter table public.races enable row level security;

-- No insert/update policies on clubs: add clubs in the SQL editor.
create policy "club by code" on public.clubs for select using (id = public.request_club());
create policy "boats by club code" on public.boats for all
  using (club_id = public.request_club()) with check (club_id = public.request_club());
create policy "races by club code" on public.races for all
  using (club_id = public.request_club()) with check (club_id = public.request_club());

-- Add a club (codes are case-insensitive; pick one that's hard to guess):
-- insert into public.clubs (name, code) values ('My Sailing Club', 'some-long-code');
