import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../extension/hook.js", import.meta.url), "utf8");

// Runs the page hook against one fake response and returns what it posted.
async function posted(url, body) {
  const messages = [];
  const page = {
    location: { origin: "https://krillion.io" },
    WebSocket: class {},
    postMessage: (message) => messages.push(message),
    fetch: async () => ({ ok: true, clone: () => ({ json: async () => body }) }),
  };
  page.window = page;
  vm.runInNewContext(source, page);
  await page.fetch(url);
  await new Promise((resolve) => setImmediate(resolve));
  return messages;
}

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
