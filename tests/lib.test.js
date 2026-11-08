import test from "node:test";
import assert from "node:assert/strict";
import { buildSurvivalQuery, getCandidates, parseAnswers } from "../extension/lib/candidates.js";
import { applyGrades, buildRequest, grade, rankForDeepTiers, rankForSurvival, startGrading, toAnswers } from "../extension/lib/grading.js";
import { addReveal, applyKnown, diveDepth, merge, promptKey, recordAnswers, summarize } from "../extension/lib/book.js";
import { describeError } from "../extension/lib/messages.js";
import { createClient, makeUrgent } from "../extension/lib/claude.js";
import { APIConnectionTimeoutError, AuthenticationError, RateLimitError } from "../extension/vendor/anthropic-sdk.js";

test("parseAnswers removes duplicates and padded names", () => {
  const out = parseAnswers({ answers: ["Sahlab", " sahlab ", "Hominidae hominidae", "Egad", ""] });
  assert.deepEqual(out, ["Sahlab", "Egad"]);
});

test("parseAnswers keeps real names that repeat a word", () => {
  const names = ["Hori hori", "Miaow Miaow", "Yo Yo Honey Singh", "Feast of Saint Francis of Assisi"];
  assert.deepEqual(parseAnswers({ answers: names }), names);
});

test("parseAnswers keeps the whole answers from a reply that was cut off", () => {
  assert.deepEqual(parseAnswers('{"answers":["Hafnium","Rhenium \\"Re\\"","Osmi'), ["Hafnium", 'Rhenium "Re"']);
});

test("parseAnswers accepts a JSON string", () => {
  assert.deepEqual(parseAnswers('{"answers":["Furmint"]}'), ["Furmint"]);
});

// A Messages API reply as the SDK receives it over fetch.
const claudeReply = (text, stop_reason = "end_turn") =>
  new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text }],
      stop_reason,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

// A streamed Messages API reply, sending the text in the given pieces.
const claudeStream = (pieces) => {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const body = [
    event("message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }),
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ...pieces.map((text) => event("content_block_delta", { index: 0, delta: { type: "text_delta", text } })),
    event("content_block_stop", { index: 0 }),
    event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }),
    event("message_stop", {}),
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const claudeError = (status, type, message = "test") =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

test("getCandidates reports API errors", async () => {
  const fetchFn = async () => claudeError(401, "authentication_error");
  await assert.rejects(getCandidates("Name a tea", "k", fetchFn), AuthenticationError);
});

const tenTeas = JSON.stringify({ answers: Array.from({ length: 10 }, (_, i) => `Tea ${i}`) });

test("getCandidates tops up a short list with safe answers", async () => {
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push(JSON.parse(init.body).messages[0].content);
    return claudeReply(sent.length === 1 ? '{"answers":["Barry Nelson"]}' : '{"answers":["Sean Connery","barry nelson","George Lazenby"]}');
  };
  const prompt = "Name an actor who has played James Bond";
  assert.deepEqual(await getCandidates(prompt, "k", fetchFn), ["Barry Nelson", "Sean Connery", "George Lazenby"]);
  assert.equal(sent[1], buildSurvivalQuery(prompt));
});

test("getCandidates keeps a short list if the top-up fails", async () => {
  let calls = 0;
  const fetchFn = async () => (++calls === 1 ? claudeReply('{"answers":["Barry Nelson"]}') : claudeError(529, "overloaded_error"));
  assert.deepEqual(await getCandidates("Name a Bond actor", "k", fetchFn), ["Barry Nelson"]);
});

test("getCandidates doesn't top up a long list or a safe one", async () => {
  let calls = 0;
  const fetchFn = async () => (calls++, claudeReply(calls === 1 ? tenTeas : '{"answers":["Sencha"]}'));
  assert.equal((await getCandidates("Name a tea", "k", fetchFn)).length, 10);
  calls = 1;
  assert.deepEqual(await getCandidates("Name a tea", "k", fetchFn, buildSurvivalQuery), ["Sencha"]);
  assert.equal(calls, 2);
});

test("getCandidates shows names as they stream in, a few at a time", async () => {
  const names = Array.from({ length: 10 }, (_, i) => `Tea ${i}`);
  const pieces = ['{"answers":[', ...names.map((n, i) => `${i ? "," : ""}"${n}"`), "]}"];
  const partials = [];
  const out = await getCandidates("Name a tea", "k", async () => claudeStream(pieces), undefined, { onPartial: (p) => partials.push(p.length) });
  assert.deepEqual(out, names);
  assert.deepEqual(partials, [3, 6, 9]);
});

