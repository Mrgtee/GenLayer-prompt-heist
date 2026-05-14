# Prompt Heist Frontend

Vite React client for Prompt Heist.

The app connects to the Socket.IO game server, verifies room joins by wallet signature, renders realtime match state, and shows GenLayer judge scores, challenge reviews, and retry states.

## Environment

```env
VITE_SERVER_URL=http://localhost:3001
VITE_CHAIN_ID=61999
VITE_RPC_HTTP=https://studio.genlayer.com/api
```

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test:room
```

Local case images live in `public/cases/`.

`test:room` expects the backend to be running and uses `SERVER_URL` or `VITE_SERVER_URL`, defaulting to `http://localhost:3001`.
