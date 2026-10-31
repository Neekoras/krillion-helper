// The Puffer Party panel. It appears during a round in hosted rooms and never submits for you.
(() => {
  const { createRoom, applyMessage, observedAnswers, isActive, remaining } = globalThis.KrillionParty;
  const VISIBLE = 6;
  const TIER_LABEL = {
    krillion: "One in a Krillion",
    deepcut: "Deep Cut",
    rare: "Rare",
    schooler: "Schooler",
    tooclever: "Too Clever",
    plankton: "Plankton",
  };

  const room = createRoom();
  let requested = null;
  let suggestions = [];
  let status = null; // { text, needsKey?, searching? }
  let collapsed = false;

  const panel = document.createElement("aside");
  panel.id = "krillion-helper";
  panel.dataset.party = "true";
  panel.setAttribute("aria-label", "Krillion Helper for Puffer Party");
  panel.hidden = true;
  document.documentElement.append(panel);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The box stays on the page all round, but its placeholder only says "your puffer" on your turn.
  const answerBox = () => document.querySelector('input[aria-label="Your answer"]');

  function fill(text) {
    const input = answerBox();
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function renderHeader() {
    const header = el("header", "kh-header");
    header.append(el("span", "kh-name", "Puffer Party"));
    const toggle = el("button", "kh-collapse", collapsed ? "+" : "–");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Show suggestions" : "Hide suggestions");
    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
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
    panel.hidden = !isActive(room);
    if (panel.hidden) return;
    panel.replaceChildren(renderHeader());
    panel.classList.toggle("kh-collapsed", collapsed);
    if (collapsed) return;

    if (status) panel.append(renderStatus());
    const left = remaining(room, suggestions);
    if (left.length) {
      const list = el("ol", "kh-list");
      left.slice(0, VISIBLE).forEach((s, i) => list.append(renderItem(s, i)));
      panel.append(list);
      panel.append(el("p", "kh-hint", "Alt + number fills it. Enter passes the puffer."));
    } else if (!status && suggestions.length) {
      panel.append(renderOutOfAnswers());
    }
    if (room.said.size) panel.append(el("p", "kh-hint", `${room.said.size} already tried this category.`));
  }

  function renderOutOfAnswers() {
    const box = el("div", "kh-status");
    box.append(el("span", "", "Out of suggestions. Try your own answer."));
    return box;
  }

  async function requestSuggestions(category) {
    requested = category;
    suggestions = [];
    status = { text: "Sounding for answers", searching: true };
    render();
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: "suggest", prompt: category, mode: "party" });
    } catch {
      if (category === requested) {
        status = { text: "Lost connection to the extension. Refresh this page." };
        render();
      }
      return;
    }
    if (category !== requested) return;
    suggestions = reply?.suggestions ?? [];
    if (reply?.note) status = { text: reply.note, needsKey: reply.needsKey };
    else status = suggestions.length ? null : { text: "No answers found for this category." };
    render();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "krillion-helper" || event.data.type !== "party") return;
    const before = { category: room.category, categoryIndex: room.categoryIndex };
    applyMessage(room, event.data.payload);
    const items = observedAnswers(before, room, event.data.payload);
    if (items.length) chrome.runtime.sendMessage({ type: "seen", items }).catch(() => {});
    if (!isActive(room)) {
      requested = null;
      suggestions = [];
      status = null;
    } else if (room.category !== requested) {
      requestSuggestions(room.category);
    }
    render();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || panel.hidden || collapsed) return;
      const match = /^Digit([1-9])$/.exec(event.code);
      const suggestion = match && remaining(room, suggestions).slice(0, VISIBLE)[Number(match[1]) - 1];
      if (!suggestion) return;
      event.preventDefault();
      event.stopPropagation();
      fill(suggestion.name);
    },
    true,
  );
})();
