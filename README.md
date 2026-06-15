# Prompt Heist

Prompt Heist is a real-time multiplayer game powered by GenLayer subjective AI judgment.

Players see a generated case image and try to recover the hidden image prompt. The Node/Socket.IO server handles rooms, timing, wallet sessions, and persistence. The GenLayer intelligent contract handles the core subjective work: scoring guesses against the secret prompt and reviewing challenged verdicts.

## Current Deployment

Latest deployed GenLayer judge:

```text
0xcB2ddaD43A0D0F990c8bfEe714fa395591860e91
```

Use this address as `GENLAYER_JUDGE_ADDRESS` unless you redeploy the contract.

## What This Demonstrates

- **Real GenLayer LLM judgment:** `score_guess` calls `gl.nondet.exec_prompt(..., response_format="json")` and wraps that call in `gl.eq_principle.prompt_non_comparative(...)`.
- **Explicit subjective criteria:** the judge scores semantic similarity across subject, style, setting, mood, lighting, composition, and important details.
- **No word-overlap scoring:** the old Jaccard/token-overlap judge was removed.
- **Review-ready root contract:** `contracts/prompt_heist.py` is the deployable Prompt Heist judge, not a hello-world stub.
- **Challenge review:** successful YES challenge votes call `review_verdict` on GenLayer instead of applying a local score bump.
- **No local scoring fallback:** if GenLayer judging fails, the match enters `judge_error` and the host can retry.
- **Server-only secrets:** secret prompts stay in backend case data and are not included in public room or match payloads.
- **Signed wallet sessions:** room joins require a wallet signature; later socket events trust the verified wallet stored on the socket.
- **Render-friendly persistence:** the backend can persist leaderboard data to Supabase, with SQLite kept as a local fallback.

## Repository Layout

- `contracts/prompt_heist.py` - root deploy/review contract path.
- `genlayer/contracts/prompt_heist_judge.py` - mirrored GenLayer contract source.
- `server/` - Express, Socket.IO rooms, GenLayer judge adapter, and storage adapter.
- `server/supabase.sql` - Supabase tables for hosted persistence.
- `app/` - Vite React game client.
- `app/public/cases/` - local case image assets.
- `server/cases.json` - server-side case prompts and public image paths.

## Requirements

- Node.js 22.x recommended.
- GenLayer CLI.
- A wallet configured for GenLayer Studio Network.
- Supabase project for Render free-plan persistence.

Install GenLayer CLI if needed:

```bash
npm install -g genlayer
```

## Environment

Backend local SQLite: `server/.env`

```env
PORT=3001
GENLAYER_RPC=https://studio.genlayer.com/api
GENLAYER_JUDGE_ADDRESS=0xcB2ddaD43A0D0F990c8bfEe714fa395591860e91
GENLAYER_CALLER=0x0000000000000000000000000000000000000000
CORS_ORIGIN=http://localhost:5173
STORE_PROVIDER=sqlite
```

Backend hosted on Render free with Supabase:

```env
PORT=3001
GENLAYER_RPC=https://studio.genlayer.com/api
GENLAYER_JUDGE_ADDRESS=0xcB2ddaD43A0D0F990c8bfEe714fa395591860e91
GENLAYER_CALLER=0x0000000000000000000000000000000000000000
CORS_ORIGIN=https://YOUR-FRONTEND.onrender.com
STORE_PROVIDER=supabase
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
NODE_VERSION=22.22.3
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in the Vite frontend. It belongs only on the server.

Frontend: `app/.env`

```env
VITE_SERVER_URL=http://localhost:3001
VITE_CHAIN_ID=61999
VITE_RPC_HTTP=https://studio.genlayer.com/api
```

For production, set `VITE_SERVER_URL` to the Render backend URL.

## Supabase Setup

In Supabase, open SQL Editor and run:

```sql
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
```

The same SQL is stored in `server/supabase.sql`.

## Run Locally

Start the backend:

```bash
cd server
npm install
npm run start
```

Start the frontend:

```bash
cd app
npm install
npm run dev
```

Open the Vite URL, connect a wallet, join or create a room, and start a match as host.

## Deploy On Render Free

Backend Web Service:

```text
Root Directory: server
Build Command: npm install
Start Command: npm run start
```

Backend environment should use the Supabase variables from the hosted backend example above. Render free does not support persistent disks, so do not rely on `DB_PATH` for production data.

Frontend Static Site:

```text
Root Directory: app
Build Command: npm install && npm run build
Publish Directory: dist
```

After the frontend deploys, update the backend `CORS_ORIGIN` to the exact frontend URL and redeploy the backend.

## Deploy The Judge Contract

Deploy the root review contract:

```bash
cd /home/gtee/projects/GenLayer-prompt-heist
genlayer deploy --contract contracts/prompt_heist.py --rpc https://studio.genlayer.com/api
```

Copy the new contract address into `server/.env` as `GENLAYER_JUDGE_ADDRESS`, restart the backend, then run the judge test.

## Verify

Contract and server checks:

```bash
python3 -m py_compile contracts/prompt_heist.py genlayer/contracts/prompt_heist_judge.py
cd server
node --check index.js
node --check matchEngine.js
node --check genlayerJudge.mjs
npm run test:judge
```

Frontend checks:

```bash
cd app
npm run lint
npm run build
```

Room-flow smoke test, with the backend already running:

```bash
cd app
SERVER_URL=http://localhost:3001 npm run test:room
```

For faster local smoke tests, run the backend with short phase timers:

```bash
cd server
PHASE_REVEAL_MS=300 \
PHASE_SUBMIT_MS=1000 \
PHASE_VERDICT_MS=500 \
PHASE_CHALLENGE_WINDOW_MS=1500 \
PHASE_CHALLENGE_VOTE_MS=1500 \
PHASE_CHALLENGE_RESULT_MS=400 \
npm run start
```

## Gameplay Flow

1. A player connects a wallet and signs the room join message.
2. The host starts a match.
3. Players submit guesses for each image.
4. The server calls `score_guess` through `genlayer-js` `simulateWriteContract`.
5. The GenLayer judge returns `{ score, reasoning, xpDelta }`.
6. If judging fails, the round enters `judge_error` and the host can retry.
7. A challenged round goes to room vote; a YES majority calls `review_verdict` on GenLayer.
8. Final XP is persisted to Supabase when configured, or SQLite during local development.

## Resubmission Note

Use this summary when resubmitting:

```text
Prompt Heist has been updated per review.

The hello-world root contract was replaced, and the Jaccard word-overlap judge was removed. The active judge contract now exposes score_guess and review_verdict. score_guess calls gl.nondet.exec_prompt(..., response_format="json") inside gl.eq_principle.prompt_non_comparative(...) with explicit task and criteria for semantic prompt similarity. Challenge review uses the same GenLayer LLM/equivalence-principle path.

The server no longer uses deterministic fallback scoring. If GenLayer judging fails, the round enters judge_error and requires host retry.

Deployed judge address:
0xcB2ddaD43A0D0F990c8bfEe714fa395591860e91
```

## License

MIT
