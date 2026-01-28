import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always store the DB next to this file unless DB_PATH is explicitly set
const dbPath = process.env.DB_PATH || path.join(__dirname, "prompt-heist.sqlite");
export const db = new Database(dbPath);
console.log("DB:", dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  wallet TEXT PRIMARY KEY,
  displayName TEXT,
  totalXp INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_totalXp ON players(totalXp DESC);
`);

export function upsertPlayer({ wallet, displayName }) {
  const now = Math.floor(Date.now() / 1000);
  const w = wallet.toLowerCase();
  db.prepare(`
    INSERT INTO players (wallet, displayName, totalXp, updatedAt)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(wallet) DO UPDATE SET
      displayName = COALESCE(excluded.displayName, players.displayName),
      updatedAt = excluded.updatedAt
  `).run(w, displayName || null, now);
}

export function addXp({ wallet, deltaXp, displayName }) {
  const now = Math.floor(Date.now() / 1000);
  const w = wallet.toLowerCase();
  db.prepare(`
    INSERT INTO players (wallet, displayName, totalXp, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet) DO UPDATE SET
      displayName = COALESCE(excluded.displayName, players.displayName),
      totalXp = players.totalXp + excluded.totalXp,
      updatedAt = excluded.updatedAt
  `).run(w, displayName || null, Math.max(0, Math.floor(deltaXp || 0)), now);
}

export function topPlayers(limit = 25) {
  return db.prepare(`
    SELECT wallet, displayName, totalXp, updatedAt
    FROM players
    ORDER BY totalXp DESC, updatedAt DESC
    LIMIT ?
  `).all(limit);
}
