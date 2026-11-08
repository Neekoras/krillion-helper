// Runs in the page so it can see the game's own traffic. It only reads messages;
// it never sends requests or changes what the game receives.
(() => {
  const realFetch = window.fetch;
  const RealWebSocket = window.WebSocket;

  // playdaily.org deals every prompt up front, then asks for answers by prompt id.
  const PLAYDAILY_TIERS = ["plankton", "tooclever", "schooler", "rare", "deepcut", "krillion"];
  const dealt = new Map();

  function post(type, payload) {
    window.postMessage({ source: "krillion-helper", type, payload }, location.origin);
  }

  async function inspect(url, init, response) {
    // krillion.io dives, playdaily.org dives and Krillocity races all grade one answer a call.
    if (/\/submit(\?|$)|\/api\/krillion\/(blitz\/)?answer(\?|$)/.test(url)) {
      const body = JSON.parse(init?.body ?? "{}");
      const { accepted, answer, tier, score, points, correction } = await response.clone().json();
      post("submit", { guess: body.answer, accepted, answer, tier, score: score ?? points, correction });
    } else if (/\/api\/krillion\/deal(\?|$)/.test(url)) {
      const { prompts } = await response.clone().json();
      for (const { id, text } of prompts ?? []) dealt.set(id, text);
    } else if (/\/api\/krillion\/answers\?/.test(url)) {
      const text = dealt.get(decodeURIComponent(/[?&]prompt=([^&]+)/.exec(url)?.[1] ?? ""));
      const { answers } = await response.clone().json();
      if (text && answers) {
        const named = answers.map(([tier, answer]) => ({ answer, tier: PLAYDAILY_TIERS[tier] }));
        post("reveal", { rounds: [{ text, answers: named }] });
      }
    } else if (/\/reveal(\?|$)/.test(url)) {
      // The Daily Dive calls these prompts; Unlimited and packs call them rounds.
      const { rounds, prompts } = await response.clone().json();
      post("reveal", { rounds: rounds ?? prompts ?? [] });
    }
  }

  // Every mode loads all of a dive's prompts up front, so suggestions can start early.
  // Reveals also list prompts, but with their answers attached.
  async function announcePrompts(response) {
    const { prompts } = await response.clone().json();
    if (Array.isArray(prompts) && prompts.length && prompts.every((p) => typeof p?.text === "string" && !p.answers)) {
      post("prompts", { prompts: prompts.map((p) => p.text) });
    }
  }

  window.fetch = async function (input, init) {
    const response = await realFetch.call(this, input, init);
    const url = String(input?.url ?? input);
    if (url.includes("/api/") && response.ok) {
      inspect(url, init, response).catch(() => {});
      announcePrompts(response).catch(() => {});
    }
    return response;
  };

  // Puffer Party room updates arrive over a WebSocket. Chat is left out.
  function inspectRoomMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.t !== "snap" && message.t !== "patch") return;
    const { chat, ...room } = message.room ?? {};
    const { chat: patchChat, ...patch } = message.patch ?? {};
    post("party", message.t === "snap" ? { t: "snap", room } : { t: "patch", patch });
  }

  window.WebSocket = class extends RealWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (/\/rooms\/[^/]+\/ws/.test(String(url))) this.addEventListener("message", inspectRoomMessage);
    }
  };
})();
