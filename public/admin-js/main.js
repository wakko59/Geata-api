// admin-js/main.js

import { initNavUI } from "./navUI.js";
import { initAuthUI } from "./authUI.js";
import { initUsersUI, loadUsers } from "./usersUI.js";
import { initGatesUI, loadDevices } from "./gatesUI.js";
import { initSchedulesUI, loadSchedules } from "./schedulesUI.js";
import { initEventsUI } from "./eventsUI.js";
import { initAlertsUI } from "./alertsUI.js";
import { showScreen } from "./screenUI.js";  // we'll define this next
import { apiJson } from "./api.js";

import { renderEventCheckboxPanel } from "./helpers.js";

// Expose global constants for modules that depend on them
window.ALERT_EVENT_TYPES = [
  "OPEN_REQUESTED","CMD_COMPLETED","GATE_OPENED","GATE_CLOSED",
  "GATE_FORCED_OPEN","DOOR_FORCED_OPEN","GATE_OPEN_TOO_LONG",
  "TAMPER_OPENED","ACCESS_DENIED_NOT_ASSIGNED","ACCESS_DENIED_SCHEDULE",
  "AUX1_REQUESTED","AUX2_REQUESTED","AUX1_DENIED_NOT_ASSIGNED",
  "AUX1_DENIED_SCHEDULE","AUX2_DENIED_NOT_ASSIGNED","AUX2_DENIED_SCHEDULE"
];

// Called on page load
async function appInit(){
  // Initialize nav and UI modules
  initNavUI();
  initAuthUI();
  initUsersUI();
  initGatesUI();
  initSchedulesUI();
  initEventsUI();
  initAlertsUI();

  // Show the auth screen by default
  showScreen("screen-auth");

  // Load build info if present
  try {
    const info = await apiJson("/__build");
    document.getElementById("buildInfo").textContent =
      `Build: ${info.buildTag} · Node: ${info.node} · Time: ${info.time}`;
  } catch (e) {
    // Ignore if not available
  }

  // If the admin API key is already saved, auto-load data
  const savedKey = localStorage.getItem("geata_admin_api_key");
  if (savedKey) {
    try {
      await loadDevices();
      await loadUsers(null);
      await loadSchedules();

      // Pre-fill dropdowns in various screens
      renderEventCheckboxPanel(
        document.getElementById("usersEmailPanel"),
        window.ALERT_EVENT_TYPES
      );

    } catch (e) {
      console.warn("Initial load failed:", e);
    }
  }
}

// Kick things off once DOM is ready
window.addEventListener("DOMContentLoaded", appInit);
