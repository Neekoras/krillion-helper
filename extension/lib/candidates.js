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

// Thirty answers can all be written and graded within the eight seconds a list may
// take. Replaying saved dives, ranking 30 scored the same as ranking 40.
const COUNT = 30;

// What the game's own answer sheets show (see the README): lists come from Wikipedia,
// dictionaries and encyclopedias; the tier an answer lands in depends on the shape of
// the list; and a quarter of rejected answers were listed under a shorter name.
const GUIDELINES =
  `The game accepts answers from a list built by merging Wikipedia, dictionaries and ` +
  `encyclopedias, so every answer must be a real, well-documented entry; a doubtful one ` +
  `is worth less than a solid one. Write each the way its article or dictionary ` +
  `headword is titled: the plain name, with no article and no descriptor the prompt ` +
  `already implies (write "Eephus" not "Eephus pitch", "Bootleg" not "Bootleg ` +
  `recording"), unless the longer form is the real title. For a single-word or ` +
  `spelling prompt, rarer means a word that almost never appears in modern writing: ` +
  `archaic, dialect and technical dictionary words beat long famous ones. Never give ` +
  `the famous "obscure" picks, such as Antidisestablishmentarianism or Human for a ` +
  `great ape; the game marks those down.`;

export function buildQuery(prompt) {
  return (
    `Trivia prompt: "${prompt}". List ${COUNT} answers that most people would not think ` +
    `of. Leave out famous examples. Favor answers enthusiasts know that have one vivid, ` +
    `surprising fact or story behind them. Every answer must strictly satisfy the prompt.\n\n` +
    GUIDELINES
  );
}

// playdaily.org pays most for its rarest tiers and accepts answers beyond the lists
// it shows, so this skips the Wikipedia limit and goes as deep as it can.
export function buildDeepQuery(prompt) {
  return (
    `Trivia prompt: "${prompt}". List ${COUNT} real answers that almost nobody would think ` +
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
    `Party game category: "${prompt}". List ${COUNT} answers that a broad reference list ` +
    `of answers would certainly include, starting with the ones you are most sure ` +
    `of. Mix very common answers with moderately well-known ones. Use the plain ` +
    `name most people would type, with no added words or punctuation. Every answer ` +
    `must clearly satisfy the category in its most ordinary meaning.`;
  if (!exclude.length) return query;
  return (
    `${query} These answers are already used, so leave them out and give different ` +
    `ones. If there are fewer than ${COUNT} left, list only the ones that remain:\n` +
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

// Prompts about spelling ("containing “age”", "ending in -ism", "a country with \"in\" in
// its name", "whose name contains J, K, or V") are checked here letter by letter, because
// Claude offered Kiribati and Brunei for "in" and the graders let them through. Of the
// 13,300 listed answers on the 125 such sheets studied, all pass but one the game got wrong.
const QUOTE = `["'\u201c\u201d\u2018\u2019]`;
const plain = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function letterRule(prompt) {
  const q = (re) => new RegExp(re.source.replace(/Q/g, QUOTE), "i").exec(prompt);
  let m;
  if ((m = q(/(?:containing|contains|with|has|having) (Q\w+Q(?:,? (?:or|and) Q\w+Q)*)(?: in (?:it|its name))?/))) {
    const parts = m[1].match(new RegExp(`${QUOTE}(\\w+)${QUOTE}`, "g")).map((part) => plain(part.slice(1, -1)));
    const every = / and /.test(m[1]);
    return (name) => parts[every ? "every" : "some"]((part) => plain(name).includes(part));
  }
  if ((m = q(/(?:ending|ends) (?:in|with) Q-?(\w+)Q/))) return (name) => plain(name).endsWith(plain(m[1]));
  if ((m = q(/(?:starting|starts|beginning|begins) with Q(\w+)Q/))) return (name) => plain(name).startsWith(plain(m[1]));
  if ((m = /contains? (?:the letters? )?((?:[A-Z],? (?:or )?)+[A-Z])\b/.exec(prompt))) {
    const letters = m[1].match(/[A-Z]/g).map((l) => l.toLowerCase());
    return (name) => letters.some((l) => plain(name).includes(l));
  }
  return null;
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
  const rule = letterRule(prompt);
  const fresh = (text) => parseAnswers(text || "{}").filter((name) => !used.has(sameName(name)) && (!rule || rule(name)));
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
