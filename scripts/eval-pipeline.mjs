// Scores the extension's real suggestion code against a file of known tier lists.
// The lists are only an answer key for this test. The extension never reads them.
// Usage: OPENAI_API_KEY=... node scripts/eval-pipeline.mjs tiers.json
import { readFileSync, writeFileSync } from "node:fs";
import { getCandidates } from "../extension/lib/candidates.js";
import { grade } from "../extension/lib/luna.js";

const POINTS = { krillion: 100, deepcut: 85, rare: 60, schooler: 30, tooclever: 15, plankton: 10 };
const MAX_GUESSES = 8; // Roughly what fits on a 25-second clock.
const key = process.env.OPENAI_API_KEY;
const prompts = Object.values(JSON.parse(readFileSync(process.argv[2], "utf8"))).flat();

const normalize = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

function tierMap(p) {
  const map = new Map();
  for (const [tier, answers] of Object.entries(p.tiers)) {
    for (const a of answers) map.set(normalize(a.split("—")[0]), tier);
  }
  return map;
}

function play(order, tiers) {
  let rejected = 0;
  for (const name of order.slice(0, MAX_GUESSES)) {
    const tier = tiers.get(normalize(name));
    if (tier) return { name, tier, points: POINTS[tier], rejected };
    rejected++;
  }
  return { name: null, tier: null, points: 0, rejected };
}

async function evaluate(p) {
  const start = Date.now();
  try {
    const candidates = await getCandidates(p.prompt, key);
    const order = await grade(p.prompt, candidates, key);
    return { prompt: p.prompt, ms: Date.now() - start, top: order.slice(0, MAX_GUESSES), ...play(order, tierMap(p)) };
  } catch (err) {
    return { prompt: p.prompt, error: err.message };
  }
}

const out = [];
for (let i = 0; i < prompts.length; i += 6) {
  out.push(...(await Promise.all(prompts.slice(i, i + 6).map(evaluate))));
}
writeFileSync("eval/pipeline.json", JSON.stringify(out));

const ok = out.filter((r) => !r.error);
const n = ok.length;
const count = (t) => ok.filter((r) => r.tier === t).length;
const avg = ok.reduce((s, r) => s + r.points, 0) / n;
const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
console.log(`prompts ${n}, errors ${out.length - n}: ${[...new Set(out.filter((r) => r.error).map((r) => r.error))].join("; ")}`);
console.log(`time to suggestions: median ${ms[n >> 1]}ms, slowest ${ms[n - 1]}ms`);
console.log(`score: ${Math.round(avg * 7)}/700 a dive (${avg.toFixed(1)} per prompt)`);
console.log(`Deep Cut or better: ${count("krillion") + count("deepcut")}/${n}`);
console.log(`krillion ${count("krillion")}, deepcut ${count("deepcut")}, rare ${count("rare")}, schooler ${count("schooler")}, tooclever ${count("tooclever")}, plankton ${count("plankton")}, none ${ok.filter((r) => !r.tier).length}`);
console.log(`rejected guesses per prompt: ${(ok.reduce((s, r) => s + r.rejected, 0) / n).toFixed(2)}`);
