import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function isHttpUrl(u) {
  return typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://"));
}

export function loadCases(packFile = "pack_v1.json") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packPath = path.join(here, "cases", packFile);

  if (!fs.existsSync(packPath)) {
    throw new Error(`Case pack not found: ${packPath}`);
  }

  const raw = fs.readFileSync(packPath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data) || data.length < 10) {
    throw new Error(`Invalid case pack: expected an array (>=10). Got: ${typeof data}`);
  }

  const seenIds = new Set();
  for (const c of data) {
    if (!c || typeof c !== "object") throw new Error("Invalid case entry: not an object");
    if (typeof c.id !== "string" || !c.id.trim()) throw new Error("Invalid case entry: missing id");
    if (seenIds.has(c.id)) throw new Error(`Duplicate case id: ${c.id}`);
    seenIds.add(c.id);

    if (typeof c.secretPrompt !== "string" || !c.secretPrompt.trim()) {
      throw new Error(`Invalid case ${c.id}: missing secretPrompt`);
    }

    // imageUrl can be http(s) or a relative path you serve later (e.g. /cases/images/042.webp)
    if (typeof c.imageUrl !== "string" || !c.imageUrl.trim()) {
      throw new Error(`Invalid case ${c.id}: missing imageUrl`);
    }
    if (!isHttpUrl(c.imageUrl) && !c.imageUrl.startsWith("/")) {
      throw new Error(`Invalid case ${c.id}: imageUrl must be http(s) or start with "/". Got: ${c.imageUrl}`);
    }
  }

  return data;
}
