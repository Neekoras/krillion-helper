import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../extension/hook.js", import.meta.url), "utf8");

// Runs the page hook against fake responses, one [url, body, init] per call, and
// returns what it posted.
async function playback(calls) {
  const messages = [];
  let body;
  const page = {
    location: { origin: "https://krillion.io" },
    WebSocket: class {},
    postMessage: (message) => messages.push(message),
    fetch: async () => {
      const current = body;
      return { ok: true, clone: () => ({ json: async () => current }) };
    },
  };
  page.window = page;
  vm.runInNewContext(source, page);
  for (const [url, response, init] of calls) {
    body = response;
    await page.fetch(url, init);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return messages;
}

const posted = (url, body) => playback([[url, body]]);

const answers = [{ answer: "Olinguito", tier: "krillion", score: 100 }];

test("hook reads the Daily Dive reveal, which calls its rounds prompts", async () => {
  const prompts = [{ id: "p1", text: "Name an animal", answers }];
  const [message] = await posted("https://krillion.io/api/reveal?date=2026-11-01", { date: "2026-11-01", prompts });
  assert.equal(message.type, "reveal");
  assert.equal(message.payload.rounds[0].text, "Name an animal");
});

test("hook reads the rounds from Unlimited and pack reveals", async () => {
  const rounds = [{ round: "r1", text: "Name a desert", answers }];
  const [message] = await posted("https://krillion.io/api/packs/geography/1/reveal", { rounds });
  assert.equal(message.payload.rounds[0].text, "Name a desert");
});

test("hook posts an empty list when a reveal has no answers", async () => {
  const [message] = await posted("https://krillion.io/api/reveal?date=2026-11-01", { date: "2026-11-01" });
  assert.equal(message.payload.rounds.length, 0);
});

test("hook reads a playdaily.org answer, which calls its score points", async () => {
  const [message] = await playback([
    [
      "/api/krillion/answer",
      { accepted: true, answer: "Umami", tier: "rare", points: 32 },
      { body: JSON.stringify({ answer: "Umamii" }) },
    ],
  ]);
  assert.equal(message.type, "submit");
  assert.equal(message.payload.guess, "Umamii");
  assert.equal(message.payload.score, 32);
});

test("hook names a playdaily.org answer list using the dealt prompt", async () => {
  const messages = await playback([
    ["/api/krillion/deal", { prompts: [{ id: "abc", text: "Name a color" }] }],
    ["/api/krillion/answers?prompt=abc&ticket=t", { answers: [[0, "Red"], [5, "Falu"]] }],
  ]);
  const message = messages.find((m) => m.type === "reveal");
  assert.equal(message.payload.rounds[0].text, "Name a color");
  assert.deepEqual(
    JSON.parse(JSON.stringify(message.payload.rounds[0].answers)),
    [{ answer: "Red", tier: "plankton" }, { answer: "Falu", tier: "krillion" }],
  );
});

test("hook skips a playdaily.org answer list for a prompt it didn't see dealt", async () => {
  assert.deepEqual(await playback([["/api/krillion/answers?prompt=abc&ticket=t", { answers: [[0, "Red"]] }]]), []);
});

test("hook announces a dive's prompts when the game loads them", async () => {
  const prompts = [{ id: "p1", text: "Name a sauce" }, { id: "p2", text: "Name a tea" }];
  const messages = await posted("https://krillion.io/api/today", { date: "2026-11-02", prompts });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { source: "krillion-helper", type: "prompts", payload: { prompts: ["Name a sauce", "Name a tea"] } },
  ]);
});

test("hook doesn't announce prompts from a reveal", async () => {
  const prompts = [{ id: "p1", text: "Name an animal", answers }];
  const messages = await posted("https://krillion.io/api/reveal?date=2026-11-01", { prompts });
  assert.equal(messages.filter((m) => m.type === "prompts").length, 0);
});
