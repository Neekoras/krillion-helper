// The Claude client the extension shares. Keys stay in this browser and go only to Anthropic.
import Anthropic from "../vendor/anthropic-sdk.js";

// Sonnet with thinking off answers in about 8 seconds a prompt and scored about the same
// as Opus in testing, while Opus sometimes thought for most of a minute.
export const MODEL = "claude-sonnet-5-5";
export const NO_THINKING = { type: "between_tools" };

// Accounts cap how many requests run at once (about 25 on a new one), and a dive can
// ask for 35 when it fetches every prompt early, so requests wait their turn here.
// Requests for the prompt on screen go first, and some places are kept free for them,
// enough for all of its grading batches to start at once. A job fetched early becomes
// urgent when its prompt appears. A streamed reply gives its place back once it starts
// arriving, which keeps the total under the account's cap.
const MAX_IN_FLIGHT = 12;
const KEPT_FOR_SCREEN = 4;
let inFlight = 0;
const waiting = [];

const limit = (job) => (job.urgent ? MAX_IN_FLIGHT : MAX_IN_FLIGHT - KEPT_FOR_SCREEN);

function startWaiting() {
  for (;;) {
    const fits = (w) => inFlight < limit(w.job);
    let next = waiting.findIndex((w) => w.job.urgent && fits(w));
    if (next < 0) next = waiting.findIndex(fits);
    if (next < 0) return;
    inFlight++;
    waiting.splice(next, 1)[0].resolve();
  }
}

function inTurn(fetchFn, url, init, job) {
  const turn = inFlight < limit(job) ? (inFlight++, Promise.resolve()) : new Promise((resolve) => waiting.push({ resolve, job }));
  return turn
    .then(() => fetchFn(url, init))
    .finally(() => {
      inFlight--;
      startWaiting();
    });
}

export function makeUrgent(job) {
  job.urgent = true;
  startWaiting();
}

export function createClient(apiKey, fetchFn = fetch, job = { urgent: true }) {
  return new Anthropic({
    apiKey,
    fetch: (url, init) => inTurn(fetchFn, url, init, job),
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
  });
}

// Structured output arrives as one text block. A reply cut off at the token limit
// still returns its text, so the caller can keep what arrived whole.
export function replyText(message) {
  return message.content.find((block) => block.type === "text")?.text ?? "";
}
