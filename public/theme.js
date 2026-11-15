// Light, dark or automatic theme. The choice is kept for this browser tab only (sessionStorage).
const THEME_STORAGE_KEY = "chrubg-theme";
const THEME_ORDER = ["system", "light", "dark"];
const THEME_LABELS = { system: "Auto", light: "Light", dark: "Dark" };

function readSavedTheme() {
  try {
    const savedTheme = sessionStorage.getItem(THEME_STORAGE_KEY);
    return THEME_ORDER.includes(savedTheme) ? savedTheme : "system";
  } catch (ignoredStorageError) {
    return "system";
  }
}

function saveTheme(theme) {
  try {
    sessionStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (ignoredStorageError) {}
}

let currentTheme = readSavedTheme();

function applyTheme() {
  if (currentTheme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = currentTheme;

  const toggleButton = document.getElementById("theme-toggle");
  if (toggleButton) toggleButton.textContent = `Theme: ${THEME_LABELS[currentTheme]}`;
}

applyTheme(); // runs before the page paints, so there is no flash of the wrong theme

document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  document.getElementById("theme-toggle").addEventListener("click", () => {
    currentTheme = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme) + 1) % THEME_ORDER.length];
    saveTheme(currentTheme);
    applyTheme();
  });
});
