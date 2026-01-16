// admin-js/navUI.js

export function initNavUI() {
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.screen;
      showScreen(id);
      history.replaceState(null, "", "#" + id);
    });
  });

  // On hash change, show screen
  window.addEventListener("popstate", () => {
    const hash = location.hash.replace("#", "");
    if (hash) showScreen(hash);
  });
}
