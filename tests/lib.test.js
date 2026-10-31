import test from "node:test";
import assert from "node:assert/strict";
import { getCandidates, parseAnswers } from "../extension/lib/candidates.js";
import { applyGrades, buildRequest, grade } from "../extension/lib/luna.js";
import { addReveal, diveDepth, merge, promptKey, summarize } from "../extension/lib/book.js";
import { describeError } from "../extension/lib/messages.js";

test("parseAnswers removes duplicates and padded names", () => {
  const out = parseAnswers({ answers: ["Sahlab", " sahlab ", "Hominidae hominidae", "Egad", ""] });
  assert.deepEqual(out, ["Sahlab", "Egad"]);
});

test("parseAnswers accepts a JSON string", () => {
  assert.deepEqual(parseAnswers('{"answers":["Furmint"]}'), ["Furmint"]);
});

test("getCandidates reports API errors", async () => {
  const fetchFn = async () => ({ ok: false, status: 401 });
  await assert.rejects(getCandidates("Name a tea", "k", fetchFn), /Luna returned 401/);
});

test("getCandidates reads Responses output and retries an empty list", async () => {
  const reply = (answers) => ({
    output: [
      { type: "reasoning" },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ answers }) }] },
    ],
  });
  const replies = [reply([]), reply(["Sahlab"])];
  let calls = 0;
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => replies[calls++] };
  };
  assert.deepEqual(await getCandidates("Name a tea", "k", fetchFn), ["Sahlab"]);
  assert.equal(calls, 2);
  assert.equal(urls[0], "https://api.openai.com/v1/responses");
});

const grades = (rows) =>
  rows.flatMap(([, listed, score, fits], i) => [
    { type: "predicate", name: `listed_${i}`, probability: listed },
    { type: "score", name: `obscure_${i}`, score },
    { type: "predicate", name: `fits_${i}`, probability: fits },
  ]);

test("buildRequest asks three named questions per candidate", () => {
  const req = buildRequest("Name a tea", ["Sencha", "Gyokuro"]);
  assert.equal(req.model, "gpt-6-luna");
  assert.equal(req.questions.length, 6);
  assert.equal(req.questions[3].name, "listed_1");
  assert.equal(req.questions[3].type, "predicate");
  assert.equal(req.questions[1].levels.length, 4);
  assert.ok(req.questions[1].levels[0].label);
  assert.equal(req.questions[5].name, "fits_1");
});

test("applyGrades favors likely-listed answers over merely obscure ones", () => {
  const rows = [
    ["Invented tea", 0.3, 3, 0.9],
    ["Gyokuro", 0.95, 2.5, 0.9],
    ["Coffee", 1, 0, 0.9],
    ["Sencha", 0.95, 1.5, 0.9],
  ];
  assert.deepEqual(applyGrades(rows.map(([n]) => n), grades(rows)), ["Gyokuro", "Sencha", "Invented tea", "Coffee"]);
});

test("applyGrades removes only confident misses and doesn't rank by fit", () => {
  const rows = [
    ["Saba", 0.95, 3, 0.05],
    ["Comoros", 0.9, 3, 0.2],
    ["France", 1, 0.5, 1],
  ];
  assert.deepEqual(applyGrades(rows.map(([n]) => n), grades(rows)), ["Comoros", "France"]);
});

test("applyGrades removes a candidate whose fit question was refused", () => {
  const answers = [
    { type: "predicate", name: "listed_0", probability: 1 },
    { type: "score", name: "obscure_0", score: 3 },
    { type: "refusal", name: "fits_0" },
    { type: "predicate", name: "listed_1", probability: 0.5 },
    { type: "score", name: "obscure_1", score: 1 },
    { type: "predicate", name: "fits_1", probability: 0.9 },
  ];
  assert.deepEqual(applyGrades(["Rude word", "Chai"], answers), ["Chai"]);
});

test("grade sends the documented request to the Decisions API", async () => {
  let sent;
  const fetchFn = async (url, init) => {
    sent = { url, init };
    return {
      ok: true,
      json: async () => ({
        answers: [
          { type: "predicate", name: "listed_0", probability: 1 },
          { type: "score", name: "obscure_0", score: 3 },
          { type: "predicate", name: "fits_0", probability: 1 },
        ],
      }),
    };
  };
  assert.deepEqual(await grade("Name a tea", ["Kuzuyu"], "secret", fetchFn), ["Kuzuyu"]);
  assert.equal(sent.url, "https://api.openai.com/v1/decisions");
  assert.equal(sent.init.headers.Authorization, "Bearer secret");
});

test("grade reports Decisions API errors", async () => {
  const fetchFn = async () => ({ ok: false, status: 429 });
  await assert.rejects(grade("Name a tea", ["Kuzuyu"], "k", fetchFn), /Luna returned 429/);
});

const rounds = [
  {
    text: "Name a hot drink",
    answers: [
      { answer: "Coffee", tier: "plankton" },
      { answer: "Kuzuyu", tier: "deepcut" },
      { answer: "Sahlab", tier: "krillion" },
    ],
  },
];

