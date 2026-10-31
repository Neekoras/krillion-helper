// Runs in the page so it can see the game's own API responses. It only reads
// them; it never sends requests or changes what the game receives.
(() => {
  const realFetch = window.fetch;

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
})();
