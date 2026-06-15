create table if not exists public.leaderboard (
  wallet text primary key,
  display_name text,
  xp integer not null default 0,
  wins integer not null default 0,
  games integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_leaderboard_xp
  on public.leaderboard (xp desc, updated_at desc);

create table if not exists public.match_results (
  id bigserial primary key,
  room_id text,
  wallet text not null,
  display_name text,
  score integer not null default 0,
  xp_delta integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_match_results_wallet_created
  on public.match_results (wallet, created_at desc);

alter table public.leaderboard enable row level security;
alter table public.match_results enable row level security;
