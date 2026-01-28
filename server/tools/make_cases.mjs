import fs from "fs";

function pick(arr, i) { return arr[i % arr.length]; }

const styles = [
  "cinematic", "watercolor", "pixel art", "oil painting", "photorealistic", "anime",
  "low-poly 3D", "isometric", "ink sketch", "paper cutout", "retro poster", "noir"
];

const subjects = [
  "robot detective", "astronaut cat", "floating island village", "ancient library",
  "clockwork dragon", "neon samurai", "mystic fox", "desert caravan", "subway magician",
  "underwater city", "sky pirate", "forest shrine", "space diner", "cyber monk",
  "moon base engineer", "haunted lighthouse", "snowy mountain temple", "street food stall",
  "giant mecha gardener", "time-traveling courier"
];

const settings = [
  "rainy neon city", "sunset coastline", "misty forest", "busy night market",
  "abandoned space station", "victorian alley", "floating sky islands", "deep ocean trench",
  "ancient ruins", "desert canyon", "arctic research outpost", "volcanic crater"
];

const lighting = [
  "moody lighting", "soft golden hour", "dramatic rim light", "holographic glow",
  "stormy atmosphere", "warm lantern light", "cold blue moonlight", "high-contrast shadows"
];

const extra = [
  "ultra-detailed", "highly stylized", "shallow depth of field", "wide angle",
  "close-up portrait", "dynamic composition", "clean lines", "film grain", "bokeh",
  "vibrant palette", "muted palette", "minimalist background"
];

// Build 100 prompts deterministically
const cases = [];
for (let i = 1; i <= 100; i++) {
  const id = String(i).padStart(3, "0");
  const prompt =
    `${pick(styles, i)} scene of a ${pick(subjects, i*2)} in a ${pick(settings, i*3)}, ` +
    `${pick(lighting, i*5)}, ${pick(extra, i*7)}, ${pick(extra, i*11)}`;

  // Placeholder images: unique non-repeating URLs (free). Swap later with real AI images.
  const imageUrl = `https://picsum.photos/seed/promptheist_${id}/1200/700`;

  cases.push({
    id: `case_${id}`,
    imageUrl,
    secretPrompt: prompt
  });
}

fs.writeFileSync("cases.json", JSON.stringify(cases, null, 2));
console.log("✅ wrote server/cases.json with", cases.length, "cases");
