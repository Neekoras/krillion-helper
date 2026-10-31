// Turns API failures into text that says what happened and what to do next.

export function describeError(err) {
  const message = String(err?.message ?? err);
  if (/\b401\b/.test(message)) return "OpenAI rejected your key. Check it in options.";
  if (/\b403\b/.test(message)) return "This key can't use GPT-6 Luna. Check its permissions in OpenAI.";
  if (/\b429\b/.test(message)) return "OpenAI says you're out of credit or going too fast.";
  if (/abort|timeout/i.test(message)) return "OpenAI took too long. Answer this one yourself.";
  if (/failed to fetch/i.test(message)) return "Can't reach OpenAI. Check your connection.";
  return "OpenAI returned an error. Answer this one yourself.";
}
