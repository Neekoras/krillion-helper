// Asks GPT-6 Luna for obscure, real answers to a Krillion prompt.

const TIMEOUT_MS = 12000;

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

export function parseAnswers(text) {
  const parsed = typeof text === "string" ? JSON.parse(text) : text;
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

function outputText(data) {
  for (const item of data.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text") return part.text;
    }
  }
  return "{}";
}

async function ask(prompt, openaiKey, fetchFn, query) {
  const res = await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: "gpt-6-luna",
      input: query(prompt),
      reasoning: { effort: "none" },
      text: { format: { type: "json_schema", name: "answers", strict: true, schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Luna returned ${res.status}`);
  return parseAnswers(outputText(await res.json()));
}

// An empty reply gets one retry.
export async function getCandidates(prompt, openaiKey, fetchFn = fetch, query = buildQuery) {
  const first = await ask(prompt, openaiKey, fetchFn, query);
  return first.length ? first : ask(prompt, openaiKey, fetchFn, query);
}
