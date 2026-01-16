// admin-js/alertsUI.js

import { $, setStatus, renderEventCheckboxPanel, setPanelChecked, getPanelChecked } from "./helpers.js";
import { apiJson } from "./api.js";

// Local state for alert panel
let gateAlertsDeviceId = null;
let gateAlertsUserId = null;

// Show/hide the alerts panel
export function showGateAlertsPanel(show) {
  const el = $("gateAlertsPanel");
  if (!el) return;
  el.style.display = show ? "block" : "none";
}

// Open the panel: load current settings
export async function openGateAlerts(deviceId, userId, userLabel) {
  gateAlertsDeviceId = deviceId;
  gateAlertsUserId = userId;

  $("gateAlertsMeta").textContent = `Gate: ${deviceId} · User: ${userLabel} [${userId}]`;

  // Render checkboxes
  renderEventCheckboxPanel($("gateAlertsTypesPanel"), window.ALERT_EVENT_TYPES);

  setStatus($("gateAlertsStatus"), "Loading…", false);

  try {
    const data = await apiJson(`/devices/${encodeURIComponent(deviceId)}/alert-subs?userId=${encodeURIComponent(userId)}`);
    const enabled = data?.enabledEventTypes || [];
    setPanelChecked($("gateAlertsTypesPanel"), enabled);

    setStatus($("gateAlertsStatus"), "", false);
    showGateAlertsPanel(true);

  } catch (e) {
    setStatus($("gateAlertsStatus"), "Load failed: " + e.message, true);
    showGateAlertsPanel(true);
  }
}

// Save in‑panel alert subscriptions
export async function saveGateAlerts() {
  const deviceId = gateAlertsDeviceId;
  const userId = gateAlertsUserId;
  if (!deviceId || !userId) return;

  const enabledEventTypes = getPanelChecked($("gateAlertsTypesPanel"));
  setStatus($("gateAlertsStatus"), "Saving…", false);

  try {
    await apiJson(`/devices/${encodeURIComponent(deviceId)}/alert-subs`, {
      method: "PUT",
      body: { userId, enabledEventTypes }
    });
    setStatus($("gateAlertsStatus"), "Saved", false);
  } catch (e) {
    setStatus($("gateAlertsStatus"), "Save error: " + e.message, true);
  }
}

// Initialize alert UI (wire buttons + hide panel)
export function initAlertsUI() {
  $("gateAlertsSaveBtn")?.addEventListener("click", saveGateAlerts);
  $("gateAlertsCancelBtn")?.addEventListener("click", () => showGateAlertsPanel(false));
  showGateAlertsPanel(false);
}
