// Saves every answer sheet krillion.io hands out without an unlock into eval/, for
// studying how answers are graded. The extension itself never reads these.
// Usage: node scripts/fetch-sheets.mjs
import { mkdirSync, writeFileSync } from "node:fs";
const PACKS = ["lexicon", "movies", "sports", "geography"];
const GAMES = 30;
const UNLIMITED = 76;
const out = new URL("../eval/lists/", import.meta.url);
mkdirSync(out, { recursive: true });

async function save(path, name) {
  const res = await fetch(`https://krillion.io${path}`, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return false;
  writeFileSync(new URL(`${name}.json`, out), await res.text());
  return true;
}

const today = new Date().toISOString().slice(0, 10);
console.log("today", (await save(`/api/reveal?date=${today}`, `daily-${today}`)) ? "saved" : "closed");
for (const pack of PACKS) {
  let open = 0;
  for (let n = 1; n <= GAMES; n++) if (await save(`/api/packs/${pack}/${n}/reveal`, `pack-${pack}-${n}`)) open++;
  console.log(pack, open, "of", GAMES, "open");
}
let open = 0;
for (let n = 1; n <= UNLIMITED; n++) if (await save(`/api/unlimited/${n}/reveal`, `unl-${n}`)) open++;
console.log("unlimited", open, "of", UNLIMITED, "open");