test("requests for the prompt on screen jump the queue", async () => {
  const gates = [];
  const started = [];
  const fetchFn = (_url, init) => {
    started.push(JSON.parse(init.body).messages[0].content);
    return new Promise((resolve) => gates.push(() => resolve(claudeReply("ok"))));
  };
  const send = (name, job) => createClient("k", fetchFn, job).messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: name }] });
  const early = { urgent: false };
  const all = Array.from({ length: 10 }, (_, i) => send(`busy ${i}`, early));
  const onScreen = { urgent: false };
  all.push(send("on screen", onScreen));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(started.length, 8, "early requests leave places free for the screen");
  makeUrgent(onScreen);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(started.at(-1), "on screen");
  gates.shift()();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(started.length, 9, "early requests stay within their share");
  while (gates.length) gates.shift()(), await new Promise((r) => setTimeout(r, 5));
  await Promise.all(all);
});

test("getCandidates reads Claude's answers and retries an empty list", async () => {
  const replies = [claudeReply('{"answers":[]}'), claudeReply(tenTeas)];
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push({ url: String(url), init });
    return replies[sent.length - 1];
  };
  assert.equal((await getCandidates("Name a tea", "secret", fetchFn))[0], "Tea 0");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(new Headers(sent[0].init.headers).get("authorization"), "Bearer secret");
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.deepEqual(body.thinking, { type: "between_tools" });
  assert.equal(body.output_config.format.type, "json_schema");
});

const grades = (rows) => toAnswers(Object.fromEntries(rows.map(([, listed, score, fits], i) => [i, [listed, score, fits]])));

test("buildRequest numbers a batch from its first candidate and requires every one", () => {
  const req = buildRequest("Name a tea", ["Sencha", "Gyokuro"], 10);
  assert.equal(req.model, "claude-sonnet-5-5");
  assert.deepEqual(req.thinking, { type: "between_tools" });
  assert.match(req.messages[0].content, /10\. Sencha\n11\. Gyokuro/);
  assert.deepEqual(req.output_config.format.schema.required, ["10", "11"]);
});

test("toAnswers skips a candidate whose scores came back incomplete", () => {
  const answers = toAnswers({ 0: [0.9, 2, 0.8], 1: [0.5] });
  assert.deepEqual(
    answers.map((a) => a.name),
    ["listed_0", "obscure_0", "fits_0"],
  );
});

test("applyGrades ranks by obscurity squared times the chance of being listed", () => {
  const rows = [
    ["Invented tea", 0.3, 3, 0.9],
    ["Gyokuro", 0.95, 2.5, 0.9],
    ["Coffee", 1, 0, 0.9],
    ["Sencha", 0.95, 1.5, 0.9],
  ];
  // A rejection only costs time, so a likely Deep Cut outranks a certain Rare.
  assert.deepEqual(applyGrades(rows.map(([n]) => n), grades(rows)), ["Gyokuro", "Invented tea", "Sencha", "Coffee"]);
});

test("applyGrades removes only confident misses and doesn't rank by fit", () => {
  const rows = [
    ["Saba", 0.95, 3, 0.01],
    ["Low fit but listed", 0.95, 3, 0.05],
    ["Comoros", 0.9, 3, 0.2],
    ["France", 1, 0.5, 1],
  ];
  assert.deepEqual(applyGrades(rows.map(([n]) => n), grades(rows)), ["Low fit but listed", "Comoros", "France"]);
});

test("rankForDeepTiers keeps rewarding obscurity past enthusiast level", () => {
  const rows = [
    ["Enthusiast pick", 0.9, 2, 0.9],
    ["Almost unknown", 0.8, 3, 0.9],
    ["Famous", 1, 0, 0.9],
    ["Doesn't fit", 1, 3, 0.01],
  ];
  assert.deepEqual(rankForDeepTiers(rows.map(([n]) => n), grades(rows)), ["Almost unknown", "Enthusiast pick", "Famous"]);
});

test("applyGrades keeps rewarding obscurity past enthusiast level", () => {
  const rows = [
    ["Enthusiast pick", 0.8, 2, 0.9],
    ["Almost unknown", 0.7, 3, 0.9],
  ];
  assert.deepEqual(applyGrades(rows.map(([n]) => n), grades(rows)), ["Almost unknown", "Enthusiast pick"]);
});

