// admin-js/screenUI.js

export function showScreen(id){
  const screens = [
    "screen-auth", "screen-users", "screen-gates",
    "screen-schedules", "screen-events"
  ];

  screens.forEach(s => {
    const el = document.getElementById(s);
    if(el) el.style.display = (s === id ? "block" : "none");
  });

  document.querySelectorAll(".navbtn").forEach(b => {
    b.classList.toggle("active", b.dataset.screen === id);
  });
}
