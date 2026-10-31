// The answer book: what the game revealed after dives you finished.

const BOOK_DEEPCUTS = 20;
const PROMPTS_PER_DIVE = 7;
const METERS_PER_POINT = 10;

export function promptKey(prompt) {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

export function addReveal(book, rounds) {
  const next = { ...book };
  for (const round of rounds) {
    const gems = round.answers.filter((a) => a.tier === "krillion").map((a) => a.answer);
    const deepcuts = round.answers
      .filter((a) => a.tier === "deepcut")
      .slice(0, BOOK_DEEPCUTS)
      .map((a) => a.answer);
    next[promptKey(round.text)] = { gems, deepcuts };
  }
  return next;
}

// Known answers come first; fresh candidates follow, without duplicates.
export function merge(entry, candidates, limit = 6) {
  const out = [];
  const seen = new Set();
  const add = (name, tier) => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tier ? { name, tier } : { name });
    }
  };
  for (const name of entry?.gems ?? []) add(name, "krillion");
  for (const name of entry?.deepcuts?.slice(0, 2) ?? []) add(name, "deepcut");
  for (const name of candidates) add(name);
  return out.slice(0, limit);
}

// The depth a whole dive reaches if every answer scores this many points.
export function diveDepth(pointsPerAnswer) {
  return Math.round(pointsPerAnswer * PROMPTS_PER_DIVE * METERS_PER_POINT);
}

export function summarize(results) {
  const scored = results.filter((r) => r.fromHelper);
  const tiers = {};
  for (const r of scored) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
  const total = scored.reduce((sum, r) => sum + r.score, 0);
  const averagePoints = scored.length ? total / scored.length : 0;
  return {
    answers: scored.length,
    tiers,
    averagePoints: Math.round(averagePoints),
    paceDepth: diveDepth(averagePoints),
  };
}
