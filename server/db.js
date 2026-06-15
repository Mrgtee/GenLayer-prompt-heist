import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_PROVIDER = (process.env.STORE_PROVIDER || "").trim().toLowerCase();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const USE_SUPABASE = STORE_PROVIDER === "supabase" || (!STORE_PROVIDER && HAS_SUPABASE_CONFIG);

if (STORE_PROVIDER && !["sqlite", "supabase"].includes(STORE_PROVIDER)) {
  throw new Error(`Unsupported STORE_PROVIDER: ${STORE_PROVIDER}`);
}

if (STORE_PROVIDER === "supabase" && !HAS_SUPABASE_CONFIG) {
  throw new Error("STORE_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

let sqliteDb = null;

if (USE_SUPABASE) {
  console.log("DB: Supabase REST", SUPABASE_URL);
} else {
  const dbPath = process.env.DB_PATH || path.join(__dirname, "prompt-heist.sqlite");
  sqliteDb = new Database(dbPath);
  console.log("DB:", dbPath);

  sqliteDb.pragma("journal_mode = WAL");

  sqliteDb.exec(`
CREATE TABLE IF NOT EXISTS players (
  wallet TEXT PRIMARY KEY,
  displayName TEXT,
  totalXp INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_totalXp ON players(totalXp DESC);
`);
}

export const db = sqliteDb;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeWallet(wallet) {
  return String(wallet || "").toLowerCase();
}

function xpValue(value) {
  return Math.max(0, Math.floor(Number(value || 0)));
}

async function supabaseRequest(pathname, { method = "GET", body, prefer } = {}) {
  if (!HAS_SUPABASE_CONFIG) throw new Error("Supabase is not configured");

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${method} ${pathname} failed (${response.status}): ${text.slice(0, 240)}`);
  }

  if (!text) return null;
  return JSON.parse(text);
}

async function upsertPlayerSupabase({ wallet, displayName }) {
  const w = normalizeWallet(wallet);
  if (!w) return;

  const row = {
    wallet: w,
    updated_at: new Date().toISOString(),
  };

  if (displayName) row.display_name = displayName;

  await supabaseRequest("leaderboard?on_conflict=wallet", {
    method: "POST",
    body: [row],
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function addXpSupabase({ wallet, deltaXp, displayName, roomId = null }) {
  const w = normalizeWallet(wallet);
  if (!w) return;

  const delta = xpValue(deltaXp);
  const existingRows = await supabaseRequest(
    `leaderboard?wallet=eq.${encodeURIComponent(w)}&select=wallet,display_name,xp,wins,games&limit=1`,
  );
  const current = Array.isArray(existingRows) ? existingRows[0] : null;
  const previousXp = Number(current?.xp || 0);
  const previousGames = Number(current?.games || 0);
  const previousWins = Number(current?.wins || 0);
  const nextDisplayName = displayName || current?.display_name || null;
  const createdAt = new Date().toISOString();

  await supabaseRequest("leaderboard?on_conflict=wallet", {
    method: "POST",
    body: [{
      wallet: w,
      display_name: nextDisplayName,
      xp: previousXp + delta,
      wins: previousWins,
      games: previousGames + 1,
      updated_at: createdAt,
    }],
    prefer: "resolution=merge-duplicates,return=minimal",
  });

  try {
    await supabaseRequest("match_results", {
      method: "POST",
      body: [{
        room_id: roomId,
        wallet: w,
        display_name: nextDisplayName,
        score: delta,
        xp_delta: delta,
        created_at: createdAt,
      }],
      prefer: "return=minimal",
    });
  } catch (error) {
    console.error("Supabase match_results insert failed:", error?.message || error);
  }
}

async function topPlayersSupabase(limit = 25) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 25)));
  const rows = await supabaseRequest(
    `leaderboard?select=wallet,display_name,xp,updated_at&order=xp.desc,updated_at.desc&limit=${safeLimit}`,
  );

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    wallet: row.wallet,
    displayName: row.display_name,
    totalXp: Number(row.xp || 0),
    updatedAt: row.updated_at ? Math.floor(Date.parse(row.updated_at) / 1000) : 0,
  }));
}

export function upsertPlayer({ wallet, displayName }) {
  if (USE_SUPABASE) return upsertPlayerSupabase({ wallet, displayName });

  const now = nowSeconds();
  const w = normalizeWallet(wallet);
  sqliteDb.prepare(`
    INSERT INTO players (wallet, displayName, totalXp, updatedAt)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(wallet) DO UPDATE SET
      displayName = COALESCE(excluded.displayName, players.displayName),
      updatedAt = excluded.updatedAt
  `).run(w, displayName || null, now);

  return undefined;
}

export function addXp({ wallet, deltaXp, displayName, roomId }) {
  if (USE_SUPABASE) {
    void addXpSupabase({ wallet, deltaXp, displayName, roomId }).catch((error) => {
      console.error("Supabase addXp failed:", error?.message || error);
    });
    return;
  }

  const now = nowSeconds();
  const w = normalizeWallet(wallet);
  sqliteDb.prepare(`
    INSERT INTO players (wallet, displayName, totalXp, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet) DO UPDATE SET
      displayName = COALESCE(excluded.displayName, players.displayName),
      totalXp = players.totalXp + excluded.totalXp,
      updatedAt = excluded.updatedAt
  `).run(w, displayName || null, xpValue(deltaXp), now);
}

export async function topPlayers(limit = 25) {
  if (USE_SUPABASE) return topPlayersSupabase(limit);

  return sqliteDb.prepare(`
    SELECT wallet, displayName, totalXp, updatedAt
    FROM players
    ORDER BY totalXp DESC, updatedAt DESC
    LIMIT ?
  `).all(limit);
}
