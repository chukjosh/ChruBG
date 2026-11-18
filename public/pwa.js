// Installing the app, offline support and the offline notice.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

const installButton = document.getElementById("install-button");
const offlineBanner = document.getElementById("offline-banner");
let installPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  if (installButton) installButton.hidden = false;
});

if (installButton) {
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });
}
window.addEventListener("appinstalled", () => installButton && (installButton.hidden = true));

function showConnectionState() {
  if (offlineBanner) offlineBanner.hidden = navigator.onLine;
}
window.addEventListener("online", showConnectionState);
window.addEventListener("offline", showConnectionState);
showConnectionState();