test("addReveal stores the gem and deep cuts", () => {
  const book = addReveal({}, rounds);
  assert.deepEqual(book[promptKey("name a  HOT drink")], { gems: ["Sahlab"], deepcuts: ["Kuzuyu"] });
});

test("merge puts known answers first without duplicates", () => {
  const entry = { gems: ["Sahlab"], deepcuts: ["Kuzuyu"] };
  assert.deepEqual(merge(entry, ["sahlab", "Wassail"]), [
    { name: "Sahlab", tier: "krillion" },
    { name: "Kuzuyu", tier: "deepcut" },
    { name: "Wassail" },
  ]);
});

test("merge can keep the whole queue for refilling the panel", () => {
  const names = Array.from({ length: 9 }, (_, i) => `Tea ${i}`);
  assert.equal(merge(undefined, names).length, 6);
  assert.equal(merge(undefined, names, Infinity).length, 9);
});

test("summarize counts only answers taken from suggestions", () => {
  const results = [
    { fromHelper: true, tier: "krillion", score: 100 },
    { fromHelper: true, tier: "rare", score: 60 },
    { fromHelper: false, tier: "krillion", score: 100 },
  ];
  assert.deepEqual(summarize(results), {
    answers: 2,
    tiers: { krillion: 1, rare: 1 },
    averagePoints: 80,
    paceDepth: 5600,
  });
});

test("summarize handles no results", () => {
  assert.deepEqual(summarize([]), { answers: 0, tiers: {}, averagePoints: 0, paceDepth: 0 });
});

test("diveDepth matches the game's 7,000m floor", () => {
  assert.equal(diveDepth(100), 7000);
  assert.equal(diveDepth(85), 5950);
});

test("describeError tells the player what to do", () => {
  assert.match(describeError(new Error("Luna returned 401")), /rejected your key/);
  assert.match(describeError(new Error("Luna returned 429")), /out of credit/);
  assert.match(describeError(new Error("The operation was aborted due to timeout")), /too long/);
  assert.match(describeError(new TypeError("Failed to fetch")), /Can't reach/);
  assert.match(describeError(new Error("Luna returned 500")), /returned an error/);
});

await import("../extension/party-core.js");
const { createRoom, applyMessage, isActive, remaining, normalizeAnswer } = globalThis.KrillionParty;
const roundFields = { phase: "round", holderId: "a", category: { index: 1, text: "Name a tea", threshold: 11, accepted: 0 } };
const snap = (isPrivate, fields = roundFields) => ({ t: "snap", room: { settings: { isPrivate }, players: [], events: [], ...fields } });

test("party runs in public and private rooms during a round", () => {
  assert.equal(isActive(applyMessage(createRoom(), snap(true))), true);
  assert.equal(isActive(applyMessage(createRoom(), snap(false))), true);
  assert.equal(isActive(applyMessage(createRoom(), { t: "snap", room: roundFields })), true);
});

test("party stays off outside a round or without a category", () => {
  assert.equal(isActive(applyMessage(createRoom(), snap(false, { ...roundFields, phase: "lobby" }))), false);
  assert.equal(isActive(applyMessage(createRoom(), snap(false, { ...roundFields, category: null }))), false);
});

test("party removes answers accepted or missed by anyone", () => {
  const room = applyMessage(createRoom(), snap(true));
  applyMessage(room, {
    t: "patch",
    patch: {
      events: [
        { kind: "pass", from: "a", to: "b", answer: "Gyokuro", tier: "deepcut" },
        { kind: "reject", playerId: "b", text: "Hóji-cha", why: "miss" },
      ],
    },
  });
  const left = remaining(room, [{ name: "gyokuro" }, { name: "Hoji Cha" }, { name: "Sencha" }]);
  assert.deepEqual(left, [{ name: "Sencha" }]);
});

test("party resets what was said when the category changes", () => {
  const room = applyMessage(createRoom(), snap(true));
  applyMessage(room, { t: "patch", patch: { events: [{ kind: "pass", answer: "Gyokuro" }] } });
  applyMessage(room, { t: "patch", patch: { set: { category: { index: 2, text: "Name a dog" } } } });
  assert.equal(room.category, "Name a dog");
  assert.equal(room.said.size, 0);
});

test("party keeps what was said when only the accepted count changes", () => {
  const room = applyMessage(createRoom(), snap(true));
  applyMessage(room, { t: "patch", patch: { events: [{ kind: "pass", answer: "Gyokuro" }], set: { category: { index: 1, text: "Name a tea", accepted: 1 } } } });
  assert.equal(room.said.has(normalizeAnswer("Gyokuro")), true);
});

test("party recovers said answers from players after reconnecting", () => {
  const room = applyMessage(createRoom(), { t: "snap", room: { settings: { isPrivate: true }, ...roundFields, events: [], players: [{ lastAnswer: { text: "Bancha", tier: "rare" } }] } });
  assert.equal(room.said.has("bancha"), true);
});

test("party turns off when the round ends", () => {
  const room = applyMessage(createRoom(), snap(true));
  applyMessage(room, { t: "patch", patch: { set: { phase: "over", holderId: null } } });
  assert.equal(isActive(room), false);
});
