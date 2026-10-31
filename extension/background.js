import { buildQuery, buildSurvivalQuery, getCandidates } from "./lib/candidates.js";
import { applyGrades, grade, rankForSurvival } from "./lib/luna.js";
import { addReveal, merge, promptKey } from "./lib/book.js";
import { describeError } from "./lib/messages.js";

async function suggest(prompt, mode) {
  const party = mode === "party";
  const { openaiKey, book = {} } = await chrome.storage.local.get(["openaiKey", "book"]);
  const entry = book[promptKey(prompt)];

  // A room uses answers up, so Puffer Party always needs more than the book holds.
  if (!party && entry?.gems?.length) return { suggestions: merge(entry, []), note: "Seen before. From your answer book." };
  if (!openaiKey) {
    return { suggestions: merge(entry, []), note: "Suggestions need an OpenAI key.", needsKey: true };
  }

  let candidates;
  try {
    candidates = await getCandidates(prompt, openaiKey, fetch, party ? buildSurvivalQuery : buildQuery);
  } catch (err) {
    return { suggestions: merge(entry, []), note: describeError(err) };
  }
  if (!candidates.length) return { suggestions: merge(entry, []) };

  try {
    const graded = await grade(prompt, candidates, openaiKey, fetch, party ? rankForSurvival : applyGrades);
    return { suggestions: merge(entry, graded.length ? graded : candidates, Infinity) };
  } catch {
    return { suggestions: merge(entry, candidates, Infinity), note: "Couldn't rank these, so check them first." };
  }
}

async function saveReveal(rounds) {
  const { book = {} } = await chrome.storage.local.get("book");
  await chrome.storage.local.set({ book: addReveal(book, rounds) });
}

async function saveResult({ prompt, answer, tier, score, fromHelper }) {
  const { results = [] } = await chrome.storage.local.get("results");
  results.push({ prompt, answer, tier, score, fromHelper, at: Date.now() });
  await chrome.storage.local.set({ results });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "suggest") {
    suggest(message.prompt, message.mode).then(sendResponse);
    return true;
  }
  if (message.type === "reveal") saveReveal(message.rounds);
  if (message.type === "result") saveResult(message);
  if (message.type === "openOptions") chrome.runtime.openOptionsPage();
  return false;
});
