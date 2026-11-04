// Asks Claude for obscure, real answers to a Krillion prompt.
import { MODEL, NO_THINKING, createClient, replyText } from "./claude.js";

const TIMEOUT_MS = 30000;

const SCHEMA = {
  type: "object",
  properties: {
    answers: { type: "array", items: { type: "string" } },
  },
  required: ["answers"],
  additionalProperties: false,
};

export function buildQuery(prompt) {
  return (
    `Trivia prompt: "${prompt}". List 40 answers that most people would not think ` +
    `of but that have their own Wikipedia article or appear on a Wikipedia list. ` +
    `Use the common English name exactly as Wikipedia titles it, with no added ` +
    `words or punctuation. Leave out famous examples and the usual "obscure" picks ` +
    `that everyone reaches for. Favor answers enthusiasts know that have one vivid, ` +
    `surprising fact or story behind them. Every answer must strictly satisfy the prompt.`
  );
}

// playdaily.org pays most for its rarest tiers and accepts answers beyond the lists
// it shows, so this skips the Wikipedia limit and goes as deep as it can.
export function buildDeepQuery(prompt) {
  return (
    `Trivia prompt: "${prompt}". List 40 real answers that almost nobody would think ` +
    `of, starting with the rarest. Leave out famous examples and the usual "obscure" ` +
    `picks that everyone reaches for. Use the plain common name, with no added words ` +
    `or punctuation. Every answer must strictly satisfy the prompt.`
  );
}

// Puffer Party only needs an accepted answer before the puffer pops, and everyone
// in the room uses answers up, so this asks for safe answers and plenty of them.
// Later in a category it also lists the answers already used, so it finds new ones.
export function buildSurvivalQuery(prompt, exclude = []) {
  const query =
    `Party game category: "${prompt}". List 40 answers that a broad reference list ` +
    `of answers would certainly include, starting with the ones you are most sure ` +
    `of. Mix very common answers with moderately well-known ones. Use the plain ` +
    `name most people would type, with no added words or punctuation. Every answer ` +
    `must clearly satisfy the category in its most ordinary meaning.`;
  if (!exclude.length) return query;
  return (
    `${query} These answers are already used, so leave them out and give different ` +
    `ones. If there are fewer than 40 left, list only the ones that remain:\n` +
    exclude.join("\n")
  );
}

// Models sometimes pad lists with doubled words such as "Hominidae hominidae".
// Real names repeat words too: "Feast of Saint Francis of Assisi" isn't doubled at all,
// and the doubled ones seen in real lists ("Hori hori", "Miaow Miaow") use short words.
const MIN_PADDED_WORD = 6;

function looksPadded(name) {
  const words = name.toLowerCase().split(/\s+/);
  return words.some((word, i) => word === words[i + 1] && word.length >= MIN_PADDED_WORD);
}

// A reply can stop partway through the list. The answers that arrived whole are kept.
function parseCutOff(text) {
  const names = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*[,\]]/g)].map((m) => JSON.parse(`"${m[1]}"`));
  return { answers: names };
}

export function parseAnswers(text) {
  let parsed = text;
  if (typeof text === "string") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = parseCutOff(text);
    }
  }
  const seen = new Set();
  const out = [];
  for (const raw of parsed?.answers ?? []) {
    const name = String(raw).trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key) && !looksPadded(name)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// Compares names loosely, so "São Tomé" and "sao tome" count as the same answer.
const sameName = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// How many new names arrive before the list on screen updates while Claude writes.
const PARTIAL_STEP = 3;

// Listing names needs no reasoning, so thinking stays off to keep the list fast.
// With onPartial, the reply streams in and onPartial sees the names so far, so
// the panel can show answers before the whole list and its ranking are done.
async function ask(prompt, apiKey, fetchFn, query, { exclude = [], job, onPartial } = {}) {
  const used = new Set(exclude.map(sameName));
  const fresh = (text) => parseAnswers(text || "{}").filter((name) => !used.has(sameName(name)));
  const client = createClient(apiKey, fetchFn, job);
  const request = {
    model: MODEL,
    max_tokens: 16000,
    thinking: NO_THINKING,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: query(prompt, exclude) }],
  };
  if (!onPartial) return fresh(replyText(await client.messages.create(request, { timeout: TIMEOUT_MS })));
  const stream = client.messages.stream(request, { timeout: TIMEOUT_MS });
  let shown = 0;
  stream.on("text", (_delta, snapshot) => {
    const names = fresh(snapshot);
    if (names.length >= shown + PARTIAL_STEP) {
      shown = names.length;
      onPartial(names);
    }
  });
  return fresh(replyText(await stream.finalMessage()));
}

// A prompt with a short, closed list, such as the actors who have played Bond, leaves
// few obscure answers, and the ones Claude finds are often wrong. Safe answers fill the
// list out, and grading still puts the rarest of them first.
const MIN_CANDIDATES = 10;

// An empty reply gets one retry. Answers in exclude are never returned. The job sets
// the requests' place in the queue.
export async function getCandidates(prompt, apiKey, fetchFn = fetch, query = buildQuery, options = {}) {
  let found = await ask(prompt, apiKey, fetchFn, query, options);
  if (!found.length) found = await ask(prompt, apiKey, fetchFn, query, options);
  if (found.length >= MIN_CANDIDATES || query === buildSurvivalQuery) return found;
  const onPartial = options.onPartial && ((names) => options.onPartial(parseAnswers({ answers: [...found, ...names] })));
  try {
    return parseAnswers({ answers: [...found, ...(await ask(prompt, apiKey, fetchFn, buildSurvivalQuery, { ...options, onPartial }))] });
  } catch (err) {
    if (found.length) return found;
    throw err;
  }
}
