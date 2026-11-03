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
export function buildSurvivalQuery(prompt) {
  return (
    `Party game category: "${prompt}". List 40 answers that a broad reference list ` +
    `of answers would certainly include, starting with the ones you are most sure ` +
    `of. Mix very common answers with moderately well-known ones. Use the plain ` +
    `name most people would type, with no added words or punctuation. Every answer ` +
    `must clearly satisfy the category in its most ordinary meaning.`
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

// Listing names needs no reasoning, so thinking stays off to keep the list fast.
async function ask(prompt, apiKey, fetchFn, query) {
  const message = await createClient(apiKey, fetchFn).messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      thinking: NO_THINKING,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: query(prompt) }],
    },
    { timeout: TIMEOUT_MS },
  );
  return parseAnswers(replyText(message) || "{}");
}

// An empty reply gets one retry.
export async function getCandidates(prompt, apiKey, fetchFn = fetch, query = buildQuery) {
  const first = await ask(prompt, apiKey, fetchFn, query);
  return first.length ? first : ask(prompt, apiKey, fetchFn, query);
}
