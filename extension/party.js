// The Puffer Party panel. It appears during a round in hosted rooms and never submits for you.
(() => {
  const { createRoom, applyMessage, observedAnswers, isActive, remaining, used, addFresh } = globalThis.KrillionParty;
  const VISIBLE = 6;
  const RETRY_MS = 10000;
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
  // The room uses answers up, so the list keeps being topped up during a category.
  let fetchingMore = false;
  let exhausted = false; // Claude had nothing new for this category
  let retryAt = 0;

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
      const button = el("button", "kh-action", "Add Anthropic key");
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
      panel.append(el("p", "kh-hint", "Press its number to fill it. Enter passes the puffer."));
    } else if (!status && suggestions.length && !fetchingMore) {
      panel.append(renderOutOfAnswers());
    }
    if (fetchingMore) panel.append(el("p", "kh-hint", "Finding more answers…"));
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
    fetchingMore = false;
    exhausted = false;
    retryAt = 0;
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
    suggestions = addFresh(room, [], reply?.suggestions ?? []);
    if (reply?.note) {
      status = { text: reply.note, needsKey: reply.needsKey };
      retryAt = Date.now() + RETRY_MS;
    } else {
      exhausted = !suggestions.length;
      status = exhausted ? { text: "No answers found for this category." } : null;
    }
    render();
    topUp();
  }

  // When fewer than a screenful are left, asks for answers nobody has suggested or
  // said yet. A reply with nothing new means the category has run dry. A failed
  // request is tried again after a pause, since room messages keep calling this.
  async function topUp() {
    const category = requested;
    if (!category || !isActive(room) || fetchingMore || exhausted || status?.searching || status?.needsKey) return;
    if (Date.now() < retryAt || remaining(room, suggestions).length >= VISIBLE) return;
    fetchingMore = true;
    render();
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: "suggest", prompt: category, mode: "party", exclude: used(room, suggestions) });
    } catch {
      reply = { note: "Lost connection to the extension. Refresh this page." };
    }
    if (category !== requested) return;
    fetchingMore = false;
    if (reply?.note) {
      status = { text: reply.note, needsKey: reply.needsKey };
      retryAt = Date.now() + RETRY_MS;
    } else {
      const fresh = addFresh(room, suggestions, reply?.suggestions ?? []);
      suggestions = [...suggestions, ...fresh];
      exhausted = !fresh.length;
      status = null;
    }
    render();
    topUp();
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
    topUp();
  });

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
      const number = suggestionNumber(event, answerBox());
      const suggestion = number && remaining(room, suggestions).slice(0, VISIBLE)[number - 1];
      if (!suggestion) return;
      event.preventDefault();
      event.stopPropagation();
      fill(suggestion.name);
    },
    true,
  );
})();
