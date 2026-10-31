import { diveDepth, summarize } from "./lib/book.js";

// Listed from the surface down. Too Clever sits where its 15 points would land.
const BANDS = [
  { tier: "plankton", name: "Plankton", points: 10, background: "#8fd0ee", color: "#050a14" },
  { tier: "tooclever", name: "Too Clever", points: 15, background: "#62abd4", color: "#050a14" },
  { tier: "schooler", name: "Schooler", points: 30, background: "#2f78a8", color: "#ffffff" },
  { tier: "rare", name: "Rare", points: 60, background: "#1d4f7a", color: "#e8f1ff" },
  { tier: "deepcut", name: "Deep Cut", points: 85, background: "#122c4a", color: "#e8f1ff" },
  { tier: "krillion", name: "One in a Krillion", points: 100, background: "#070f1e", color: "#e8f1ff" },
];
const PIXELS_PER_METER = 0.05;
const meters = (n) => `${n.toLocaleString("en-US")}m`;

const stored = await chrome.storage.local.get(["openaiKey", "dailyEnabled", "results", "book"]);
const stats = summarize(stored.results ?? []);

const paceEl = document.getElementById("pace");
const paceLabel = document.getElementById("pace-label");
if (stats.answers) {
  paceEl.textContent = meters(stats.paceDepth);
  const noun = stats.answers === 1 ? "answer" : "answers";
  paceLabel.textContent = `dive pace from ${stats.answers} ${noun}, ${stats.averagePoints} pts each`;
} else {
  paceEl.textContent = "0m";
  paceLabel.textContent = "Play a dive to set your pace.";
}

const column = document.getElementById("column");
let previousDepth = 0;
for (const band of BANDS) {
  const depth = diveDepth(band.points);
  const row = document.createElement("div");
  row.className = "band";
  row.dataset.tier = band.tier;
  row.style.height = `${(depth - previousDepth) * PIXELS_PER_METER}px`;
  row.style.background = band.background;
  row.style.color = band.color;
  previousDepth = depth;

  const name = document.createElement("span");
  name.className = "band-name";
  name.textContent = band.name;
  const mark = document.createElement("span");
  mark.className = "band-depth";
  mark.textContent = meters(depth);
  const count = document.createElement("span");
  count.className = "band-count";
  count.textContent = stats.tiers[band.tier] ?? 0;
  row.append(name, mark, count);
  column.append(row);
}
if (stats.answers) {
  const marker = document.createElement("div");
  marker.className = "marker";
  marker.style.top = `${stats.paceDepth * PIXELS_PER_METER}px`;
  const label = document.createElement("span");
  label.textContent = "You";
  marker.append(label);
  column.append(marker);
}
column.setAttribute(
  "aria-label",
  BANDS.map((b) => `${b.name}: ${stats.tiers[b.tier] ?? 0}`).join(", "),
);

document.getElementById("key-warning").hidden = Boolean(stored.openaiKey);
document.getElementById("add-key").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

const daily = document.getElementById("daily");
daily.checked = Boolean(stored.dailyEnabled);
daily.addEventListener("change", () => chrome.storage.local.set({ dailyEnabled: daily.checked }));

const prompts = Object.keys(stored.book ?? {}).length;
document.getElementById("book").textContent = `Answer book: ${prompts} ${prompts === 1 ? "prompt" : "prompts"}`;
