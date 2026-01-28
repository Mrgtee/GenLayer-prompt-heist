import fs from "fs";

const file = "App.jsx";
let s = fs.readFileSync(file, "utf8");

function mustFind(re, msg) {
  if (!re.test(s)) {
    console.error("❌", msg);
    process.exit(1);
  }
}

/**
 * 1) Replace Asimov chain with Studio chain
 * - Keep reading env vars but default to Studio values.
 */
mustFind(/const\s+genlayerAsimov\s*=\s*defineChain\(/, "Could not find genlayerAsimov defineChain block.");

s = s.replace(
  /const\s+genlayerAsimov\s*=\s*defineChain\(\{\s*[\s\S]*?\}\);\s*/m,
`const genlayerStudio = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID || 61999),
  name: "GenLayer Studio Network",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_HTTP || "https://studio.genlayer.com/api"] } },
});
`
);

// Update any remaining references
s = s.replaceAll("genlayerAsimov", "genlayerStudio");

/**
 * 2) Add a helper to enforce Studio network in wallet
 */
if (!s.includes("async function ensureStudioNetwork")) {
  // Insert right before connectWallet()
  mustFind(/async function connectWallet\(\)\s*\{/, "Could not find connectWallet() to insert ensureStudioNetwork().");

  s = s.replace(
    /async function connectWallet\(\)\s*\{/,
`async function ensureStudioNetwork() {
    // GenLayer Studio Network (studionet)
    const chainIdHex = "0xF22F"; // 61999
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (e) {
      // 4902 = Unrecognized chain → add it
      if (e?.code === 4902) {
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
        // then switch again
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } else {
        throw e;
      }
    }
  }

  async function connectWallet() {`
  );
}

/**
 * 3) Ensure connectWallet and saveDisplayName both enforce Studio network before signing / requesting addresses
 */
mustFind(/async function connectWallet\(\)\s*\{[\s\S]*?const client = createWalletClient\(/m, "connectWallet() structure not found.");

s = s.replace(
  /async function connectWallet\(\)\s*\{([\s\S]*?)const client = createWalletClient\(/m,
  (m, pre) => {
    if (pre.includes("await ensureStudioNetwork()")) return m; // already patched
    return `async function connectWallet() {${pre}    await ensureStudioNetwork();\n\n    const client = createWalletClient(`;
  }
);

mustFind(/function saveDisplayName\(\)\s*\{[\s\S]*?const client = createWalletClient\(/m, "saveDisplayName() structure not found.");

s = s.replace(
  /function saveDisplayName\(\)\s*\{([\s\S]*?)const client = createWalletClient\(/m,
  (m, pre) => {
    // inside the async IIFE in saveDisplayName, add ensureStudioNetwork() before createWalletClient
    if (m.includes("await ensureStudioNetwork()")) return m;
    return `function saveDisplayName() {${pre}      await ensureStudioNetwork();\n\n      const client = createWalletClient(`;
  }
);

/**
 * 4) Update top header badge "Asimov" -> "Studio"
 */
s = s.replace(
  /<Badge label="Asimov"\s*\/>/g,
  `<Badge label="Studio" />`
);

/**
 * 5) Round leaderboard displayName + reasoning fix:
 * - Pass members into Leaderboard()
 * - Map wallet->displayName inside Leaderboard()
 * - reasoning fallback
 */
mustFind(/function Leaderboard\(\{\s*match\s*,\s*roundId\s*\}\)/, "Could not find Leaderboard({ match, roundId }).");

s = s.replace(
  /function Leaderboard\(\{\s*match\s*,\s*roundId\s*\}\)/,
  `function Leaderboard({ match, roundId, members = [] })`
);

mustFind(/const lb = match\.leaderboard\?\.\[roundId\] \|\| \[\];/, "Could not find lb assignment in Leaderboard().");

s = s.replace(
  /const lb = match\.leaderboard\?\.\[roundId\] \|\| \[\];/,
`const lb = match.leaderboard?.[roundId] || [];
  const byWallet = new Map((members || []).map((m) => [(m.wallet || "").toLowerCase(), m.displayName || ""]));
  const nameOf = (w) => byWallet.get((w || "").toLowerCase()) || "";`
);

// Replace the name line in leaderboard list items
// From: {x.displayName || shortAddr(x.wallet)}
// To: {nameOf(x.wallet) || x.displayName || shortAddr(x.wallet)}
s = s.replace(
  /\{x\.displayName\s*\|\|\s*shortAddr\(x\.wallet\)\}/g,
  `{nameOf(x.wallet) || x.displayName || shortAddr(x.wallet)}`
);

// Reasoning fallback
s = s.replace(
  /\{x\.reasoning\}/g,
  `{x.reasoning || x.why || ""}`
);

/**
 * 6) Pass members into Leaderboard call sites (match tab + leaderboard tab)
 */
s = s.replace(
  /<Leaderboard match=\{match\} roundId=\{roundId\} \/>/g,
  `<Leaderboard match={match} roundId={roundId} members={roomState?.members || []} />`
);

s = s.replace(
  /<Leaderboard match=\{match\} roundId=\{currentRound\.roundId\} \/>/g,
  `<Leaderboard match={match} roundId={currentRound.roundId} members={roomState?.members || []} />`
);

fs.writeFileSync(file, s);
console.log("✅ Patched App.jsx: Studio network + round ruling names/reasoning");
