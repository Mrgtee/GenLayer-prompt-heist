import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { createWalletClient, custom } from "viem";
import { defineChain } from "viem";
import { motion as Motion, AnimatePresence } from "framer-motion";
import HowToPlayPopover from "./components/HowToPlayPopover.jsx";

const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const genlayerStudio = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID || 61999),
  name: "GenLayer Studio Network",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_HTTP || "https://studio.genlayer.com/api"] } },
});

function shortAddr(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

function clampName(name, fallback) {
  const next = (name || "").trim();
  return next ? next.slice(0, 20) : fallback;
}

function sanitizeRoomId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
}

function normalizeRoomId(value) {
  return sanitizeRoomId(value) || "genlayer";
}

function createRoomCode() {
  return `heist-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const [roomId, setRoomId] = useState("genlayer");
  const [joinCode, setJoinCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketError, setSocketError] = useState("");

  const [activeTab, setActiveTab] = useState("lobby");
  const [globalPlayers, setGlobalPlayers] = useState([]);
  const [playerProfile, setPlayerProfile] = useState(null);

  const socket = useMemo(
    () =>
      io(serverUrl, {
        autoConnect: true,
        transports: ["websocket", "polling"],
      }),
    []
  );

  useEffect(() => {
    socket.on("connect", () => {
      setSocketConnected(true);
      setSocketError("");
    });
    socket.on("disconnect", () => {
      setSocketConnected(false);
    });
    socket.on("connect_error", (error) => {
      setSocketConnected(false);
      setSocketError(error?.message || "Unable to reach the Prompt Heist server.");
    });
    socket.on("room:state", (state) => setRoomState(state));
    socket.on("room:joined", (state) => {
      if (state?.roomId) {
        setRoomId(state.roomId);
        setJoinCode(state.roomId);
      }
      setJoined(true);
      setSocketError("");
    });
    socket.on("app:error", (error) => setSocketError(error?.message || "Server error"));

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("room:state");
      socket.off("room:joined");
      socket.off("app:error");
    };
  }, [socket]);

  useEffect(() => {
    if (!joined || !roomState?.match) return;
    if (roomState.match.phase !== "completed") {
      setActiveTab("match");
    }
  }, [joined, roomState?.match?.matchId, roomState?.match?.phase]);

  async function fetchGlobalLeaderboard(limit = 10) {
    try {
      const res = await fetch(`${serverUrl}/api/leaderboard/global?limit=${limit}`);
      const json = await res.json();
      return json?.ok ? json.players || [] : null;
    } catch {
      return null;
    }
  }

  async function fetchPlayerProfile(address = wallet) {
    if (!address) {
      setPlayerProfile(null);
      return null;
    }

    try {
      const res = await fetch(`${serverUrl}/api/profile/${address}`);
      const json = await res.json();
      if (!json?.ok) return null;
      setPlayerProfile(json.player || null);
      if (!profileOpen && json.player?.displayName) {
        setDisplayName(json.player.displayName);
      }
      return json.player || null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (activeTab !== "leaderboard") return;
    let alive = true;

    const refresh = () => {
      fetchGlobalLeaderboard().then((players) => {
        if (alive && players) setGlobalPlayers(players);
      });
    };

    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeTab]);

  useEffect(() => {
    if (!wallet) {
      setPlayerProfile(null);
      return undefined;
    }

    fetchPlayerProfile(wallet);
    const timer = setInterval(() => {
      fetchPlayerProfile(wallet);
    }, 10000);

    return () => clearInterval(timer);
  }, [wallet]);

  async function ensureStudioNetwork() {
    const chainIdHex = "0xF22F";
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (error) {
      if (error?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainIdHex,
            chainName: "GenLayer Studio Network",
            nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
            rpcUrls: ["https://studio.genlayer.com/api"],
            blockExplorerUrls: ["https://genlayer-explorer.vercel.app"],
          }],
        });
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } else {
        throw error;
      }
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      alert("No wallet found. Install MetaMask or Rabby.");
      return;
    }

    await ensureStudioNetwork();

    const client = createWalletClient({
      chain: genlayerStudio,
      transport: custom(window.ethereum),
    });

    const [address] = await client.requestAddresses();
    setWallet(address);
    setProfileOpen(true);
  }

  async function saveDisplayName() {
    if (!wallet) {
      alert("Connect wallet first.");
      return;
    }

    const name = displayName.trim();
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(name)) {
      alert("Display name must be 1-20 chars: letters, numbers, underscore.");
      return;
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `Set display name to ${name} at ${timestamp}`;

      await ensureStudioNetwork();

      const client = createWalletClient({
        chain: genlayerStudio,
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

      setDisplayName(name);
      setProfileOpen(false);
      await fetchPlayerProfile(wallet);
    } catch (error) {
      alert(error?.message || String(error));
    }
  }

  async function signAndJoinRoom(nextRoomId) {
    const rid = normalizeRoomId(nextRoomId);
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `Join Prompt Heist room ${rid} at ${timestamp}`;

    await ensureStudioNetwork();

    const client = createWalletClient({
      chain: genlayerStudio,
      transport: custom(window.ethereum),
    });

    const signature = await client.signMessage({ account: wallet, message });
    setRoomId(rid);
    setJoinCode(rid);
    if (!socket.connected) socket.connect();
    socket.emit("room:join", { roomId: rid, wallet, timestamp, signature });
  }

  async function createRoom() {
    if (!wallet) {
      alert("Connect wallet first.");
      return;
    }

    const raw = window.prompt("Create your room code", createRoomCode());
    if (raw === null) return;

    const rid = sanitizeRoomId(raw);
    if (!rid) {
      setSocketError("Room codes can only use letters, numbers, dashes, and underscores.");
      return;
    }

    const optimisticRoom = {
      roomId: rid,
      host: wallet,
      members: [{
        wallet,
        displayName: clampName(currentName, `player_${wallet.slice(2, 6)}`),
      }],
      match: null,
    };

    try {
      setSocketError("");
      setRoomId(rid);
      setJoinCode(rid);
      setJoined(true);
      setRoomState(optimisticRoom);
      setActiveTab("lobby");
      await signAndJoinRoom(rid);
    } catch (error) {
      setJoined(false);
      setRoomState(null);
      setSocketError(error?.message || String(error));
    }
  }

  async function joinRoom() {
    if (!wallet) {
      alert("Connect wallet first.");
      return;
    }

    const rid = sanitizeRoomId(joinCode);
    if (!rid) {
      setSocketError("Enter a valid room code to join.");
      return;
    }

    try {
      await signAndJoinRoom(rid);
      setSocketError("");
    } catch (error) {
      setSocketError(error?.message || String(error));
    }
  }

  function leaveRoom() {
    socket.emit("room:leave", { roomId });
    setJoined(false);
    setRoomState(null);
    setActiveTab("lobby");
  }

  function startMatch() {
    socket.emit("match:start", { roomId });
    setActiveTab("match");
  }

  function submitGuess(text) {
    const match = roomState?.match;
    if (!match) return;
    const round = match.rounds[match.currentRoundIndex];
    socket.emit("round:submit", { roomId, roundId: round.roundId, text });
  }

  function retryJudge() {
    socket.emit("round:retry-judge", { roomId });
  }

  function createChallenge() {
    const match = roomState?.match;
    if (!match) return;
    const round = match.rounds[match.currentRoundIndex];
    socket.emit("challenge:create", {
      roomId,
      roundId: round.roundId,
      reasonCode: "too_harsh",
    });
  }

  function voteChallenge(voteYes) {
    socket.emit("challenge:vote", { roomId, voteYes });
  }

  const match = roomState?.match || null;
  const currentRound = match ? match.rounds[match.currentRoundIndex] : null;
  const isHost = wallet && roomState?.host && wallet.toLowerCase() === roomState.host.toLowerCase();
  const nameOk = /^[a-zA-Z0-9_]{1,20}$/.test(displayName.trim());
  const canSaveName = !!wallet && nameOk;
  const currentName = playerProfile?.displayName || displayName.trim() || (wallet ? `player_${wallet.slice(2, 6)}` : "Unregistered");
  const currentXp = playerProfile?.xp ?? 0;

  const tabs = [
    { id: "lobby", label: "Lobby" },
    { id: "match", label: "Match" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "profile", label: "Profile" },
  ];

  const title = "PROMPT HEIST";
  const subtitle = "Crack the image prompt before the rest of the crew does.";

  const leftTitle =
    activeTab === "lobby" ? "GENERAL" :
    activeTab === "match" ? "EVIDENCE" :
    activeTab === "leaderboard" ? "RULING" :
    "IDENTITY";

  const rightTitle =
    activeTab === "lobby" ? "STATUS" :
    activeTab === "match" ? "TOOLS" :
    activeTab === "leaderboard" ? "DETAILS" :
    "ACTIONS";

  function resetUi() {
    setActiveTab("lobby");
    setHowOpen(false);
    setProfileOpen(false);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="relative min-h-screen">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_25%_15%,rgba(255,255,255,0.08),transparent_60%),radial-gradient(1100px_700px_at_80%_25%,rgba(255,255,255,0.06),transparent_65%),linear-gradient(180deg,rgba(0,0,0,0.20),rgba(0,0,0,0.70))]" />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_180px_rgba(0,0,0,0.85)]" />

        <div className="relative mx-auto max-w-6xl px-6 pt-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.35em] text-cyan-200/80">
                Multiplayer prompt deduction
              </div>
              <div className="game-title mt-3 text-5xl sm:text-6xl">{title}</div>
              <div className="mt-3 max-w-2xl text-white/75">{subtitle}</div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge label="Studio" />
                <Badge label="Realtime rooms" />
                <Badge label="GenLayer judge" tone="good" />
              </div>
            </div>

            <div className="hidden sm:block rounded-2xl border border-white/10 bg-black/50 px-4 py-3 backdrop-blur">
              <div className="text-[11px] font-mono uppercase text-white/60">Wallet</div>
              <div className="mt-1 font-mono text-sm">{wallet ? shortAddr(wallet) : "Not connected"}</div>
              <div className="mt-2 flex items-center gap-2">
                <Badge label={`${currentXp} XP`} tone="good" />
                {wallet ? <Badge label={currentName} /> : null}
              </div>
              <div className="mt-3 flex gap-2">
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

          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur">
            <div className="flex">
              {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={[
                      "flex-1 border-r border-white/10 px-4 py-3 text-sm font-extrabold uppercase tracking-wider transition last:border-r-0",
                      active ? "bg-amber-400/20 text-amber-200" : "text-white/75 hover:bg-white/5",
                    ].join(" ")}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <Panel className="lg:col-span-7" title={leftTitle}>
              {activeTab === "lobby" && (
                <div className="space-y-3">
                  <MenuRow label={joined ? "ACTIVE ROOM" : "ROOM ACCESS"}>
                    {!joined ? (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <ActionTile
                          title="Create a room"
                          copy="Generate your own room code, become host, and bring the crew in."
                          action={
                            <Button onClick={createRoom} variant="primary">
                              Create Room
                            </Button>
                          }
                        />
                        <ActionTile
                          title="Join with code"
                          copy="Enter a live room code and jump into someone else's lobby."
                          action={
                            <div className="flex gap-2">
                              <Input
                                value={joinCode}
                                onChange={(event) => setJoinCode(event.target.value)}
                                placeholder="Enter room code"
                              />
                              <Button
                                onClick={joinRoom}
                                variant="signal"
                                className="shrink-0"
                                disabled={!sanitizeRoomId(joinCode)}
                              >
                                Join Room
                              </Button>
                            </div>
                          }
                        />
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-mono uppercase text-white/55">Room code</div>
                            <div className="mt-1 text-2xl font-black uppercase tracking-[0.18em] text-amber-200">
                              {roomId}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge label={isHost ? "You are host" : "Crew member"} tone={isHost ? "good" : "muted"} />
                            <Badge label={`${roomState?.members?.length || 0} joined`} />
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            onClick={() => navigator.clipboard?.writeText(roomId).catch(() => {})}
                            variant="signal"
                          >
                            Copy Code
                          </Button>
                          <Button onClick={leaveRoom} variant="ghost">
                            Leave Room
                          </Button>
                        </div>
                      </div>
                    )}
                    {socketError ? <div className="mt-3 text-xs text-rose-300">{socketError}</div> : null}
                  </MenuRow>

                  <MenuRow label="CREW">
                    {!roomState ? (
                      <div className="text-sm text-white/70">Join a room to assemble the crew.</div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {roomState.members.map((member) => (
                          <CrewCard
                            key={member.wallet}
                            name={clampName(member.displayName, `player_${member.wallet.slice(2, 6)}`)}
                            wallet={member.wallet}
                            host={member.wallet.toLowerCase() === roomState.host?.toLowerCase()}
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
                      Once the host starts, every player in the room is pushed straight into the live match view.
                    </div>
                  </MenuRow>
                </div>
              )}

              {activeTab === "match" && (
                <GameCard
                  roomState={roomState}
                  match={match}
                  currentRound={currentRound}
                  onSubmit={submitGuess}
                  onChallenge={createChallenge}
                  onVote={voteChallenge}
                  onRetryJudge={retryJudge}
                  canRetry={!!isHost}
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
                      <Leaderboard match={match} roundId={currentRound.roundId} members={roomState?.members || []} />
                      {match.phase === "challenge_vote" && <Votes match={match} />}
                      {match.phase === "completed" && <FinalLeaderboard match={match} />}
                    </>
                  )}
                  <GlobalLeaderboard players={globalPlayers} />
                </div>
              )}

              {activeTab === "profile" && (
                <div className="space-y-3">
                  <MenuRow label="AGENT CARD">
                    {!wallet ? (
                      <div className="text-sm text-white/70">Connect a wallet to claim your identity and track XP.</div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ProfileStat label="Display Name" value={currentName} />
                        <ProfileStat label="Total XP" value={`${currentXp} XP`} accent />
                      </div>
                    )}
                  </MenuRow>

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
                      Your display name appears in the room roster, scoreboards, and profile card.
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

            <Panel className="lg:col-span-5" title={rightTitle}>
              {activeTab === "lobby" && (
                <div className="space-y-3">
                  <MenuRow label="CONNECTION">
                    <div className="flex items-center justify-between gap-3">
                      <Badge label={joined ? "In room" : "Not in room"} tone={joined ? "good" : "muted"} />
                      <Badge label={wallet ? shortAddr(wallet) : "No wallet"} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/60">
                      <span>{socketConnected ? "Server connected" : "Server offline"}</span>
                      <span className="font-mono">{serverUrl}</span>
                    </div>
                  </MenuRow>

                  <MenuRow label="HOST">
                    <div className="text-sm text-white/75">
                      {roomState?.host ? <span className="font-mono">{shortAddr(roomState.host)}</span> : "-"}
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
                      GenLayer scores the semantic intent of each guess, not just literal keyword overlap.
                    </div>
                  </MenuRow>
                  <MenuRow label="OPTIMISTIC DEMOCRACY">
                    <div className="text-sm text-white/75">
                      Challenge a verdict, vote as a room, then let GenLayer review the disputed ruling.
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
                      Strong guesses usually lock onto the subject, style, setting, and mood in one clean line.
                    </div>
                  </MenuRow>
                  <MenuRow label="EXAMPLE">
                    <div className="text-xs font-mono text-white/70">
                      neon koi detective, rainy cyberpunk alley, cinematic digital painting
                    </div>
                  </MenuRow>
                </div>
              )}

              {activeTab === "profile" && (
                <div className="space-y-3">
                  <MenuRow label="PROFILE">
                    <div className="space-y-2 text-sm text-white/75">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/55">Name</span>
                        <span className="font-semibold text-white">{currentName}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/55">XP</span>
                        <Badge label={`${currentXp} XP`} tone="good" />
                      </div>
                    </div>
                  </MenuRow>

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
                      Names are signature-verified and XP is pulled from the live profile record.
                    </div>
                  </MenuRow>
                </div>
              )}
            </Panel>
          </div>

          <div className="mt-8 space-y-4 pb-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
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
                  <Button
                    onClick={startMatch}
                    variant={joined && isHost ? "primary" : "disabled"}
                    disabled={!joined || !isHost}
                  >
                    Play
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-white/60">
              <span>Powered by</span>
              <a
                href="https://genlayer.com"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-amber-200 transition hover:text-white"
              >
                GenLayer
              </a>
              <span className="text-white/20">|</span>
              <a
                href="https://genlayer.com"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-white"
              >
                genlayer.com
              </a>
              <span className="text-white/20">|</span>
              <a
                href="https://docs.genlayer.com"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-white"
              >
                docs
              </a>
            </div>
          </div>
        </div>

        <HowToPlayPopover open={howOpen} onClose={() => setHowOpen(false)} />

        <AnimatePresence>
          {profileOpen ? (
            <ProfileModal
              value={displayName}
              onChange={setDisplayName}
              onClose={() => setProfileOpen(false)}
              onSave={saveDisplayName}
              canSave={canSaveName}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Panel({ title, children, className = "" }) {
  return (
    <div className={`rounded-3xl border border-white/10 bg-black/45 p-5 backdrop-blur ${className}`}>
      <div className="text-lg font-extrabold uppercase tracking-wide">{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function MenuRow({ label, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xs font-extrabold uppercase tracking-wider text-white/60">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ActionTile({ title, copy, action }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-white/70">{copy}</div>
      <div className="mt-4">{action}</div>
    </div>
  );
}

function ProfileStat({ label, value, accent = false }) {
  return (
    <div className={`rounded-2xl border px-4 py-4 ${accent ? "border-amber-300/20 bg-amber-300/10" : "border-white/10 bg-black/30"}`}>
      <div className="text-[11px] font-mono uppercase text-white/55">{label}</div>
      <div className="mt-2 text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function GameCard({ roomState, match, currentRound, onSubmit, onChallenge, onVote, onRetryJudge, canRetry }) {
  if (!match || !currentRound) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="font-mono text-xs text-white/55">EVIDENCE BOARD</div>
        <div className="mt-1 text-base font-semibold">Waiting for a case...</div>
        <p className="mt-2 text-sm text-white/70">
          Join a room. If you are the host, start the match. The evidence will appear here.
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
            <div className="font-mono text-xs text-white/55">EVIDENCE BOARD</div>
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
              <div className="font-mono text-[11px] text-white/60">EVIDENCE</div>
              <div className="text-sm font-semibold">Reverse-engineer the prompt.</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur">
              <div className="font-mono text-[11px] text-white/60">ROUND ID</div>
              <div className="font-mono text-xs">{roundId}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {phase === "reveal" ? <HintPanel title="Observe" text="Study the evidence. Your theory phase begins shortly." /> : null}
        {phase === "submit" ? <SubmitPanel key={roundId} onSubmit={onSubmit} /> : null}
        {phase === "verdict" ? <Leaderboard match={match} roundId={roundId} members={roomState?.members || []} /> : null}
        {phase === "judge_error" ? (
          <HintPanel
            title="GenLayer Retry Needed"
            text={match.judgeError?.message || "GenLayer did not return a consensus verdict. The host can retry."}
            action={<Button onClick={onRetryJudge} variant={canRetry ? "primary" : "disabled"} disabled={!canRetry}>Retry Judge</Button>}
          />
        ) : null}
        {phase === "challenge_window" ? (
          <>
            <HintPanel
              title="Appeal Window"
              text="If the judge missed nuance, trigger a challenge and let democracy decide."
              action={<Button onClick={onChallenge} variant="primary">Challenge Ruling</Button>}
            />
            <Leaderboard match={match} roundId={roundId} members={roomState?.members || []} />
          </>
        ) : null}
        {phase === "challenge_vote" ? (
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
            <Leaderboard match={match} roundId={roundId} members={roomState?.members || []} />
            <Votes match={match} />
          </>
        ) : null}
        {phase === "challenge_review" ? (
          <>
            <HintPanel title="GenLayer Review" text="The challenged ruling is being reviewed by the GenLayer judge." />
            <Leaderboard match={match} roundId={roundId} members={roomState?.members || []} />
            <Votes match={match} />
          </>
        ) : null}
        {phase === "challenge_result" ? (
          <>
            <HintPanel title="Challenge Result" text="The reviewed ruling is ready. Moving to the next case shortly." />
            <Leaderboard match={match} roundId={roundId} members={roomState?.members || []} />
            <Votes match={match} />
          </>
        ) : null}
        {phase === "completed" ? (
          <>
            <HintPanel title="Case Closed" text="Match completed. Final XP is below." />
            <FinalLeaderboard match={match} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function SubmitPanel({ onSubmit }) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const max = 240;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-white/55">THEORY</div>
          <div className="mt-1 text-sm font-semibold">Write the prompt that created the image</div>
        </div>
        <Badge label={`${max - text.length}`} />
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value.slice(0, max))}
        rows={3}
        disabled={submitted}
        className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25"
        placeholder="e.g. pixel art cat astronaut, neon city, playful vibe..."
      />

      <div className="mt-3 flex justify-end">
        <Button
          onClick={() => {
            const payload = text.trim();
            if (!payload || submitted) return;
            setSubmitted(true);
            onSubmit(payload);
          }}
          variant={submitted ? "disabled" : text.trim() ? "primary" : "disabled"}
          disabled={submitted || !text.trim()}
        >
          {submitted ? "Submitted" : "Submit guess"}
        </Button>
      </div>
    </div>
  );
}

function Leaderboard({ match, roundId, members = [] }) {
  const leaderboard = match.leaderboard?.[roundId] || [];
  const phase = match.phase;
  const showPending =
    (phase === "verdict" || phase === "challenge_review" || phase === "challenge_window") && leaderboard.length === 0;

  if (phase === "completed") return null;

  const byWallet = new Map(
    members.map((member) => [(member.wallet || "").toLowerCase(), member.displayName || ""])
  );
  const nameOf = (wallet) => byWallet.get((wallet || "").toLowerCase()) || "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="font-mono text-xs text-white/55">RULING</div>
      <div className="mt-1 text-sm font-semibold">Leaderboard (Round)</div>

      {showPending ? <div className="mt-3 text-sm text-white/70">The judge is deliberating...</div> : null}
      {!showPending && leaderboard.length === 0 ? <div className="mt-2 text-sm text-white/70">No scores yet.</div> : null}

      {leaderboard.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {leaderboard.map((entry, index) => (
            <li
              key={entry.wallet}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-white/60">#{index + 1}</span>
                  <span className="text-sm font-semibold">
                    {nameOf(entry.wallet) || entry.displayName || shortAddr(entry.wallet)}
                  </span>
                  <Badge
                    label={`${entry.score}/100`}
                    tone={entry.score >= 80 ? "good" : entry.score >= 60 ? "muted" : "warn"}
                  />
                </div>
                <div className="mt-1 text-xs leading-relaxed text-white/70">
                  <span className="font-mono text-white/50">Why:</span>{" "}
                  {entry.reasoning || entry.why || "Judging based on prompt similarity and intent."}
                </div>
              </div>
              <ScoreBar score={entry.score} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Votes({ match }) {
  const challenge = match.challenge;
  const votes = challenge?.votes ? Object.entries(challenge.votes) : [];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="font-mono text-xs text-white/55">VOTES</div>
      {votes.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">No votes yet.</div>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {votes.map(([wallet, vote]) => (
            <li key={wallet} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2">
              <span className="font-mono text-xs text-white/75">{shortAddr(wallet)}</span>
              <Badge label={vote ? "YES" : "NO"} tone={vote ? "good" : "warn"} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FinalLeaderboard({ match }) {
  const leaderboard = match?.finalLeaderboard || [];
  const rounds = match?.rounds?.length || 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-white/55">CASE CLOSED</div>
          <div className="mt-1 text-sm font-semibold">Final Leaderboard (Total XP)</div>
        </div>
        <Badge label={`${rounds} rounds`} />
      </div>

      {leaderboard.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">Final leaderboard not available yet.</div>
      ) : (
        <ol className="mt-3 space-y-2">
          {leaderboard.map((player, index) => (
            <li
              key={player.wallet}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-white/60">#{index + 1}</span>
                  <span className="truncate text-sm font-semibold">{player.displayName || shortAddr(player.wallet)}</span>
                  <span className="font-mono text-xs text-white/55">({shortAddr(player.wallet)})</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <ScoreBar
                  score={Math.min(100, Math.round(((player.totalXp || 0) / Math.max(1, rounds * 100)) * 100))}
                />
                <Badge label={`${player.totalXp || 0} XP`} tone="good" />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GlobalLeaderboard({ players }) {
  const leaderboard = players || [];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="font-mono text-xs text-white/55">GLOBAL</div>
      <div className="mt-1 text-sm font-semibold">Global Leaderboard (All-time XP)</div>

      {leaderboard.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">No global XP yet.</div>
      ) : (
        <ol className="mt-3 space-y-2">
          {leaderboard.map((player, index) => (
            <li
              key={player.wallet}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-white/60">#{index + 1}</span>
                  <span className="truncate text-sm font-semibold">{player.displayName || shortAddr(player.wallet)}</span>
                  <span className="font-mono text-xs text-white/50">{shortAddr(player.wallet)}</span>
                </div>
              </div>
              <Badge label={`${player.xp ?? 0} XP`} tone="good" />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProfileModal({ value, onChange, onClose, onSave, canSave }) {
  return (
    <Motion.div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <Motion.div
        className="w-full max-w-md rounded-3xl border border-white/10 bg-black/60 p-4 shadow-noir backdrop-blur"
        initial={{ scale: 0.98, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.98, opacity: 0, y: 8 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-white/55">IDENTITY</div>
            <div className="mt-1 text-base font-semibold">Set your display name</div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm hover:bg-white/10">
            X
          </button>
        </div>

        <div className="mt-3">
          <div className="font-mono text-[11px] text-white/55">DISPLAY NAME</div>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25"
            placeholder="e.g. Gtee"
          />
          <div className="mt-2 text-xs text-white/55">1-20 chars, letters/numbers/underscore.</div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button onClick={onSave} variant={canSave ? "primary" : "disabled"} disabled={!canSave}>
            Save
          </Button>
        </div>
      </Motion.div>
    </Motion.div>
  );
}

function Button({ children, onClick, variant = "primary", disabled, className = "" }) {
  const base = "inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-semibold transition";
  const styles = {
    primary: "border-amber-200/30 bg-amber-300 text-black shadow-[0_10px_30px_rgba(255,193,7,0.12)] hover:bg-amber-200",
    signal: "border-cyan-300/25 bg-cyan-300/12 text-cyan-100 shadow-[0_10px_30px_rgba(34,211,238,0.08)] hover:bg-cyan-300/18",
    ghost: "border-white/15 bg-transparent text-white hover:bg-white/5",
    disabled: "cursor-not-allowed border-white/10 bg-white/5 text-white/35",
  };

  return (
    <button disabled={disabled} onClick={onClick} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

function Input({ value, onChange, placeholder = "" }) {
  return (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
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
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] ${tones[tone] || tones.muted}`}>
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
          <div className="mt-0.5 font-mono text-xs text-white/60">{shortAddr(wallet)}</div>
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
          <div className="font-mono text-xs text-white/55">{title.toUpperCase()}</div>
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
        <Motion.div
          className="h-full bg-white/70"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <div className="mt-1 text-right font-mono text-[10px] text-white/55">{pct}%</div>
    </div>
  );
}

function phaseLabel(phase) {
  const map = {
    reveal: "Reveal",
    submit: "Submit",
    verdict: "Verdict",
    challenge_window: "Appeal",
    challenge_vote: "Vote",
    challenge_review: "Review",
    challenge_result: "Result",
    judge_error: "Retry",
    completed: "Completed",
  };
  return map[phase] || phase;
}

function phaseTone(phase) {
  if (phase === "submit") return "good";
  if (phase === "challenge_vote" || phase === "judge_error") return "warn";
  if (phase === "challenge_result") return "good";
  return "muted";
}
