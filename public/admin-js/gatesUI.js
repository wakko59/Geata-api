// admin-js/gatesUI.js

import { $, setStatus } from "./helpers.js";
import { apiJson } from "./api.js";
import { fillUserSelect, loadUsers } from "./usersUI.js";
import { openGateAlerts } from "./alertsUI.js";

let allDevices = [];
let allUsers = [];

// =========================
// Load Devices
// =========================
export async function loadDevices() {
  const data = await apiJson("/devices");
  allDevices = Array.isArray(data) ? data : [];

  const sel = $("gatesSelect");
  if (sel) {
    sel.innerHTML = `<option value="">-- Select a gate --</option>`;
    allDevices.forEach((d) => {
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = d.name ? `${d.id} – ${d.name}` : d.id;
      sel.appendChild(o);
    });
  }
}

// =========================
// Gate Users Screen
// =========================
export async function loadGateUsers(gateId) {
  const tbody = $("#gatesUsersTable")?.querySelector("tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  setStatus($("gatesUsersStatus"), "Loading users…", false);

  try {
    const list = await apiJson(`/devices/${encodeURIComponent(gateId)}/users`);
    list.forEach((u) => {
      const tr = document.createElement("tr");

      // Schedule selector
      const scheduleSelect = document.createElement("select");
      scheduleSelect.innerHTML = `<option value="">24/7 (no schedule)</option>`;
      allSchedules.forEach((s) => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name;
        scheduleSelect.appendChild(o);
      });

      if (u.scheduleId) scheduleSelect.value = u.scheduleId;

      const btnSaveSched = document.createElement("button");
      btnSaveSched.textContent = "Save";
      btnSaveSched.className = "btn-small";
      btnSaveSched.addEventListener("click", async () => {
        try {
          await apiJson(
            `/devices/${encodeURIComponent(gateId)}/users/${encodeURIComponent(
              u.userId
            )}/schedule-assignment`,
            {
              method: "PUT",
              body: { scheduleId: scheduleSelect.value || null },
            }
          );
          setStatus($("gatesUsersStatus"), "Saved schedule", false);
        } catch (e) {
          setStatus($("gatesUsersStatus"), "Schedule save error: " + e.message, true);
        }
      });

      // Remove user from gate
      const btnRemove = document.createElement("button");
      btnRemove.textContent = "Remove";
      btnRemove.className = "btn-danger btn-small";
      btnRemove.addEventListener("click", async () => {
        if (!confirm(`Remove user ${u.userId} from gate ${gateId}?`)) return;
        try {
          await apiJson(
            `/devices/${encodeURIComponent(gateId)}/users/${encodeURIComponent(u.userId)}`,
            { method: "DELETE" }
          );
          await loadGateUsers(gateId);
          setStatus($("gatesUsersStatus"), "Removed user", false);
        } catch (e) {
          setStatus($("gatesUsersStatus"), "Remove error: " + e.message, true);
        }
      });

      // Alerts button
      const btnAlerts = document.createElement("button");
      btnAlerts.textContent = "Alerts";
      btnAlerts.className = "btn-small";
      btnAlerts.addEventListener("click", () => {
        openGateAlerts(gateId, u.userId, u.name);
      });

      tr.innerHTML = `
        <td>${u.userId}</td>
        <td>${u.name || ""}</td>
        <td>${u.email || ""}</td>
        <td>${u.phone || ""}</td>
        <td>${u.role || ""}</td>
      `;
      const tdSched = document.createElement("td");
      tdSched.append(scheduleSelect, btnSaveSched);

      const tdAlerts = document.createElement("td");
      tdAlerts.appendChild(btnAlerts);

      const tdRemoveUser = document.createElement("td");
      tdRemoveUser.appendChild(btnRemove);

      tr.appendChild(tdSched);
      tr.appendChild(tdAlerts);
      tr.appendChild(tdRemoveUser);

      tbody.appendChild(tr);
    });

    setStatus($("gatesUsersStatus"), `Loaded ${list.length} gate users`, false);
  } catch (e) {
    setStatus($("gatesUsersStatus"), "Users load error: " + e.message, true);
  }
}

