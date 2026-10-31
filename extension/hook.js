// Runs in the page so it can see the game's own traffic. It only reads messages;
// it never sends requests or changes what the game receives.
(() => {
  const realFetch = window.fetch;
  const RealWebSocket = window.WebSocket;

  function post(type, payload) {
    window.postMessage({ source: "krillion-helper", type, payload }, location.origin);
  }

  async function inspect(url, init, response) {
    if (/\/submit(\?|$)/.test(url)) {
      const body = JSON.parse(init?.body ?? "{}");
      const { accepted, answer, tier, score, correction } = await response.clone().json();
      post("submit", { guess: body.answer, accepted, answer, tier, score, correction });
    } else if (/\/reveal(\?|$)/.test(url)) {
      const { rounds } = await response.clone().json();
      post("reveal", { rounds });
    }
  }

  window.fetch = async function (input, init) {
    const response = await realFetch.call(this, input, init);
    const url = String(input?.url ?? input);
    if (url.includes("/api/") && response.ok) {
      inspect(url, init, response).catch(() => {});
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
