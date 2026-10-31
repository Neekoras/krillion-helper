// The answer book: what the game revealed after dives you finished.

const BOOK_DEEPCUTS = 20;
const PROMPTS_PER_DIVE = 7;
const METERS_PER_POINT = 10;
const MAX_SEEN_PER_PROMPT = 300;
const TIER_POINTS = { krillion: 100, deepcut: 85, rare: 60, schooler: 30, tooclever: 15, plankton: 10 };
const RARE_POINTS = TIER_POINTS.rare;

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

export function answerKey(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Remembers answers seen during play, per prompt. Items are { prompt, name, tier },
// and a null tier means the game rejected the answer.
export function recordAnswers(seen, items) {
  const next = { ...seen };
  for (const { prompt, name, tier } of items) {
    const key = answerKey(name);
    if (!prompt || !key) continue;
    const pkey = promptKey(prompt);
    const entry = { ...next[pkey] };
    if (tier) {
      entry[key] = { name, tier };
    } else if (!entry[key] && Object.keys(entry).length < MAX_SEEN_PER_PROMPT) {
      entry[key] = { tier: null };
    }
    next[pkey] = entry;
  }
  return next;
}

// Labels suggestions with what play has shown, drops known misses and adds known
// answers. Puffer Party wants any known answer first because it is safe. A dive
// only wants the valuable ones first, and low tiers last.
export function applyKnown(entry, suggestions, { party = false } = {}) {
  if (!entry) return suggestions;
  const used = new Set();
  const out = [];
  for (const s of suggestions) {
    const key = answerKey(s.name);
    const tier = s.tier ?? entry[key]?.tier;
    if (entry[key]?.tier === null && !s.tier) continue;
    used.add(key);
    out.push(tier ? { ...s, tier } : s);
  }
  for (const [key, known] of Object.entries(entry)) {
    if (known.tier && !used.has(key)) out.push({ name: known.name, tier: known.tier });
  }
  const weight = (s) => {
    if (!s.tier) return 0;
    const points = TIER_POINTS[s.tier] ?? 1;
    return party || points >= RARE_POINTS ? points : -1;
  };
  return out.map((s, i) => ({ s, i })).sort((a, b) => weight(b.s) - weight(a.s) || a.i - b.i).map(({ s }) => s);
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
