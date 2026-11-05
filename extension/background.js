import { buildDeepQuery, buildQuery, buildSurvivalQuery, getCandidates } from "./lib/candidates.js";
import { applyGrades, rankForDeepTiers, rankForSurvival, startGrading } from "./lib/grading.js";
import { addReveal, applyKnown, merge, promptKey, recordAnswers } from "./lib/book.js";
import { describeError } from "./lib/messages.js";
import { makeUrgent } from "./lib/claude.js";

// The two sites grade differently, so each keeps its own saved answers and results.
function storeName(name, sender) {
  return new URL(sender.tab?.url ?? "https://krillion.io").hostname === "playdaily.org" ? `${name}:playdaily` : name;
}

// Dive suggestions by site and prompt, so a prompt fetched ahead of time is ready
// when it appears. Replies with a note (an error, a missing key) aren't kept.
// Each keeps its queue job, so its requests can move ahead once its prompt is on screen.
const MAX_READY = 30;
const ready = new Map();

function generateOnce(prompt, sender, urgent) {
  const key = `${storeName("book", sender)} ${promptKey(prompt)}`;
  if (!ready.has(key)) {
    const job = { urgent, shownAt: urgent ? Date.now() : null };
    const reply = generate(prompt, false, sender, [], job);
    ready.set(key, { reply, job });
    reply.then((r) => r.note && ready.delete(key), () => ready.delete(key));
    while (ready.size > MAX_READY) ready.delete(ready.keys().next().value);
  }
  const { reply, job } = ready.get(key);
  if (urgent && !job.urgent) {
    job.shownAt = Date.now();
    makeUrgent(job);
  }
  return reply;
}

async function suggest(prompt, mode, sender, exclude = []) {
  const party = mode === "party";
  const seenName = storeName("seen", sender);
  const { [seenName]: seen = {} } = await chrome.storage.local.get(seenName);
  const reply = await (party ? generate(prompt, true, sender, exclude) : generateOnce(prompt, sender, true));
  return { ...reply, suggestions: applyKnown(seen[promptKey(prompt)], reply.suggestions, { party }) };
}

// The ranked list has to be on screen within 8 seconds of the prompt appearing, so
// ranking stops here, leaving time to show it. Answers not graded by then are left
// out, since an ungraded answer may not fit. A prompt fetched early has no deadline
// until it's on screen.
const RANK_WITHIN_MS = 7500;

function deadline(job) {
  let stop;
  const cutoff = new Promise((resolve) => {
    const check = () => {
      if (stop) return;
      if (job.shownAt !== null && Date.now() >= job.shownAt + RANK_WITHIN_MS) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
  return { cutoff, cancel: () => (stop = true) };
}

async function generate(prompt, party, sender, exclude = [], job = { urgent: true, shownAt: Date.now() }) {
  const bookName = storeName("book", sender);
  const { anthropicKey, [bookName]: book = {} } = await chrome.storage.local.get(["anthropicKey", bookName]);
  const entry = book[promptKey(prompt)];
  const deep = bookName !== "book";
  const query = party ? buildSurvivalQuery : deep ? buildDeepQuery : buildQuery;
  const rank = party ? rankForSurvival : deep ? rankForDeepTiers : applyGrades;

  // A room uses answers up, so Puffer Party always needs more than the book holds.
  if (!party && entry?.gems?.length) return { suggestions: merge(entry, []), note: "Seen before. From your answer book." };
  if (!anthropicKey) {
    return { suggestions: merge(entry, []), note: "Suggestions need an Anthropic key.", needsKey: true };
  }

  // Grading starts while Claude is still writing the list.
  const grading = startGrading(prompt, anthropicKey, fetch, job);
  let written = [];
  const onPartial = (names) => {
    written = names;
    grading.add(names);
  };
  const { cutoff, cancel } = deadline(job);
  try {
    let candidates;
    try {
      const listed = getCandidates(prompt, anthropicKey, fetch, query, { exclude, job, onPartial });
      listed.catch(() => {}); // an error after the cutoff no longer matters
      candidates = await Promise.race([listed, cutoff.then(() => written)]);
    } catch (err) {
      return { suggestions: merge(entry, []), note: describeError(err) };
    }
    if (!candidates.length) {
      const late = job.shownAt !== null && Date.now() >= job.shownAt + RANK_WITHIN_MS;
      return { suggestions: merge(entry, []), ...(late && { note: "Claude took too long on this one." }) };
    }

    try {
      const graded = await grading.finish(candidates, rank, cutoff);
      return { suggestions: merge(entry, graded.length ? graded : candidates, Infinity) };
    } catch {
      return { suggestions: merge(entry, candidates, Infinity), note: "Couldn't rank these, so check them first." };
    }
  } finally {
    cancel();
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
    suggest(message.prompt, message.mode, sender, message.exclude).then(sendResponse);
    return true;
  }
  if (message.type === "prefetch") for (const prompt of message.prompts) generateOnce(prompt, sender, false);
  if (message.type === "reveal") saveInOrder(storeName("book", sender), (book) => addReveal(book, message.rounds));
  if (message.type === "result") saveResult(message, sender);
  if (message.type === "seen") saveInOrder(storeName("seen", sender), (seen) => recordAnswers(seen, message.items));
  if (message.type === "openOptions") chrome.runtime.openOptionsPage();
  return false;
});
