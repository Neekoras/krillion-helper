// Asks Claude to grade each candidate, then ranks them the way the game rewards them.
// Being accepted matters most, so likely-listed answers outrank merely obscure ones.
import { MODEL, NO_THINKING, createClient, replyText } from "./claude.js";

const TIMEOUT_MS = 15000;
const MIN_FIT = 0.02;
const MIN_SURVIVAL_FIT = 0.5;

// Each candidate gets the questions the ranking reads: whether a reference list includes
// it, how obscure it is (0 to 3) and whether it strictly fits. Answers come back as
// short number lists keyed by candidate number, because output length sets the wait.
const BATCH_SIZE = 10;

export function buildRequest(prompt, candidates, first = 0) {
  const numbers = candidates.map((_, i) => String(first + i));
  const content =
    `Trivia prompt: ${prompt}\n\nCandidate answers:\n` +
    candidates.map((name, i) => `${numbers[i]}. ${name}`).join("\n") +
    `\n\nFor each candidate number, give [listed, obscure, fits]:\n` +
    `- listed: the probability (0 to 1) that a thorough reference list of answers to the prompt, compiled from Wikipedia, dictionaries and encyclopedias, includes it under that name.\n` +
    `- obscure: how obscure it is as an answer, from 0 to 3. 0: almost everyone would think of it. 1: many people would. 2: only enthusiasts would. 3: almost nobody would. Fractions are fine.\n` +
    `- fits: the probability (0 to 1) that, taking every word of the prompt strictly and in its most ordinary meaning, it clearly meets every condition. Borderline, disputed or technically-related cases do not count.\n`;
  const scores = { type: "array", items: { type: "number" } };
  return {
    model: MODEL,
    max_tokens: 16000,
    thinking: NO_THINKING,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: Object.fromEntries(numbers.map((n) => [n, scores])),
          required: numbers,
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content }],
  };
}

// Turns Claude's grades into one entry per question, the shape the rankers read.
// A score list of the wrong length is skipped, so that candidate counts as unlikely to fit.
export function toAnswers(grades) {
  return Object.entries(grades).flatMap(([i, scores]) => {
    if (scores.length !== 3) return [];
    const [listed, obscure, fits] = scores;
    return [
      { name: `listed_${i}`, probability: listed },
      { name: `obscure_${i}`, score: obscure },
      { name: `fits_${i}`, probability: fits },
    ];
  });
}

// The fit check only removes confident misses, and its cutoff is low because 40% of
// answers scored under 0.1 were on the real lists. Testing showed that ranking by it
// pushes suggestions toward mainstream answers that score lower.
// Claude rates most of its own candidates 2 to 2.5 for obscurity, so obscurity keeps
// counting all the way up. On krillion.io a rejected answer only costs time, so the
// chance of being listed matters less than the tier an accepted answer lands in.
// Replaying 66 saved prompt runs, squaring obscurity turned Rare picks into Deep Cuts:
// 78.6 points a prompt against 73.9 for obscurity times listed, and 71.3 against 70.0
// on a separate run.
export function applyGrades(candidates, answers) {
  const byName = new Map(answers.map((a) => [a.name, a]));
  return candidates
    .map((name, i) => {
      const fit = byName.get(`fits_${i}`);
      const listed = byName.get(`listed_${i}`)?.probability ?? 0;
      const obscure = byName.get(`obscure_${i}`)?.score ?? 0;
      return { name, fits: fit?.probability ?? 0, rank: obscure ** 2 * listed, i };
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

// Two gradings of the same list often disagree about which answer is rarest. Grading
// 98 saved lists three times each, the average of three scored 79.2 points a prompt
// against 78.0 for one grading and 78.6 for two, so each batch is graded three times
// at once and the scores are averaged. A prompt on its own is ranked just as fast (5 to
// 7 seconds either way). A whole dive fetched together takes about twice as long to
// finish, but the prompt on screen goes first in the queue.
const GRADINGS = 3;

const mean = (rows) => rows[0].map((_, k) => rows.reduce((sum, row) => sum + row[k], 0) / rows.length);

// Grades names ten at a time as Claude writes them, so most of the list is graded by
// the time it's finished. finish() grades the rest and ranks what has been graded when
// every batch is back, or when cutoff settles, leaving out answers still waiting.
// A batch only fails if every one of its gradings does.
export function startGrading(prompt, apiKey, fetchFn = fetch, job, gradings = GRADINGS) {
  const client = createClient(apiKey, fetchFn, job);
  const scores = new Map();
  const asked = new Set();
  const batches = [];
  let first = 0;

  const send = (names) => {
    const batch = names.filter((name) => !asked.has(name)).slice(0, BATCH_SIZE);
    if (!batch.length) return false;
    batch.forEach((name) => asked.add(name));
    const request = buildRequest(prompt, batch, first);
    const offset = first;
    first += batch.length;
    const copies = Array.from({ length: gradings }, () =>
      client.messages.create(request, { timeout: TIMEOUT_MS }).then((message) => {
        if (message.stop_reason !== "end_turn") throw new Error(`Grading stopped early: ${message.stop_reason}`);
        for (const [i, grades] of Object.entries(JSON.parse(replyText(message)))) {
          const name = batch[Number(i) - offset];
          if (grades.length === 3) scores.set(name, [...(scores.get(name) ?? []), grades]);
        }
      }),
    );
    batches.push(
      Promise.allSettled(copies).then((results) => {
        if (results.every((r) => r.status === "rejected")) throw results[0].reason;
      }),
    );
    return true;
  };

  return {
    // Sends a batch whenever ten more names have arrived.
    add(names) {
      while (names.filter((name) => !asked.has(name)).length >= BATCH_SIZE) send(names);
    },
    async finish(candidates, rank = applyGrades, cutoff = new Promise(() => {})) {
      while (send(candidates));
      const all = Promise.all(batches).then(() => "done");
      all.catch(() => {}); // a batch that fails after the cutoff no longer matters
      if ((await Promise.race([all, cutoff.then(() => "cut off")])) !== "done" && !scores.size) {
        throw new Error("Ranking took too long");
      }
      const graded = candidates.flatMap((name, i) => (scores.has(name) ? [[i, mean(scores.get(name))]] : []));
      return rank(candidates, toAnswers(Object.fromEntries(graded)));
    },
  };
}

// Batches grade in parallel, so a long list takes about as long as a short one.
export async function grade(prompt, candidates, apiKey, fetchFn = fetch, rank = applyGrades, job) {
  return startGrading(prompt, apiKey, fetchFn, job).finish(candidates, rank);
}
