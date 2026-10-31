// Uses OpenAI's Decisions API to rank candidates the way the game rewards them.
// Being accepted matters most, so likely-listed answers outrank merely obscure ones.

const TIMEOUT_MS = 4000;
const MIN_FIT = 0.1;
const MIN_SURVIVAL_FIT = 0.5;

const OBSCURITY_LEVELS = [
  { label: "Almost everyone would think of this answer" },
  { label: "Many people would think of this answer" },
  { label: "Only enthusiasts would think of this answer" },
  { label: "Almost nobody would think of this answer" },
];

export function buildRequest(prompt, candidates) {
  const questions = candidates.flatMap((name, i) => [
    {
      type: "predicate",
      name: `listed_${i}`,
      instructions: `A thorough reference list of answers to the trivia prompt, compiled from Wikipedia, dictionaries and encyclopedias, would include "${name}" under that name.`,
    },
    {
      type: "score",
      name: `obscure_${i}`,
      instructions: `How obscure is "${name}" as an answer to the trivia prompt?`,
      levels: OBSCURITY_LEVELS,
    },
    {
      type: "predicate",
      name: `fits_${i}`,
      instructions: `Taking every word of the trivia prompt strictly and in its most ordinary meaning, "${name}" clearly meets every condition in the prompt. Borderline, disputed or technically-related cases do not count.`,
    },
  ]);
  return { model: "gpt-6-luna", input: `Trivia prompt: ${prompt}`, questions };
}

// The fit check only removes confident misses. Testing showed that ranking by it
// pushes suggestions toward mainstream answers that score lower.
export function applyGrades(candidates, answers) {
  const byName = new Map(answers.map((a) => [a.name, a]));
  return candidates
    .map((name, i) => {
      const fit = byName.get(`fits_${i}`);
      const listed = byName.get(`listed_${i}`)?.probability ?? 0;
      const obscure = byName.get(`obscure_${i}`)?.score ?? 0;
      return { name, fits: fit?.probability ?? 0, rank: obscure * listed ** 2, i };
    })
    .filter((c) => c.fits >= MIN_FIT)
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .map((c) => c.name);
}

// Puffer Party is about staying alive. A pop costs a heart, and a heart takes 600
// points of answers to earn back, so being accepted comes first. Rarity only
// separates answers that are about equally safe, since rarer ones fill the meter faster.
export function rankForSurvival(candidates, answers) {
  const byName = new Map(answers.map((a) => [a.name, a]));
  return candidates
    .map((name, i) => {
      const fits = byName.get(`fits_${i}`)?.probability ?? 0;
      const listed = byName.get(`listed_${i}`)?.probability ?? 0;
      const obscure = byName.get(`obscure_${i}`)?.score ?? 0;
      return { name, fits, rank: (listed * fits) ** 3 * (1 + obscure / 6), i };
    })
    .filter((c) => c.fits >= MIN_SURVIVAL_FIT)
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .map((c) => c.name);
}

export async function grade(prompt, candidates, openaiKey, fetchFn = fetch, rank = applyGrades) {
  const res = await fetchFn("https://api.openai.com/v1/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify(buildRequest(prompt, candidates)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Luna returned ${res.status}`);
  const data = await res.json();
  return rank(candidates, data.answers);
}
