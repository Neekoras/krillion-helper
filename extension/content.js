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
  let upcoming = [];

  const panel = document.createElement("aside");
  panel.id = "krillion-helper";
  panel.setAttribute("aria-label", "Krillion Helper");
  panel.hidden = true;
  document.documentElement.append(panel);

  const PLAYDAILY = location.hostname === "playdaily.org";
  const isDaily = () => !PLAYDAILY && location.pathname === "/";
  // Krillocity is playdaily.org's rapid-fire race: every accepted answer counts, so a
  // used suggestion leaves the list whether or not it was accepted.
  const inRace = () => PLAYDAILY && /^\/krillocity\/?$/.test(location.pathname);

  // playdaily.org has other games, and its 1 vs 1 and multiplayer play real people.
  // In Krillocity only the solo daily race counts; open races have other racers' lanes.
  function inDive() {
    if (!PLAYDAILY) return document.querySelector(".ds-score-pod") && !document.querySelector(".ds-begin-btn");
    if (inRace()) return document.querySelector(".kb-stage .kr-prompt") && document.querySelectorAll(".kb-race-tag").length <= 1;
    if (!/^\/krillion\/?$/.test(location.pathname)) return false;
    return document.querySelector(".kr-stage .kr-prompt") && !document.querySelector(".kr-stage-multi, .kd-stage");
  }

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
      const button = el("button", "kh-action", "Add Anthropic key");
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
      panel.append(el("p", "kh-hint", `${rejected}${more}Press its number to fill it. Enter ${inRace() ? "swims" : "dives"}.`));
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
    const input = document.querySelector(PLAYDAILY ? ".kr-input" : ".ds-input");
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
    const asked = chrome.runtime.sendMessage({ type: "suggest", prompt });
    // The first prompt of a dive starts suggestions for the rest of it, after its own.
    if (upcoming.length) {
      const rest = upcoming.filter((p) => p.trim() !== prompt);
      upcoming = [];
      chrome.runtime.sendMessage({ type: "prefetch", prompts: rest }).catch(() => {});
    }
    let reply;
    try {
      reply = await asked;
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
    if (!inDive() || location.pathname.startsWith("/party")) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    if (isDaily() && !dailyEnabled) return;
    const prompt = document.querySelector(PLAYDAILY ? ".kr-prompt" : ".ds-card .prompt")?.textContent.trim();
    if (prompt && prompt !== currentPrompt) onPrompt(prompt);
  }

  // A number key picks a suggestion, unless you're typing: in the answer box once it
  // has text, so answers like "Cars 2" still work, or in any other field.
  function suggestionNumber(event, box) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
    const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
    if (!match) return null;
    const target = event.target;
    const field = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (field && (target !== box || box.value)) return null;
    return Number(match[1]);
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (panel.hidden || collapsed) return;
      const number = suggestionNumber(event, document.querySelector(PLAYDAILY ? ".kr-input" : ".ds-input"));
      const suggestion = number && suggestions.slice(0, VISIBLE)[number - 1];
      if (!suggestion) return;
      event.preventDefault();
      event.stopPropagation();
      fill(suggestion.name);
    },
    true,
  );

  function rememberSeen(name, tier) {
    if (currentPrompt) chrome.runtime.sendMessage({ type: "seen", items: [{ prompt: currentPrompt, name, tier }] });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "krillion-helper") return;
    const { type, payload } = event.data;
    if (type === "prompts") {
      upcoming = payload.prompts;
    } else if (type === "reveal") {
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
        rememberSeen(payload.answer, payload.tier);
      } else if (!payload.correction) {
        rememberSeen(payload.guess, null);
      }
      // A rejected answer leaves the list. In a race an accepted one does too, since
      // the next answer is wanted straight away.
      if (!payload.correction && (!payload.accepted || inRace())) {
        const used = [payload.guess, payload.answer].filter(Boolean).map((a) => String(a).trim().toLowerCase());
        const remaining = suggestions.filter((s) => !used.includes(s.name.toLowerCase()));
        if (remaining.length < suggestions.length) {
          suggestions = remaining;
          if (!payload.accepted) rejectedCount++;
          if (!suggestions.length) status = { text: "Out of suggestions. Try your own answer." };
        }
      }
      render();
    }
  });

  setInterval(poll, 250);
})();
