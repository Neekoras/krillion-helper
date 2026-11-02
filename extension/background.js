import { buildDeepQuery, buildQuery, buildSurvivalQuery, getCandidates } from "./lib/candidates.js";
import { applyGrades, grade, rankForDeepTiers, rankForSurvival } from "./lib/luna.js";
import { addReveal, applyKnown, merge, promptKey, recordAnswers } from "./lib/book.js";
import { describeError } from "./lib/messages.js";

// The two sites grade differently, so each keeps its own saved answers and results.
function storeName(name, sender) {
  return new URL(sender.tab?.url ?? "https://krillion.io").hostname === "playdaily.org" ? `${name}:playdaily` : name;
}

async function suggest(prompt, mode, sender) {
  const party = mode === "party";
  const seenName = storeName("seen", sender);
  const { [seenName]: seen = {} } = await chrome.storage.local.get(seenName);
  const reply = await generate(prompt, party, sender);
  return { ...reply, suggestions: applyKnown(seen[promptKey(prompt)], reply.suggestions, { party }) };
}

async function generate(prompt, party, sender) {
  const bookName = storeName("book", sender);
  const { openaiKey, [bookName]: book = {} } = await chrome.storage.local.get(["openaiKey", bookName]);
  const entry = book[promptKey(prompt)];
  const deep = bookName !== "book";
  const query = party ? buildSurvivalQuery : deep ? buildDeepQuery : buildQuery;
  const rank = party ? rankForSurvival : deep ? rankForDeepTiers : applyGrades;

  // A room uses answers up, so Puffer Party always needs more than the book holds.
  if (!party && entry?.gems?.length) return { suggestions: merge(entry, []), note: "Seen before. From your answer book." };
  if (!openaiKey) {
    return { suggestions: merge(entry, []), note: "Suggestions need an OpenAI key.", needsKey: true };
  }

  let candidates;
  try {
    candidates = await getCandidates(prompt, openaiKey, fetch, query);
  } catch (err) {
    return { suggestions: merge(entry, []), note: describeError(err) };
  }
  if (!candidates.length) return { suggestions: merge(entry, []) };

  try {
    const graded = await grade(prompt, candidates, openaiKey, fetch, rank);
    return { suggestions: merge(entry, graded.length ? graded : candidates, Infinity) };
  } catch {
    return { suggestions: merge(entry, candidates, Infinity), note: "Couldn't rank these, so check them first." };
  }
}

async function saveResult({ prompt, answer, tier, score, fromHelper }, sender) {
  const name = storeName("results", sender);
  const { [name]: results = [] } = await chrome.storage.local.get(name);
  results.push({ prompt, answer, tier, score, fromHelper, at: Date.now() });
  await chrome.storage.local.set({ [name]: results });
}

// Room messages and playdaily.org reveals arrive quickly, so saves run one at a
// time to avoid losing any.
let saving = Promise.resolve();

function saveInOrder(name, change) {
  saving = saving
    .then(async () => {
      const { [name]: stored = {} } = await chrome.storage.local.get(name);
      await chrome.storage.local.set({ [name]: change(stored) });
    })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "suggest") {
    suggest(message.prompt, message.mode, sender).then(sendResponse);
    return true;
  }
  if (message.type === "reveal") saveInOrder(storeName("book", sender), (book) => addReveal(book, message.rounds));
  if (message.type === "result") saveResult(message, sender);
  if (message.type === "seen") saveInOrder(storeName("seen", sender), (seen) => recordAnswers(seen, message.items));
  if (message.type === "openOptions") chrome.runtime.openOptionsPage();
  return false;
});
