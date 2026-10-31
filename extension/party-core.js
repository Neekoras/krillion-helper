// Tracks a Puffer Party room from the messages the game already receives.
// Runs in hosted rooms, public or private. Rated and Quick Play games stay off.
(() => {
  function normalizeAnswer(text) {
    return String(text)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function createRoom() {
    return { isPrivate: false, rated: false, queue: null, phase: null, category: null, categoryIndex: null, holderId: null, said: new Set() };
  }

  function setCategory(room, category) {
    if (!category) {
      room.category = null;
      room.categoryIndex = null;
      room.said = new Set();
      return;
    }
    if (category.index !== room.categoryIndex) room.said = new Set();
    room.category = category.text;
    room.categoryIndex = category.index;
  }

  function applyFields(room, fields) {
    if (fields.settings) room.isPrivate = fields.settings.isPrivate === true;
    if ("rated" in fields) room.rated = Boolean(fields.rated);
    if ("queue" in fields) room.queue = fields.queue;
    if ("phase" in fields) room.phase = fields.phase;
    if ("holderId" in fields) room.holderId = fields.holderId;
    if ("category" in fields) setCategory(room, fields.category);
  }

  // Both accepted answers and misses come off the list, whoever said them.
  function applyEvents(room, events = []) {
    for (const event of events) {
      if (event.kind === "category" && event.why === "start") room.said = new Set();
      if (event.kind === "pass" && event.answer) room.said.add(normalizeAnswer(event.answer));
      if (event.kind === "reject" && event.text) room.said.add(normalizeAnswer(event.text));
    }
  }

  function applyPlayers(room, players = []) {
    for (const player of players) {
      if (room.category && player.lastAnswer?.text) room.said.add(normalizeAnswer(player.lastAnswer.text));
    }
  }

  function applyMessage(room, message) {
    if (message.t === "snap" && message.room) {
      Object.assign(room, createRoom());
      applyFields(room, message.room);
      applyEvents(room, message.room.events);
      applyPlayers(room, message.room.players);
    } else if (message.t === "patch" && message.patch) {
      applyFields(room, message.patch);
      if (message.patch.set) applyFields(room, message.patch.set);
      applyEvents(room, message.patch.events);
      applyPlayers(room, message.patch.players);
    }
    return room;
  }

  function isActive(room) {
    return !room.rated && !room.queue && room.phase === "round" && Boolean(room.category);
  }

  function remaining(room, suggestions) {
    return suggestions.filter((s) => !room.said.has(normalizeAnswer(s.name)));
  }

  globalThis.KrillionParty = { normalizeAnswer, createRoom, applyMessage, isActive, remaining };
})();
