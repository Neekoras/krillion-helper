// Turns API failures into text that says what happened and what to do next.
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "../vendor/anthropic-sdk.js";

export function describeError(err) {
  if (err instanceof AuthenticationError) return "Anthropic rejected your key. Check it in options.";
  if (err instanceof PermissionDeniedError) return "This key can't use Claude. Check its permissions in the Claude Console.";
  if (err instanceof RateLimitError) return "Anthropic says you're going too fast. Wait a moment.";
  if (err instanceof APIConnectionTimeoutError) return "Claude took too long. Answer this one yourself.";
  if (err instanceof APIConnectionError) return "Can't reach Anthropic. Check your connection.";
  return "Claude returned an error. Answer this one yourself.";
}
