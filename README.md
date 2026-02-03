# GenLayer Prompt Heist

**Prompt Heist** is a real-time multiplayer mini-game that showcases **GenLayer** as a decentralized AI judgment layer.

Players see an image and try to guess the hidden prompt that generated it. Each round is judged by a **GenLayer consensus smart contract** (Studio network). Players can **challenge** the ruling and vote to override unfair verdicts (Optimistic Democracy-style flow).

**Live demo:** https://prompt-heist.vercel.app
**Backend:** https://genlayer-prompt-heist-production.up.railway.app

---

## What this demonstrates (GenLayer concepts)

- **AI Judgment on-chain:** The verdict (score + reasoning) comes from a GenLayer consensus smart contract (`score_guess`).
- **Optimistic Democracy mechanics:** Players can challenge verdicts and vote on outcomes.
- **Resilient design:** If the GenLayer judge is temporarily unavailable, the game falls back to a deterministic scoring method so gameplay never breaks.

---

## Tech stack

- **Frontend:** Vite + React
- **Backend:** Node.js + Express + Socket.IO
- **GenLayer integration:** `genlayer-js` (reads from the judge contract on Studio network)
- **Storage:** SQLite (global XP leaderboard)

---

## Repo structure

- `app/` — Vite + React frontend
- `server/` — Express + Socket.IO backend + GenLayer judge integration
- `genlayer/` — GenLayer-related code/assets (contracts, helpers, etc.)

---

## Prerequisites

- Node.js (recommended: `18+` or `20+`)
- npm
- A wallet browser extension (MetaMask or Rabby) to connect on Studio network

---

## Local setup (run the game)

### 1) Clone and install

```bash
git clone https://github.com/Mrgtee/GenLayer-prompt-heist.git
cd GenLayer-prompt-heist
````

### 2) Backend env

Create `server/.env`:

```bash
cat > server/.env <<'EOF'
PORT=3001

# GenLayer Studio Network (studionet)
GENLAYER_NETWORK=studionet
GENLAYER_RPC=https://studio.genlayer.com/api

# Prompt Heist Judge contract
GENLAYER_JUDGE_ADDRESS=0xEFE91eCB598ada8f7fc08E6735606073BBb4D59a

# Optional: used by genlayer-js for read calls (any valid address string is fine)
GENLAYER_CALLER=0x0000000000000000000000000000000000000000

# Production (optional) - allow only your frontend
# CORS_ORIGIN=https://prompt-heist.vercel.app
EOF
```

### 3) Start backend

```bash
cd server
npm install
npm run start
```

Backend should print something like:

* `Server running on http://localhost:3001`

Test:

```bash
curl http://localhost:3001/health
```

Expected:

```json
{"ok":true}
```

### 4) Frontend env

Create `app/.env`:

```bash
cat > app/.env <<'EOF'
VITE_SERVER_URL=http://localhost:3001
VITE_CHAIN_ID=61999
VITE_RPC_HTTP=https://studio.genlayer.com/api
EOF
```

### 5) Start frontend

```bash
cd ../app
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

---

## How to play

1. **Connect wallet** (Studio network).
2. Enter a **room ID** (or keep the default) and **Join**.
3. Share the room ID to another player to join
4. The **host** clicks **Start Match**.
5. Each round:

   * You see an image.
   * Submit your best guess of the original prompt.
   * The GenLayer judge returns a **score (0–100)** + **reasoning**.
6. If you disagree with a verdict:

   * Trigger a **Challenge**
   * Players vote **YES/NO**
   * If overturned, scores adjust.

---

## Deployment (Railway backend + Vercel frontend)

### Backend on Railway

* Deploy from GitHub
* Set **Root Directory** to `server`
* Add Railway Variables:

  * `PORT=3001`
  * `GENLAYER_RPC=https://studio.genlayer.com/api`
  * `GENLAYER_JUDGE_ADDRESS=0xEFE91eCB598ada8f7fc08E6735606073BBb4D59a`
  * `GENLAYER_CALLER=0x0000000000000000000000000000000000000000`
  * `CORS_ORIGIN=https://prompt-heist.vercel.app` (recommended)

### Frontend on Vercel

* Import repo
* Set **Root Directory** to `app`
* Add Vercel Env Vars:

  * `VITE_SERVER_URL=https://genlayer-prompt-heist-production.up.railway.app`
  * `VITE_CHAIN_ID=61999`
  * `VITE_RPC_HTTP=https://studio.genlayer.com/api`

---

## CORS production hardening (recommended)

In `server/index.js`:

* Read allowed origin from `process.env.CORS_ORIGIN`
* Apply it to both Express and Socket.IO

Railway variable:

```env
CORS_ORIGIN=https://prompt-heist.vercel.app
```

---

## Common issues

### “fetch failed” / judge intermittently falls back

This can happen due to transient network/RPC transport instability. The game is designed to continue safely using fallback scoring so rounds still complete.

### “No wallet found”

Install MetaMask or Rabby in your browser and refresh.

---

## License

MIT 