// =========================
// Load Gate Settings
// =========================
export async function loadGateSettings(gateId) {
  if (!gateId) return;
  setStatus($("gatesSettingsStatus"), "Loading settings…", false);

  try {
    const settings = await apiJson(`/devices/${encodeURIComponent(gateId)}/settings`);
    $("gatesSaveSettingsBtn").disabled = false;
    setStatus($("gatesSettingsStatus"), "Loaded settings", false);
  } catch (e) {
    setStatus($("gatesSettingsStatus"), "Settings load error: " + e.message, true);
  }
}

export async function saveGateSettings(gateId) {
  if (!gateId) return;
  setStatus($("gatesSettingsStatus"), "Saving…", false);

  try {
    await apiJson(`/devices/${encodeURIComponent(gateId)}/settings`, {
      method: "PUT",
      body: { aux1Mode: getAux1ModePickedGate() },
    });
    setStatus($("gatesSettingsStatus"), "Saved settings", false);
  } catch (e) {
    setStatus($("gatesSettingsStatus"), "Save error: " + e.message, true);
  }
}

function getAux1ModePickedGate() {
  const picked = document.querySelector('input[name="aux1ModeGate"]:checked');
  return picked ? picked.value : "relay";
}

// =========================
// I/O and Sim
// =========================
async function ioPulse(gateId, path, durationMs, statusEl) {
  if (!gateId) return setStatus(statusEl, "Select a gate first", true);
  try {
    await apiJson(`/devices/${encodeURIComponent(gateId)}/${path}`, {
      method: "POST",
      body: { durationMs },
    });
    setStatus(statusEl, `Triggered ${path}`, false);
  } catch (e) {
    setStatus(statusEl, `I/O error: ${e.message}`, true);
  }
}

export function initGatesUI() {
  $("gatesLoadBtn")?.addEventListener("click", async () => {
    const gateId = $("gatesSelect").value || "";
    if (!gateId) {
      setStatus($("gatesStatus"), "Select a gate", true);
      return;
    }
    // Load gate details
    await loadGateUsers(gateId);
    await loadGateSettings(gateId);
  });

  $("gatesSaveSettingsBtn")?.addEventListener("click", () => {
    const gateId = $("gatesSelect").value || "";
    saveGateSettings(gateId);
  });

  $("gatesAux1PulseBtn")?.addEventListener("click", () =>
    ioPulse($("gatesSelect").value, "aux1-test", 1000, $("gatesIoStatus"))
  );

  $("gatesAux2PulseBtn")?.addEventListener("click", () =>
    ioPulse($("gatesSelect").value, "aux2-test", 2000, $("gatesIoStatus"))
  );

  $("simGateOpenedBtn")?.addEventListener("click", () =>
    ioPulse($("gatesSelect").value, "simulate-event", { type: "GATE_OPENED" }, $("gatesSimStatus"))
  );

  $("simGateClosedBtn")?.addEventListener("click", () =>
    ioPulse($("gatesSelect").value, "simulate-event", { type: "GATE_CLOSED" }, $("gatesSimStatus"))
  );

  $("simForcedBtn")?.addEventListener("click", () =>
    ioPulse($("gatesSelect").value, "simulate-event", { type: "GATE_FORCED_OPEN" }, $("gatesSimStatus"))
  );

  $("simTamperBtn")?.addEventListener("click", () =>
    ioPulse($("gatesSelect").value, "simulate-event", { type: "TAMPER_OPENED" }, $("gatesSimStatus"))
  );

  // ===== Add User to Gate =====
  $("gatesAddUserBtn")?.addEventListener("click", async () => {
    // Ensure user list loaded
    if (!allUsers.length) {
      await loadUsers(null);
    }
    fillUserSelect($("gateAddUserSelect"), allUsers);

    $("gateAddUserPanel").style.display = "block";
  });

  $("gateAddUserCancelBtn")?.addEventListener("click", () => {
    $("gateAddUserPanel").style.display = "none";
  });

  $("gateAddUserConfirmBtn")?.addEventListener("click", async () => {
    const gateId = $("gatesSelect").value;
    const userId = $("gateAddUserSelect").value;
    const role = $("gateAddUserRole").value;

    try {
      await apiJson(`/devices/${encodeURIComponent(gateId)}/users`, {
        method: "POST",
        body: { userId, role },
      });

      setStatus($("gateAddUserStatus"), "User added", false);
      $("gateAddUserPanel").style.display = "none";
      await loadGateUsers(gateId);

    } catch (e) {
      setStatus($("gateAddUserStatus"), "Add user error: " + e.message, true);
    }
  });

  $("gateAddUserPanel").style.display = "none";
}
