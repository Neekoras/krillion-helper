// The Claude client the extension shares. Keys stay in this browser and go only to Anthropic.
import Anthropic from "../vendor/anthropic-sdk.js";

// Sonnet with thinking off answers in about 8 seconds a prompt and scored about the same
// as Opus in testing, while Opus sometimes thought for most of a minute.
export const MODEL = "claude-sonnet-5-5";
export const NO_THINKING = { type: "between_tools" };

// Accounts cap how many requests run at once (about 25 on a new one), and a dive can
// ask for 35 when it fetches every prompt early, so requests wait their turn here.
const MAX_IN_FLIGHT = 12;
let inFlight = 0;
const waiting = [];

async function inTurn(fetchFn, url, init) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await fetchFn(url, init);
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export function createClient(apiKey, fetchFn = fetch) {
  return new Anthropic({
    apiKey,
    fetch: (url, init) => inTurn(fetchFn, url, init),
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
  });
}

// Structured output arrives as one text block. A reply cut off at the token limit
// still returns its text, so the caller can keep what arrived whole.
export function replyText(message) {
  return message.content.find((block) => block.type === "text")?.text ?? "";
}