test("rankForSurvival puts safe answers ahead of rare risky ones", () => {
  const rows = [
    ["Invented tea", 0.3, 3, 0.9],
    ["Gyokuro", 0.95, 2.5, 0.9],
    ["Green tea", 1, 0, 1],
    ["Sencha", 0.95, 1.5, 0.9],
  ];
  assert.deepEqual(rankForSurvival(rows.map(([n]) => n), grades(rows)), ["Green tea", "Gyokuro", "Sencha", "Invented tea"]);
});

test("rankForSurvival uses rarity to separate equally safe answers", () => {
  const rows = [
    ["Black tea", 0.95, 0, 0.95],
    ["Oolong", 0.95, 2, 0.95],
  ];
  assert.deepEqual(rankForSurvival(rows.map(([n]) => n), grades(rows)), ["Oolong", "Black tea"]);
});

test("rankForSurvival removes answers that probably don't fit", () => {
  const rows = [
    ["Comoros", 0.9, 3, 0.2],
    ["France", 1, 0.5, 1],
  ];
  assert.deepEqual(rankForSurvival(rows.map(([n]) => n), grades(rows)), ["France"]);
});

test("getCandidates can ask for safe answers", async () => {
  let body;
  const fetchFn = async (_url, init) => {
    body = JSON.parse(init.body);
    return claudeReply('{"answers":["Green tea"]}');
  };
  await getCandidates("Name a tea", "k", fetchFn, buildSurvivalQuery);
  assert.equal(body.messages[0].content, buildSurvivalQuery("Name a tea"));
  assert.doesNotMatch(body.messages[0].content, /would not think/);
});

test("getCandidates asks for answers not used yet and never returns one", async () => {
  let body;
  const fetchFn = async (_url, init) => {
    body = JSON.parse(init.body);
    return claudeReply('{"answers":["Sencha","Hōji Cha","Gyokuro"]}');
  };
  const out = await getCandidates("Name a tea", "k", fetchFn, buildSurvivalQuery, { exclude: ["sencha", "hoji cha"] });
  assert.deepEqual(out, ["Gyokuro"]);
  assert.match(body.messages[0].content, /already used[\s\S]*\nsencha\nhoji cha$/);
});

test("buildSurvivalQuery mentions used answers only when there are some", () => {
  assert.equal(buildSurvivalQuery("Name a tea", []), buildSurvivalQuery("Name a tea"));
  assert.doesNotMatch(buildSurvivalQuery("Name a tea"), /already used/);
});

test("applyGrades removes a candidate Claude didn't grade", () => {
  const answers = toAnswers({ 1: [0.5, 1, 0.9] });
  assert.deepEqual(applyGrades(["Skipped", "Chai"], answers), ["Chai"]);
});

test("grade sends one request per batch of ten and ranks every batch together", async () => {
  const candidates = Array.from({ length: 12 }, (_, i) => `Tea ${i}`);
  const bodies = [];
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const numbers = body.output_config.format.schema.required;
    return claudeReply(JSON.stringify(Object.fromEntries(numbers.map((n) => [n, [0.9, Number(n) === 11 ? 3 : 1, 0.9]]))));
  };
  const order = await grade("Name a tea", candidates, "k", fetchFn);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].output_config.format.schema.required, ["10", "11"]);
  assert.equal(order[0], "Tea 11");
  assert.equal(order.length, 12);
});

// Grades every requested number, with Tea 1 the most obscure.
const gradeAll = (sent) => async (_url, init) => {
  const body = JSON.parse(init.body);
  sent?.push(body.messages[0].content);
  const numbers = body.output_config.format.schema.required;
  const names = [...body.messages[0].content.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => m[2]);
  return claudeReply(JSON.stringify(Object.fromEntries(numbers.map((n, i) => [n, [0.9, names[i] === "Tea 1" ? 3 : 1, 0.9]]))));
};

test("startGrading grades ten names at a time as they arrive", async () => {
  const sent = [];
  const grading = startGrading("Name a tea", "k", gradeAll(sent));
  const names = Array.from({ length: 23 }, (_, i) => `Tea ${i}`);
  const settle = () => new Promise((r) => setTimeout(r, 10));
  grading.add(names.slice(0, 9));
  await settle();
  assert.equal(sent.length, 0);
  grading.add(names.slice(0, 21));
  await settle();
  assert.equal(sent.length, 2);
  const order = await grading.finish(names);
  assert.equal(sent.length, 3);
  assert.equal(order.length, 23);
  assert.equal(order[0], "Tea 1");
});

