// Draws the suggestion panel and relays game events to the background worker.
// It fills the answer box when you pick a suggestion but never submits for you.
(() => {
  const TIER_LABEL = {
    krillion: "One in a Krillion",
    deepcut: "Deep Cut",
    rare: "Rare",
    schooler: "Schooler",
    tooclever: "Too Clever",
    plankton: "Plankton",
  };

  // The panel shows the best few. A rejected answer leaves and the next one moves up.
  const VISIBLE = 6;

  let currentPrompt = null;
  let suggestions = [];
  let status = null; // { text, needsKey?, searching? }
  let dailyEnabled = false;
  let collapsed = false;
  let lastResult = null;
  let rejectedCount = 0;

  const panel = document.createElement("aside");
  panel.id = "krillion-helper";
  panel.setAttribute("aria-label", "Krillion Helper");
  panel.hidden = true;
  document.documentElement.append(panel);

  const isDaily = () => location.pathname === "/";

  chrome.storage.local.get(["dailyEnabled", "panelCollapsed"]).then((s) => {
    dailyEnabled = Boolean(s.dailyEnabled);
    collapsed = Boolean(s.panelCollapsed);
    render();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.dailyEnabled) {
      dailyEnabled = Boolean(changes.dailyEnabled.newValue);
      render();
    }
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderHeader() {
    const header = el("header", "kh-header");
    header.append(el("span", "kh-name", "Krillion Helper"));
    const toggle = el("button", "kh-collapse", collapsed ? "+" : "–");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Show suggestions" : "Hide suggestions");
    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      chrome.storage.local.set({ panelCollapsed: collapsed });
      render();
    });
    header.append(toggle);
    return header;
  }

  function renderStatus() {
    const box = el("div", "kh-status");
    if (status.searching) box.classList.add("kh-searching");
    box.setAttribute("role", "status");
    box.append(el("span", "", status.text));
    if (status.needsKey) {
      const button = el("button", "kh-action", "Add OpenAI key");
      button.type = "button";
      button.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));
      box.append(button);
    }
    return box;
  }

  function renderDailyOff() {
    const box = el("div", "kh-status");
    box.append(el("span", "", "Suggestions are off for the Daily Dive."));
    const button = el("button", "kh-action", "Turn on for Daily Dive");
    button.type = "button";
    button.addEventListener("click", () => chrome.storage.local.set({ dailyEnabled: true }));
    box.append(button);
    return box;
  }

  function renderItem(s, index) {
    const item = el("li");
    const button = el("button", "kh-item");
    button.type = "button";
    if (s.tier) button.dataset.tier = s.tier;
    button.append(el("kbd", "kh-key", String(index + 1)));
    const text = el("span", "kh-text");
    text.append(el("span", "kh-answer", s.name));
    if (s.tier) text.append(el("span", "kh-tag", TIER_LABEL[s.tier] ?? s.tier));
    button.append(text);
    button.addEventListener("click", () => fill(s.name));
    item.append(button);
    return item;
  }

  function render() {
    panel.replaceChildren(renderHeader());
    panel.classList.toggle("kh-collapsed", collapsed);
    if (collapsed) return;

    if (isDaily() && !dailyEnabled) {
      panel.append(renderDailyOff());
      return;
    }
    if (status) panel.append(renderStatus());
    if (suggestions.length) {
      const list = el("ol", "kh-list");
      suggestions.slice(0, VISIBLE).forEach((s, i) => list.append(renderItem(s, i)));
      panel.append(list);
      const left = suggestions.length - Math.min(suggestions.length, VISIBLE);
      const rejected = rejectedCount ? `${rejectedCount} not accepted. ` : "";
      const more = left ? `${left} more ready. ` : "";
      panel.append(el("p", "kh-hint", `${rejected}${more}Alt + number fills it. Enter dives.`));
    }
    if (lastResult) {
      const result = el("p", "kh-result");
      result.dataset.tier = lastResult.tier;
      result.append(el("span", "kh-result-answer", lastResult.answer));
      result.append(el("span", "kh-result-score", `${TIER_LABEL[lastResult.tier] ?? lastResult.tier} +${lastResult.score}`));
      panel.append(result);
    }
  }

  function fill(text) {
    const input = document.querySelector(".ds-input");
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  async function onPrompt(prompt) {
    currentPrompt = prompt;
    suggestions = [];
    lastResult = null;
    rejectedCount = 0;
    status = { text: "Sounding for answers", searching: true };
    render();
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: "suggest", prompt });
    } catch {
      // Reloading the extension disconnects tabs that were already open.
      status = { text: "Lost connection to the extension. Refresh this page." };
      render();
      return;
    }
    if (prompt !== currentPrompt) return;
    if (!reply) {
      status = { text: "No reply from the extension. Refresh this page." };
      render();
      return;
    }
    suggestions = reply.suggestions ?? [];
    if (reply.note) status = { text: reply.note, needsKey: reply.needsKey };
    else status = suggestions.length ? null : { text: "No answers found for this prompt." };
    render();
  }

  function poll() {
    const inDive = document.querySelector(".ds-score-pod") && !document.querySelector(".ds-begin-btn");
    if (!inDive || location.pathname.startsWith("/party")) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    if (isDaily() && !dailyEnabled) return;
    const prompt = document.querySelector(".ds-card .prompt")?.textContent.trim();
    if (prompt && prompt !== currentPrompt) onPrompt(prompt);
  }

  // e.code stays Digit1 on a Mac, where Alt+1 would otherwise type a symbol.
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || panel.hidden || collapsed) return;
      const match = /^Digit([1-9])$/.exec(event.code);
      const suggestion = match && suggestions.slice(0, VISIBLE)[Number(match[1]) - 1];
      if (!suggestion) return;
      event.preventDefault();
      event.stopPropagation();
      fill(suggestion.name);
    },
    true,
  );

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "krillion-helper") return;
    const { type, payload } = event.data;
    if (type === "reveal") {
      chrome.runtime.sendMessage({ type: "reveal", rounds: payload.rounds });
    } else if (type === "submit") {
      if (payload.accepted) {
        lastResult = { answer: payload.answer, tier: payload.tier, score: payload.score };
        chrome.runtime.sendMessage({
          type: "result",
          prompt: currentPrompt,
          answer: payload.answer,
          tier: payload.tier,
          score: payload.score,
          fromHelper: suggestions.some((s) => s.name === payload.answer || s.name === payload.guess),
        });
      } else if (!payload.correction) {
        const guess = String(payload.guess).trim().toLowerCase();
        const remaining = suggestions.filter((s) => s.name.toLowerCase() !== guess);
        if (remaining.length < suggestions.length) {
          suggestions = remaining;
          rejectedCount++;
          if (!suggestions.length) status = { text: "Out of suggestions. Try your own answer." };
        }
      }
      render();
    }
  });

  setInterval(poll, 250);
})();
