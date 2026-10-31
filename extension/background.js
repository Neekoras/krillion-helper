import { getCandidates } from "./lib/candidates.js";
import { grade } from "./lib/luna.js";
import { addReveal, merge, promptKey } from "./lib/book.js";
import { describeError } from "./lib/messages.js";

async function suggest(prompt) {
  const { openaiKey, book = {} } = await chrome.storage.local.get(["openaiKey", "book"]);
  const entry = book[promptKey(prompt)];

  if (entry?.gems?.length) return { suggestions: merge(entry, []), note: "Seen before. From your answer book." };
  if (!openaiKey) {
    return { suggestions: merge(entry, []), note: "Suggestions need an OpenAI key.", needsKey: true };
  }

  let candidates;
  try {
    candidates = await getCandidates(prompt, openaiKey);
  } catch (err) {
    return { suggestions: merge(entry, []), note: describeError(err) };
  }
  if (!candidates.length) return { suggestions: merge(entry, []) };

  try {
    const graded = await grade(prompt, candidates, openaiKey);
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
    suggest(message.prompt).then(sendResponse);
    return true;
  }
  if (message.type === "reveal") saveReveal(message.rounds);
  if (message.type === "result") saveResult(message);
  if (message.type === "openOptions") chrome.runtime.openOptionsPage();
  return false;
});