test("startGrading ranks what's graded at the cutoff and leaves out the rest", async () => {
  let calls = 0;
  const graded = gradeAll();
  const fetchFn = (url, init) => (++calls === 1 ? graded(url, init) : new Promise(() => {}));
  const grading = startGrading("Name a tea", "k", fetchFn);
  const names = Array.from({ length: 15 }, (_, i) => `Tea ${i}`);
  const order = await grading.finish(names, undefined, new Promise((r) => setTimeout(r, 20)));
  assert.equal(order.length, 10);
  assert.equal(order[0], "Tea 1");
});

test("startGrading gives up if nothing is graded by the cutoff", async () => {
  const grading = startGrading("Name a tea", "k", () => new Promise(() => {}));
  await assert.rejects(grading.finish(["Sencha"], undefined, Promise.resolve()), /too long/);
});

test("grade fails when Claude stops before finishing a batch", async () => {
  const fetchFn = async () => claudeReply('{"0":[0.9,', "max_tokens");
  await assert.rejects(grade("Name a tea", ["Kuzuyu"], "k", fetchFn), /stopped early/);
});

test("grade reports API errors", async () => {
  const fetchFn = async () => claudeError(429, "rate_limit_error");
  await assert.rejects(grade("Name a tea", ["Kuzuyu"], "k", fetchFn), RateLimitError);
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

test("describeError tells the player what to do", async () => {
  const errorFrom = (fetchFn) => getCandidates("Name a tea", "k", fetchFn).catch((err) => err);
  assert.match(describeError(await errorFrom(async () => claudeError(401, "authentication_error"))), /rejected your key/);
  const broke = claudeError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.");
  assert.match(describeError(await errorFrom(async () => broke)), /out of credits/);
  assert.match(describeError(await errorFrom(async () => claudeError(400, "invalid_request_error"))), /returned an error/);
  assert.match(describeError(await errorFrom(async () => claudeError(429, "rate_limit_error"))), /too fast/);
  assert.match(describeError(await errorFrom(async () => { throw new TypeError("Failed to fetch"); })), /Can't reach/);
  assert.match(describeError(await errorFrom(async () => claudeError(500, "api_error"))), /returned an error/);
  assert.match(describeError(new APIConnectionTimeoutError()), /too long/);
});

await import("../extension/party-core.js");
const { createRoom, applyMessage, observedAnswers, isActive, remaining, normalizeAnswer, used, addFresh } = globalThis.KrillionParty;
const roundFields = { phase: "round", holderId: "a", category: { index: 1, text: "Name a tea", threshold: 11, accepted: 0 } };
const snap = (isPrivate, fields = roundFields) => ({ t: "snap", room: { settings: { isPrivate }, players: [], events: [], ...fields } });

test("party runs in public and private rooms during a round", () => {
  assert.equal(isActive(applyMessage(createRoom(), snap(true))), true);
  assert.equal(isActive(applyMessage(createRoom(), snap(false))), true);
  assert.equal(isActive(applyMessage(createRoom(), { t: "snap", room: roundFields })), true);
});

test("party stays off in rated and quick play games", () => {
  assert.equal(isActive(applyMessage(createRoom(), snap(false, { ...roundFields, rated: true, queue: "party" }))), false);
  assert.equal(isActive(applyMessage(createRoom(), snap(false, { ...roundFields, rated: false, queue: "duel" }))), false);
  assert.equal(isActive(applyMessage(createRoom(), snap(false, { ...roundFields, rated: true }))), false);
  const room = applyMessage(createRoom(), snap(false));
  applyMessage(room, { t: "patch", patch: { set: { rated: true } } });
  assert.equal(isActive(room), false);
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

test("party asks Claude to skip everything suggested or said, and adds only new answers", () => {
  const room = applyMessage(createRoom(), snap(true));
  applyMessage(room, { t: "patch", patch: { events: [{ kind: "pass", answer: "Gyokuro" }] } });
  const suggestions = [{ name: "Sencha" }, { name: "Gyokuro" }];
  assert.deepEqual(used(room, suggestions).sort(), ["gyokuro", "sencha"]);
  const incoming = [{ name: "sencha" }, { name: "GYOKURO" }, { name: "Kukicha" }, { name: "kukicha" }];
  assert.deepEqual(addFresh(room, suggestions, incoming), [{ name: "Kukicha" }]);
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

const observe = (room, message) => {
  const before = { category: room.category, categoryIndex: room.categoryIndex };
  applyMessage(room, message);
  return observedAnswers(before, room, message);
};

test("party observes accepted tiers and misses but not repeats", () => {
  const room = applyMessage(createRoom(), snap(false));
  const items = observe(room, {
    t: "patch",
    patch: {
      events: [
        { kind: "pass", answer: "Gyokuro", tier: "krillion" },
        { kind: "reject", text: "Banana", why: "miss" },
        { kind: "reject", text: "Gyokuro", why: "repeat" },
      ],
    },
  });
  assert.deepEqual(items, [
    { prompt: "Name a tea", name: "Gyokuro", tier: "krillion" },
    { prompt: "Name a tea", name: "Banana", tier: null },
  ]);
});

test("party credits the answer that clears a category to the old category", () => {
  const room = applyMessage(createRoom(), snap(false));
  const items = observe(room, {
    t: "patch",
    patch: {
      set: { category: { index: 2, text: "Name a dog" } },
      events: [
        { kind: "pass", answer: "Gyokuro", tier: "rare" },
        { kind: "category", why: "cleared", index: 2 },
        { kind: "pass", answer: "Akita", tier: "schooler" },
      ],
    },
  });
  assert.deepEqual(items, [
    { prompt: "Name a tea", name: "Gyokuro", tier: "rare" },
    { prompt: "Name a dog", name: "Akita", tier: "schooler" },
  ]);
});

test("party skips answers it can't place in a category", () => {
  const room = applyMessage(createRoom(), snap(false));
  const noEvent = { t: "patch", patch: { set: { category: { index: 2, text: "Name a dog" } }, events: [{ kind: "pass", answer: "Gyokuro", tier: "rare" }] } };
  assert.deepEqual(observe(room, noEvent), []);
  const older = { t: "snap", room: { settings: { isPrivate: false }, ...roundFields, players: [], events: [{ kind: "pass", answer: "Akita", tier: "rare" }, { kind: "category", why: "pop", index: 1 }] } };
  assert.deepEqual(observe(createRoom(), older), []);
});

test("party observes nothing in rated or quick play games", () => {
  const room = applyMessage(createRoom(), snap(false, { ...roundFields, rated: true, queue: "duel" }));
  assert.deepEqual(observe(room, { t: "patch", patch: { events: [{ kind: "pass", answer: "Gyokuro", tier: "rare" }] } }), []);
});

test("recordAnswers keeps tiers per question and a miss can't erase one", () => {
  let seen = recordAnswers({}, [
    { prompt: "Name a tea", name: "Gyokuro", tier: "krillion" },
    { prompt: "Name a tea", name: "Banana", tier: null },
    { prompt: "Name a dog", name: "Akita", tier: "rare" },
  ]);
  seen = recordAnswers(seen, [{ prompt: "name a  TEA", name: "gyokuro", tier: null }]);
  assert.deepEqual(seen["name a tea"], { gyokuro: { name: "Gyokuro", tier: "krillion" }, banana: { tier: null } });
  assert.deepEqual(seen["name a dog"], { akita: { name: "Akita", tier: "rare" } });
});

test("recordAnswers lets an accepted answer replace an old miss", () => {
  const seen = recordAnswers({ "name a tea": { chai: { tier: null } } }, [{ prompt: "Name a tea", name: "Chai", tier: "plankton" }]);
  assert.equal(seen["name a tea"].chai.tier, "plankton");
});

test("applyKnown labels, drops misses and puts known answers first in a party", () => {
  const entry = {
    "green tea": { name: "Green tea", tier: "plankton" },
    gyokuro: { name: "Gyokuro", tier: "krillion" },
    banana: { tier: null },
  };
  const out = applyKnown(entry, [{ name: "Sencha" }, { name: "Banana" }, { name: "green tea" }], { party: true });
  assert.deepEqual(out, [{ name: "Gyokuro", tier: "krillion" }, { name: "green tea", tier: "plankton" }, { name: "Sencha" }]);
});

test("applyKnown puts low tiers last in a dive", () => {
  const entry = { "green tea": { name: "Green tea", tier: "plankton" }, oolong: { name: "Oolong", tier: "rare" } };
  const out = applyKnown(entry, [{ name: "Green tea" }, { name: "Sencha" }]);
  assert.deepEqual(out, [{ name: "Oolong", tier: "rare" }, { name: "Sencha" }, { name: "Green tea", tier: "plankton" }]);
});

test("applyKnown leaves suggestions alone for a new question", () => {
  assert.deepEqual(applyKnown(undefined, [{ name: "Sencha" }]), [{ name: "Sencha" }]);
});

test("party turns off when the round ends", () => {
  const room = applyMessage(createRoom(), snap(true));
  applyMessage(room, { t: "patch", patch: { set: { phase: "over", holderId: null } } });
  assert.equal(isActive(room), false);
});
