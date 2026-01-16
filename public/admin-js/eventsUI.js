// admin-js/eventsUI.js

import { $, setStatus, renderEventCheckboxPanel } from "./helpers.js";
import { apiJson, getApiKey, requireAuthHeaders } from "./api.js";

// Builds query params from events filters
function buildEventsQueryParams() {
  const params = new URLSearchParams();

  const deviceId = $("eventsDeviceFilterSelect")?.value || "";
  const userId = $("eventsUserFilterSelect")?.value || "";

  const fromDate = $("eventsFromDate")?.value || "";
  const toDate   = $("eventsToDate")?.value || "";

  const limitVal = parseInt($("eventsLimitInput")?.value || "500", 10);
  const limit = Math.max(1, Math.min(5000, limitVal));

  if (deviceId) params.set("deviceId", deviceId);
  if (userId)   params.set("userId", userId);

  if (fromDate) params.set("from", fromDate + "T00:00:00");
  if (toDate)   params.set("to",   toDate   + "T23:59:59");

  params.set("limit", String(limit));
  return params.toString();
}

// Load events into the table
export async function eventsLoadTable() {
  const tbody = document.querySelector("#eventsTable tbody");
  if (tbody) tbody.innerHTML = "";
  setStatus($("eventsStatus"), "Loading events…", false);

  try {
    const qs  = buildEventsQueryParams();
    const rows = await apiJson("/events?" + qs);

    (rows || []).forEach(ev => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${ev.at || ""}</td>
        <td>${ev.device_id || ""}</td>
        <td>${ev.user_id || ""}</td>
        <td>${ev.event_type || ""}</td>
        <td>${ev.details || ""}</td>
      `;
      tbody.appendChild(tr);
    });

    setStatus($("eventsStatus"), `Loaded ${rows?.length || 0} events`, false);
  } catch (e) {
    setStatus($("eventsStatus"), "Events load error: " + e.message, true);
  }
}

// Downloads reports with auth
function downloadWithAuth(url, filename) {
  fetch(url, { headers: requireAuthHeaders() })
    .then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.blob();
    })
    .then(blob => {
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    })
    .catch(e => setStatus($("eventsStatus"), "Download error: " + e.message, true));
}

export function eventsDownloadCsv() {
  const qs = buildEventsQueryParams();
  downloadWithAuth(`/events/export.csv?${qs}`, "events-report.csv");
}

export function eventsDownloadXlsx() {
  const qs = buildEventsQueryParams();
  downloadWithAuth(`/events/export.xlsx?${qs}`, "events-report.xlsx");
}

export async function eventsEmailReport() {
  const statusEl = $("eventsStatus");
  const emailTo = ($("eventsEmailTo")?.value || "").trim();
  if (!emailTo) return setStatus(statusEl, "Enter email address", true);

  const params = new URLSearchParams(buildEventsQueryParams());

  // Prepare body for email report
  const payload = {
    to: emailTo,
    deviceId: $("eventsDeviceFilterSelect")?.value || null,
    userId: $("eventsUserFilterSelect")?.value || null,
    from: $("eventsFromDate")?.value || null,
    toDate: $("eventsToDate")?.value || null,
  };

  setStatus(statusEl, "Sending report…", false);
  try {
    await apiJson("/events/email", { method: "POST", body: payload });
    setStatus(statusEl, "Email queued/sent", false);
  } catch (e) {
    setStatus(statusEl, "Email error: " + e.message, true);
  }
}

// Initialize event UI — wiring buttons
export function initEventsUI() {
  $("eventsLoadBtn")?.addEventListener("click", eventsLoadTable);

  $("eventsDownloadCsvBtn")?.addEventListener("click", eventsDownloadCsv);
  $("eventsDownloadXlsxBtn")?.addEventListener("click", eventsDownloadXlsx);

  $("eventsEmailBtn")?.addEventListener("click", eventsEmailReport);
}
