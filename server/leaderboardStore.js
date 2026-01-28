import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "leaderboard.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ players: {} }, null, 2) + "\n", "utf8");
}

function readDB() {
  ensure();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  try {
    const db = JSON.parse(raw);
    if (!db.players || typeof db.players !== "object") db.players = {};
    return db;
  } catch {
    // if corrupted, keep a backup and reset
    fs.writeFileSync(DB_PATH + ".bak", raw, "utf8");
    return { players: {} };
  }
}

function writeDB(db) {
  ensure();
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, DB_PATH);
}

function normWallet(w) {
  return (w || "").toLowerCase();
}

export function upsertPlayer({ wallet, displayName }) {
  const w = normWallet(wallet);
  if (!w.startsWith("0x")) throw new Error("Invalid wallet");
  const db = readDB();
  const now = Date.now();
  db.players[w] = db.players[w] || { wallet: w, displayName: "", xp: 0, updatedAt: now };
  if (displayName) db.players[w].displayName = String(displayName).slice(0, 20);
  db.players[w].updatedAt = now;
  writeDB(db);
  return db.players[w];
}

export function addXp({ wallet, xp, displayName }) {
  const w = normWallet(wallet);
  if (!w.startsWith("0x")) throw new Error("Invalid wallet");
  const add = Math.max(0, Math.floor(Number(xp || 0)));
  const db = readDB();
  const now = Date.now();
  db.players[w] = db.players[w] || { wallet: w, displayName: "", xp: 0, updatedAt: now };
  if (displayName) db.players[w].displayName = String(displayName).slice(0, 20);
  db.players[w].xp = Math.max(0, Math.floor(Number(db.players[w].xp || 0)) + add);
  db.players[w].updatedAt = now;
  writeDB(db);
  return db.players[w];
}

export function getGlobalLeaderboard({ limit = 50 } = {}) {
  const db = readDB();
  const list = Object.entries(db.players || {}).map(([wallet, p]) => ({
    wallet,
    displayName: p.displayName || `player_${wallet.slice(2, 6)}`,
    xp: Math.floor(Number(p.xp || 0)),
    updatedAt: p.updatedAt || 0,
  }));
  list.sort((a, b) => (b.xp - a.xp) || (b.updatedAt - a.updatedAt));
  return list.slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}
