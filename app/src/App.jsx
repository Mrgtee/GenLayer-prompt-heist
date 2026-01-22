import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { createWalletClient, custom } from "viem";
import { defineChain } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import HowToPlayPopover from "./components/HowToPlayPopover.jsx";

const serverUrl = import.meta.env.VITE_SERVER_URL;
const chainId = Number(import.meta.env.VITE_CHAIN_ID);
const rpcHttp = import.meta.env.VITE_RPC_HTTP;

const genlayerAsimov = defineChain({
  id: chainId,
  name: "GenLayer Testnet (Asimov)",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [rpcHttp] } },
});

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function clampName(name, fallback) {
  const n = (name || "").trim();
  return n ? n.slice(0, 20) : fallback;
}

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const [roomId, setRoomId] = useState("genlayer");
  const [joined, setJoined] = useState(false);
  const [roomState, setRoomState] = useState(null);

  // UI tabs (maps to real features so we don’t break anything)
  const [activeTab, setActiveTab] = useState("lobby"); // lobby | match | leaderboard | profile

  const socket = useMemo(() => io(serverUrl, { autoConnect: true }), []);

  useEffect(() => {
    socket.on("room:state", (s) => setRoomState(s));
    return () => socket.off("room:state");
  }, [socket]);

  async function connectWallet() {
    if (!window.ethereum) {
      alert("No wallet found. Install MetaMask or Rabby.");
      return;
    }

    const client = createWalletClient({
      chain: genlayerAsimov,
      transport: custom(window.ethereum),
    });

    const [address] = await client.requestAddresses();
    setWallet(address);
    setProfileOpen(true);
  }

  function saveDisplayName() {
    if (!wallet) {
      alert("Connect wallet first.");
      return;
    }

    const name = displayName.trim();
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(name)) {
      alert("Display name must be 1-20 chars: letters, numbers, underscore.");
      return;
    }

    (async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `Set display name to ${name} at ${timestamp}`;

      const client = createWalletClient({
        chain: genlayerAsimov,
        transport: custom(window.ethereum),
      });

      const signature = await client.signMessage({ account: wallet, message });

      const res = await fetch(`${serverUrl}/api/profile/display-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, displayName: name, timestamp, signature }),
      });

      const json = await res.json();
      if (!json.ok) {
        alert(`Failed: ${json.error?.message || json.error || "unknown"}`);
        return;
      }

      setProfileOpen(false);
    })().catch((e) => alert(e?.message || String(e)));
  }

  function joinRoom() {
    if (!wallet) {
      alert("Connect wallet first.");
      return;
    }
    socket.emit("room:join", { roomId, wallet });
    setJoined(true);
  }

  function leaveRoom() {
    socket.emit("room:leave", { roomId, wallet });
    setJoined(false);
    setRoomState(null);
  }

  function startMatch() {
    socket.emit("match:start", { roomId, wallet });
    setActiveTab("match");
  }

  function submitGuess(text) {
    const match = roomState?.match;
    if (!match) return;
    const round = match.rounds[match.currentRoundIndex];
    socket.emit("round:submit", { roomId, wallet, roundId: round.roundId, text });
  }

  function createChallenge() {
    const match = roomState?.match;
    if (!match) return;
    const round = match.rounds[match.currentRoundIndex];
    socket.emit("challenge:create", {
      roomId,
      wallet,
      roundId: round.roundId,
      reasonCode: "too_harsh",
    });
  }

  function voteChallenge(voteYes) {
    socket.emit("challenge:vote", { roomId, wallet, voteYes });
  }

  const match = roomState?.match || null;
  const currentRound = match ? match.rounds[match.currentRoundIndex] : null;
  const isHost = wallet && roomState?.host && wallet.toLowerCase() === roomState.host.toLowerCase();


  const nameOk = /^[a-zA-Z0-9_]{1,20}$/.test(displayName.trim());
  const canSaveName = !!wallet && nameOk;
  const tabs = [
    { id: "lobby", label: "Lobby" },
    { id: "match", label: "Match" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "profile", label: "Profile" },
  ];

  // Page title/subtitle (cool, game-like, but still about Prompt Heist)
  const title = "Prompt Heist";
  const subtitle = "Guess the prompt that generated the image.";

  // Left panel title like the reference (GENERAL)
  const leftTitle =
    activeTab === "lobby" ? "GENERAL" :
    activeTab === "match" ? "EVIDENCE" :
    activeTab === "leaderboard" ? "RULING" :
    "IDENTITY";

  // Right panel title like the reference (QUALITY)
  const rightTitle =
    activeTab === "lobby" ? "STATUS" :
    activeTab === "match" ? "TOOLS" :
    activeTab === "leaderboard" ? "DETAILS" :
    "ACTIONS";

  // Footer buttons like RESET/RETURN and PLAY
  function resetUi() {
    setActiveTab("lobby");
    setHowOpen(false);
    setProfileOpen(false);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background & vignette */}
      <div className="relative min-h-screen">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_25%_15%,rgba(255,255,255,0.08),transparent_60%),radial-gradient(1100px_700px_at_80%_25%,rgba(255,255,255,0.06),transparent_65%),linear-gradient(180deg,rgba(0,0,0,0.20),rgba(0,0,0,0.70))]" />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_180px_rgba(0,0,0,0.85)]" />

        {/* Top header like “OPTIONS” reference */}
        <div className="relative mx-auto max-w-6xl px-6 pt-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-4xl sm:text-5xl font-extrabold uppercase tracking-wide">
                {title}
              </div>
              <div className="mt-2 text-white/75">{subtitle}</div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge label="Asimov" />
                <Badge label="Rooms" />
                <Badge label="5–15 min" />
              </div>
            </div>

            <div className="hidden sm:block rounded-2xl border border-white/10 bg-black/50 backdrop-blur px-4 py-3">
              <div className="text-[11px] text-white/60 font-mono uppercase">Wallet</div>
              <div className="mt-1 font-mono text-sm">
                {wallet ? shortAddr(wallet) : "Not connected"}
              </div>
              <div className="mt-2 flex gap-2">
                {!wallet ? (
                  <Button onClick={connectWallet} variant="primary">
                    Connect
                  </Button>
                ) : (
                  <Button onClick={() => setProfileOpen(true)} variant="ghost">
                    Edit Name
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Tabs bar (reference-like) */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur">
            <div className="flex">
              {tabs.map((t) => {
                const active = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={[
                      "flex-1 px-4 py-3 text-sm font-extrabold uppercase tracking-wider transition",
                      "border-r border-white/10 last:border-r-0",
                      active ? "bg-amber-400/20 text-amber-200" : "text-white/75 hover:bg-white/5"
                    ].join(" ")}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Two-panel layout like the reference */}
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            {/* Left (wider) panel */}
            <Panel className="lg:col-span-7" title={leftTitle}>
              {activeTab === "lobby" && (
                <div className="space-y-3">
                  <MenuRow label="ROOM">
                    <div className="flex gap-2">
                      <Input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
                      {!joined ? (
                        <Button onClick={joinRoom} variant="primary" className="shrink-0">
                          Join
                        </Button>
                      ) : (
                        <Button onClick={leaveRoom} variant="ghost" className="shrink-0">
                          Leave
                        </Button>
                      )}
                    
                      <Button
                        onClick={() => {
                          if (!roomId) return;
                          navigator.clipboard.writeText(roomId);
                        }}
                        variant="ghost"
                        className="shrink-0"
                      >
                        Copy
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-white/60">
                      Create a room ID and share it. Anyone can join.
                    </div>
                  </MenuRow>

                  <MenuRow label="CREW">
                    {!roomState ? (
                      <div className="text-sm text-white/70">Join a room to assemble the crew.</div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {roomState.members.map((m) => (
                          <CrewCard
                            key={m.wallet}
                            name={clampName(m.displayName, `player_${m.wallet.slice(2, 6)}`)}
                            wallet={m.wallet}
                            host={m.wallet === roomState.host}
                          />
                        ))}
                      </div>
                    )}
                  </MenuRow>

                  <MenuRow label="HOST CONTROL">
                    <Button
                      onClick={startMatch}
                      variant={isHost ? "primary" : "disabled"}
                      disabled={!isHost}
                    >
                      Start Match
                    </Button>
                    <div className="mt-2 text-xs text-white/60">
                      Only the host can start. The match runs 5–15 minutes.
                    </div>
                  </MenuRow>
                </div>
              )}

              {activeTab === "match" && (
                <GameCard
                  match={match}
                  currentRound={currentRound}
                  onSubmit={submitGuess}
                  onChallenge={createChallenge}
                  onVote={voteChallenge}
                />
              )}

              {activeTab === "leaderboard" && (
                <div className="space-y-3">
                  {!match || !currentRound ? (
                    <div className="text-sm text-white/70">
                      No match yet. Start a match to generate a leaderboard.
                    </div>
                  ) : (
                    <>
                        <Leaderboard match={match} roundId={currentRound.roundId} />
                        {match.phase === "challenge_vote" && <Votes match={match} />}
                        {match.phase === "completed" && <FinalLeaderboard match={match} />}
                      </>
)}
                </div>
              )}

              {activeTab === "profile" && (
                <div className="space-y-3">
                  <MenuRow label="DISPLAY NAME">
                    <Button
                      onClick={() => {
                        if (!wallet) connectWallet();
                        else setProfileOpen(true);
                      }}
                      variant="primary"
                    >
                      {wallet ? "Edit Name" : "Connect Wallet"}
                    </Button>
                    <div className="mt-2 text-xs text-white/60">
                      Your name shows in the room roster and leaderboards.
                    </div>
                  </MenuRow>

                  <MenuRow label="HOW TO PLAY">
                    <Button onClick={() => setHowOpen(true)} variant="ghost">
                      Open Rules
                    </Button>
                  </MenuRow>
                </div>
              )}
            </Panel>

            {/* Right (narrow) panel */}
            <Panel className="lg:col-span-5" title={rightTitle}>
              {activeTab === "lobby" && (
                <div className="space-y-3">
                  <MenuRow label="CONNECTION">
                    <div className="flex items-center justify-between gap-3">
                      <Badge label={joined ? "In room" : "Not in room"} tone={joined ? "good" : "muted"} />
                      <Badge label={wallet ? shortAddr(wallet) : "No wallet"} />
                    </div>
                  </MenuRow>

                  <MenuRow label="HOST">
                    <div className="text-sm text-white/75">
                      {roomState?.host ? (
                        <span className="font-mono">{shortAddr(roomState.host)}</span>
                      ) : (
                        "—"
                      )}
                    </div>
                  </MenuRow>

                  <MenuRow label="HELP">
                    <Button onClick={() => setHowOpen(true)} variant="ghost">
                      How to Play
                    </Button>
                  </MenuRow>
                </div>
              )}

              {activeTab === "match" && (
                <div className="space-y-3">
                  <MenuRow label="IC JUDGE">
                    <div className="text-sm text-white/75">
                      The contract scores the “intent & style” of your guess.
                    </div>
                  </MenuRow>
                  <MenuRow label="OPTIMISTIC DEMOCRACY">
                    <div className="text-sm text-white/75">
                      Challenge rulings → vote → update scores.
                    </div>
                  </MenuRow>
                  <MenuRow label="SHORTCUTS">
                    <Button onClick={() => setHowOpen(true)} variant="ghost">
                      Rules
                    </Button>
                  </MenuRow>
                </div>
              )}

              {activeTab === "leaderboard" && (
                <div className="space-y-3">
                  <MenuRow label="SCORING TIP">
                    <div className="text-sm text-white/75">
                      Great prompts include: subject + style + setting + mood.
                    </div>
                  </MenuRow>
                  <MenuRow label="EXAMPLE">
                    <div className="text-xs font-mono text-white/70">
                      pixel art cat astronaut, neon city, playful vibe
                    </div>
                  </MenuRow>
                </div>
              )}

              {activeTab === "profile" && (
                <div className="space-y-3">
                  <MenuRow label="WALLET">
                    <div className="text-sm font-mono text-white/75">
                      {wallet ? wallet : "Not connected"}
                    </div>
                  </MenuRow>

                  <MenuRow label="ACTIONS">
                    {!wallet ? (
                      <Button onClick={connectWallet} variant="primary">
                        Connect Wallet
                      </Button>
                    ) : (
                      <Button onClick={() => setProfileOpen(true)} variant="primary">
                        Edit Name
                      </Button>
                    )}
                    <div className="mt-2 text-xs text-white/60">
                      Names are verified by signature (server cache in MVP).
                    </div>
                  </MenuRow>
                </div>
              )}
            </Panel>
          </div>

          {/* Footer buttons like reference */}
          <div className="mt-8 pb-10 flex items-center justify-between gap-4">
            <div className="flex gap-3">
              <Button onClick={resetUi} variant="ghost">
                Reset
              </Button>
              <Button onClick={() => setActiveTab("lobby")} variant="ghost">
                Return
              </Button>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => setHowOpen(true)} variant="ghost">
                How to Play
              </Button>
              {!wallet ? (
                <Button onClick={connectWallet} variant="primary">
                  Connect
                </Button>
              ) : (
                <Button onClick={startMatch} variant={isHost ? "primary" : "disabled"} disabled={!isHost}>
                  Play
                </Button>
              )}
            </div>
          </div>
        </div>

        <HowToPlayPopover open={howOpen} onClose={() => setHowOpen(false)} />

        <AnimatePresence>
          {profileOpen && (
            <ProfileModal
              value={displayName}
              onChange={setDisplayName}
              onClose={() => setProfileOpen(false)}
              onSave={saveDisplayName}
            
            canSave={canSaveName}
          />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- Menu-style wrappers ---------- */

function Panel({ title, children, className = "" }) {
  return (
    <div className={`rounded-3xl border border-white/10 bg-black/45 backdrop-blur p-5 ${className}`}>
      <div className="text-lg font-extrabold uppercase tracking-wide">{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function MenuRow({ label, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xs text-white/60 font-extrabold uppercase tracking-wider">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/* ---------- Your existing components (kept) ---------- */

function GameCard({ match, currentRound, onSubmit, onChallenge, onVote }) {
  if (!match || !currentRound) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs text-white/55 font-mono">EVIDENCE BOARD</div>
        <div className="mt-1 text-base font-semibold">Waiting for a case…</div>
        <p className="mt-2 text-sm text-white/70">
          Join a room. If you’re the host, start the match. The evidence will appear here.
        </p>
      </div>
    );
  }

  const phase = match.phase;
  const roundId = currentRound.roundId;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-white/55 font-mono">EVIDENCE BOARD</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="text-base font-semibold">
                Round {match.currentRoundIndex + 1} / {match.rounds.length}
              </div>
              <Badge label={phaseLabel(phase)} tone={phaseTone(phase)} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge label="IC Judge" />
            <Badge label="Optimistic Democracy" />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        <div className="relative">
          <img src={currentRound.imageUrl} alt="evidence" className="h-[360px] w-full object-cover opacity-95" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
            <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur">
              <div className="text-[11px] text-white/60 font-mono">EVIDENCE</div>
              <div className="text-sm font-semibold">Reverse-engineer the prompt.</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur">
              <div className="text-[11px] text-white/60 font-mono">ROUND ID</div>
              <div className="text-xs font-mono">{roundId}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {phase === "reveal" && <HintPanel title="Observe" text="Study the evidence. Your theory phase begins shortly." />}
        {phase === "submit" && <SubmitPanel onSubmit={onSubmit} />}
        {phase === "verdict" && <Leaderboard match={match} roundId={roundId} />}
        {phase === "challenge_window" && (
          <>
            <HintPanel
              title="Appeal Window"
              text="If the judge missed nuance, trigger a challenge and let democracy decide."
              action={<Button onClick={onChallenge} variant="primary">Challenge Ruling</Button>}
            />
            <Leaderboard match={match} roundId={roundId} />
          </>
        )}
        {phase === "challenge_vote" && (
          <>
            <HintPanel
              title="Democracy Vote"
              text="Vote to uphold or overturn the ruling."
              action={
                <div className="flex gap-2">
                  <Button onClick={() => onVote(true)} variant="primary">Vote YES</Button>
                  <Button onClick={() => onVote(false)} variant="ghost">Vote NO</Button>
                </div>
              }
            />
            <Leaderboard match={match} roundId={roundId} />
            <Votes match={match} />
          </>
        )}
        {phase === "completed" && <HintPanel title="Case Closed" text="Match completed. Next: aggregate XP + final leaderboard." />}
      </div>
    </div>
  );
}

function SubmitPanel({ onSubmit }) {
  const [text, setText] = useState("");
  const max = 240;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-white/55 font-mono">THEORY</div>
          <div className="mt-1 text-sm font-semibold">Write the prompt that created the image</div>
        </div>
        <Badge label={`${max - text.length}`} />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, max))}
        rows={3}
        className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25"
        placeholder="e.g. pixel art cat astronaut, neon city, playful vibe..."
      />

      <div className="mt-3 flex justify-end">
        <Button onClick={() => onSubmit(text)} variant={text.trim() ? "primary" : "disabled"} disabled={!text.trim()}>
          Submit Theory
        </Button>
      </div>
    </div>
  );
}

function Leaderboard({ match, roundId }) {
  const lb = match.leaderboard?.[roundId] || [];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-white/55 font-mono">RULING</div>
      <div className="mt-1 text-sm font-semibold">Leaderboard (Round)</div>

      {lb.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">No scores yet.</div>
      ) : (
        <ol className="mt-3 space-y-2">
          {lb.map((x, idx) => (
            <li
              key={x.wallet}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/60 font-mono">#{idx + 1}</span>
                  <span className="text-sm font-semibold">{shortAddr(x.wallet)}</span>
                  <Badge label={`${x.score}/100`} tone={x.score >= 80 ? "good" : x.score >= 60 ? "muted" : "warn"} />
                </div>
                <div className="mt-1 text-xs text-white/70 leading-relaxed">
                  <span className="text-white/50 font-mono">Why:</span> {x.reasoning}
                </div>
              </div>
              <ScoreBar score={x.score} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Votes({ match }) {
  const ch = match.challenge;
  const votes = ch?.votes ? Object.entries(ch.votes) : [];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-white/55 font-mono">VOTES</div>
      {votes.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">No votes yet.</div>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {votes.map(([wallet, v]) => (
            <li key={wallet} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2">
              <span className="text-xs font-mono text-white/75">{shortAddr(wallet)}</span>
              <Badge label={v ? "YES" : "NO"} tone={v ? "good" : "warn"} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FinalLeaderboard({ match }) {
  const list = match?.finalLeaderboard || [];
  const rounds = match?.rounds?.length || 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-white/55 font-mono">CASE CLOSED</div>
          <div className="mt-1 text-sm font-semibold">Final Leaderboard (Total XP)</div>
        </div>
        <Badge label={`${rounds} rounds`} />
      </div>

      {list.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">
          Final leaderboard not available yet.
        </div>
      ) : (
        <ol className="mt-3 space-y-2">
          {list.map((p, idx) => (
            <li
              key={p.wallet}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/60 font-mono">#{idx + 1}</span>
                  <span className="truncate text-sm font-semibold">
                    {p.displayName || shortAddr(p.wallet)}
                  </span>
                  <span className="text-xs font-mono text-white/55">
                    ({shortAddr(p.wallet)})
                  </span>
                </div>
                <div className="mt-1 text-xs text-white/70">
                  <span className="text-white/50 font-mono">Rounds:</span> {p.roundsPlayed ?? "-"}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <ScoreBar
                  score={Math.min(
                    100,
                    Math.round(((p.totalXp || 0) / Math.max(1, rounds * 100)) * 100)
                  )}
                />
                <Badge label={`${p.totalXp || 0} XP`} tone="good" />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}


function ProfileModal({ value, onChange, onClose, onSave, canSave }) {
  return (
    <motion.div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="w-full max-w-md rounded-3xl border border-white/10 bg-black/60 p-4 shadow-noir backdrop-blur"
        initial={{ scale: 0.98, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.98, opacity: 0, y: 8 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/55 font-mono">IDENTITY</div>
            <div className="mt-1 text-base font-semibold">Set your display name</div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm hover:bg-white/10">
            ✕
          </button>
        </div>

        <div className="mt-3">
          <div className="text-[11px] text-white/55 font-mono">DISPLAY NAME</div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25"
            placeholder="e.g. Gtee"
          />
          <div className="mt-2 text-xs text-white/55">1–20 chars, letters/numbers/underscore.</div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button onClick={onSave} variant={canSave ? "primary" : "disabled"} disabled={!canSave}>
            Save
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Atoms ---------- */

function Button({ children, onClick, variant = "primary", disabled, className = "" }) {
  const base = "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold transition border";
  const styles = {
    primary: "bg-amber-300 text-black border-amber-200/30 hover:bg-amber-200 shadow-[0_10px_30px_rgba(255,193,7,0.12)]",
    ghost: "bg-transparent text-white border-white/15 hover:bg-white/5",
    disabled: "bg-white/5 text-white/35 border-white/10 cursor-not-allowed",
  };
  return (
    <button disabled={disabled} onClick={onClick} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

function Input({ value, onChange }) {
  return (
    <input
      value={value}
      onChange={onChange}
      className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25"
    />
  );
}

function Badge({ label, tone = "muted" }) {
  const tones = {
    muted: "border-white/15 bg-white/5 text-white/75",
    good: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    warn: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-mono ${tones[tone] || tones.muted}`}>
      {label}
    </span>
  );
}

function CrewCard({ name, wallet, host }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="mt-0.5 text-xs font-mono text-white/60">{shortAddr(wallet)}</div>
        </div>
        {host ? <Badge label="HOST" /> : <div className="h-6 w-6 rounded-full border border-white/10 bg-white/5" />}
      </div>
    </div>
  );
}

function HintPanel({ title, text, action }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-white/55 font-mono">{title.toUpperCase()}</div>
          <div className="mt-1 text-sm text-white/75">{text}</div>
        </div>
        {action}
      </div>
    </div>
  );
}

function ScoreBar({ score }) {
  const pct = Math.max(0, Math.min(100, Number(score || 0)));
  return (
    <div className="w-24 shrink-0">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full bg-white/70"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <div className="mt-1 text-right text-[10px] font-mono text-white/55">{pct}%</div>
    </div>
  );
}

function phaseLabel(p) {
  const map = {
    reveal: "Reveal",
    submit: "Submit",
    verdict: "Verdict",
    challenge_window: "Appeal",
    challenge_vote: "Vote",
    completed: "Completed",
  };
  return map[p] || p;
}

function phaseTone(p) {
  if (p === "submit") return "good";
  if (p === "challenge_vote") return "warn";
  return "muted";
}
