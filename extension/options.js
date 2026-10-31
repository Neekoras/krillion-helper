const openai = document.getElementById("openai");
const daily = document.getElementById("daily");
const show = document.getElementById("show");
const status = document.getElementById("status");

const stored = await chrome.storage.local.get(["openaiKey", "dailyEnabled"]);
openai.value = stored.openaiKey ?? "";
daily.checked = Boolean(stored.dailyEnabled);

show.addEventListener("click", () => {
  const hidden = openai.type === "password";
  openai.type = hidden ? "text" : "password";
  show.textContent = hidden ? "Hide" : "Show";
  show.setAttribute("aria-pressed", String(hidden));
});

// Changes save as they happen, so a key can't be lost by forgetting a button.
async function save() {
  await chrome.storage.local.set({ openaiKey: openai.value.trim(), dailyEnabled: daily.checked });
  status.textContent = openai.value.trim() ? "Saved. Refresh any open Krillion tab." : "Saved. Add a key to get suggestions.";
}

openai.addEventListener("input", save);
daily.addEventListener("change", save);
document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  save();
});
