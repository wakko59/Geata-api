// admin-js/usersUI.js

import { $, setStatus, renderEventCheckboxPanel, setPanelChecked, getPanelChecked } from "./helpers.js";
import { apiJson } from "./api.js";
export { getPanelChecked } from "./helpers.js";


// Expose helper functions and state for console & handler use
window.getPanelChecked = getPanelChecked;
window.setPanelChecked = setPanelChecked;
window.loadAndRenderUserProfile = loadAndRenderUserProfile;


export function fillUserSelect(selectEl, users) {
  if (!selectEl) return;
  const list = users || allUsers;
  selectEl.innerHTML = `<option value="">-- Select a user --</option>`;
  list.forEach(u => {
    const o = document.createElement("option");
    o.value = u.id;
    o.textContent = `${u.name || "(no name)"}${u.email ? " · " + u.email : ""} [${u.id}]`;
    selectEl.appendChild(o);
  });
}
// ==========================
// Gate Selection Handler
// ==========================

export function onUsersGateChanged() {
  const deviceId = $("usersDeviceSelect").value;
  currentUserDeviceId = deviceId;
  window.currentUserDeviceId = currentUserDeviceId; // expose

  // If no device selected, clear related UI
  if (!currentUserProfile || !deviceId) {
    $("usersScheduleSelect").innerHTML = "";
    $("usersScheduleSelect").disabled = true;
    $("usersSaveScheduleBtn").disabled = true;
    $("usersEmailPanel").innerHTML = "";
    $("usersSaveEmailBtn").disabled = true;
    return;
  }

  // Find this device’s entry in the profile
  const dev = currentUserProfile.devices.find(d => d.deviceId === deviceId) || {};

  // ===== Populate schedule dropdown =====
  const schedSel = $("usersScheduleSelect");
  schedSel.innerHTML = "";

  // Always add default 24/7 option
  const optDefault = document.createElement("option");
  optDefault.value = "";
  optDefault.textContent = "24/7 (default)";
  schedSel.appendChild(optDefault);

  // Add each loaded schedule
  (window.appSchedules || []).forEach(s => {
    const o = document.createElement("option");
    o.value = String(s.id);
    o.textContent = s.name;
    schedSel.appendChild(o);
  });
 

  // Pre‑select whatever schedule is assigned
  schedSel.value = dev.scheduleId != null ? String(dev.scheduleId) : "";

  schedSel.disabled = false;
  $("usersSaveScheduleBtn").disabled = false;

  // ===== Populate email alert checkboxes =====
  renderEventCheckboxPanel($("usersEmailPanel"), window.ALERT_EVENT_TYPES);
  

  // If there are existing subscriptions for this user+gate, check them
  setPanelChecked($("usersEmailPanel"), dev.notifications?.eventTypes || []);
  $("usersSaveEmailBtn").disabled = false;
}


// ==========================
// Credential Editor Helpers
// ==========================

// Controls whether credential inputs are editable or read‑only
let userCredEditing = false;

export function setUserCredEditing(enabled) {
  userCredEditing = !!enabled;

  $("userCredName").disabled = !userCredEditing;
  $("userCredEmail").disabled = !userCredEditing;
  $("userCredPhone").disabled = !userCredEditing;
  $("userCredPassword").disabled = !userCredEditing;

  // Optionally update UI appearance (add/remove a class, etc.)
  if (userCredEditing) {
    $("editUserBtn")?.classList.add("editing");
  } else {
    $("editUserBtn")?.classList.remove("editing");
  }

  // Save button should only be active while editing
  $("saveUserBtn").disabled = !userCredEditing;
}


// State
let allUsers = [];
let allSchedules = [];
let allDevices = [];
let currentUserId = "";
let currentUserProfile = null;
let currentUserDeviceId = "";


// ==========================
// Load Users
// ==========================

export async function loadUsers(query = null) {
  const url = query ? ("/users?q=" + encodeURIComponent(query)) : "/users";
  const list = await apiJson(url);
  allUsers = Array.isArray(list) ? list : [];
}

// ==========================
// Profile Load + Render
// ==========================

export async function loadUserProfile(userId, { force=false }={}) {
  if (!userId) return null;
  if (!force && window.profilesByUserId?.has(userId)) {
    return window.profilesByUserId.get(userId);
  }
  const profile = await apiJson(
    `/profiles/users/${encodeURIComponent(userId)}`
  );
  window.profilesByUserId ||= new Map();
  window.profilesByUserId.set(userId, profile);
  return profile;
}

export async function loadAndRenderUserProfile(userId) {
  currentUserId = userId;
  currentUserProfile = null;
  window.currentUserId = currentUserId;
  currentUserDeviceId = "";

  // Reset UI
  $("usersDeviceSelect").innerHTML = "";
  $("usersScheduleSelect").innerHTML = "";
  $("usersScheduleSelect").disabled = true;
  $("usersSaveScheduleBtn").disabled = true;
  $("usersSaveEmailBtn").disabled = true;
  setPanelChecked($("usersEmailPanel"), []);
  $("usersProfileJson").textContent = "";

  $("usersPickedUser") && ($("usersPickedUser").textContent = "");
  $("usersPickedEmail") && ($("usersPickedEmail").textContent = "");
  $("usersPickedPhone") && ($("usersPickedPhone").textContent = "");

  // Reset credentials editor
  $("userCredId").textContent = "";
  $("userCredName").value = "";
  $("userCredEmail").value = "";
  $("userCredPhone").value = "";
  $("userCredPassword").value = "";
  setUserCredEditing(false);

  if (!currentUserId) {
    setStatus($("usersProfileStatus"), "No user selected", true);
    return;
  }

  setStatus($("usersProfileStatus"), "Loading profile…", false);

  try {
    const profile = await loadUserProfile(userId, { force:true });
    currentUserProfile = profile;

    // Static Profile Info
    $("usersPickedUser") &&
      ($("usersPickedUser").textContent =
        `${profile.user?.name || "(no name)"} [${profile.user?.id}]`);
    $("usersPickedEmail") &&
      ($("usersPickedEmail").textContent = profile.user?.email || "(none)");
    $("usersPickedPhone") &&
      ($("usersPickedPhone").textContent = profile.user?.phone || "(none)");

    // Credentials Editor
    $("userCredId").textContent = profile.user.id || "";
    $("userCredName").value = profile.user.name || "";
    $("userCredEmail").value = profile.user.email || "";
    $("userCredPhone").value = profile.user.phone || "";
    $("userCredPassword").value = "";
    $("editUserBtn").disabled = false;
    $("saveUserBtn").disabled = false;
    setUserCredEditing(false);

    // Gates dropdown
    const sel = $("usersDeviceSelect");
    sel.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- Select a gate --";
    sel.appendChild(defaultOpt);

    (profile.devices || []).forEach(d => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.deviceName
        ? `${d.deviceId} – ${d.deviceName}`
        : d.deviceId;
      sel.appendChild(o);
    });

    sel.disabled = false;
    sel.onchange = onUsersGateChanged;

    // Debug JSON panel
    $("usersProfileJson").textContent =
      JSON.stringify(profile, null, 2);

    setStatus($("usersProfileStatus"), "Profile loaded", false);

  } catch (e) {
    setStatus($("usersProfileStatus"), "Error loading profile: " + e.message, true);
    console.error("Profile load error:", e);
  }
}

// ==========================
// UI Initialization
// ==========================

export function initUsersUI() {
  renderEventCheckboxPanel($("usersEmailPanel"), window.ALERT_EVENT_TYPES);

  $("usersSearchBtn")?.addEventListener("click", async () => {
    const q = $("usersSearch").value.trim();
    setStatus($("usersListStatus"), "Searching…", false);
    try {
      await loadUsers(q || null);
      fillUserSelect($("usersSelect"), allUsers);
      setStatus($("usersListStatus"), `Found ${allUsers.length} users`, false);
    } catch (e) {
      setStatus($("usersListStatus"), "Search error: " + e.message, true);
    }
  });
async function populateUsersAddToGateSelect() {
  // List all devices
  const allDevices = await apiJson("/devices");
  const sel = $("usersAddGateSelect");
  sel.innerHTML = `<option value="">-- Select a gate --</option>`;
  allDevices.forEach(d => {
    const o = document.createElement("option");
    o.value = d.id;
    o.textContent = d.name || d.id;
    sel.appendChild(o);
  });
}

// Populate schedules in “add” panel
function populateUsersAddScheduleSelect() {
  const sel = $("usersAddGateSchedule");
  sel.innerHTML = "";
  const optDefault = document.createElement("option");
  optDefault.value = "";
  optDefault.textContent = "24/7 (no schedule)";
  sel.appendChild(optDefault);

  (window.appSchedules || []).forEach(s => {
    const o = document.createElement("option");
    o.value = String(s.id);
    o.textContent = s.name;
    sel.appendChild(o);
  });
}

// Init Add to Gate UI
function initUsersAddToGateUI() {
  populateUsersAddToGateSelect();
  populateUsersAddScheduleSelect();
  renderEventCheckboxPanel($("usersAddGateEmailPanel"), window.ALERT_EVENT_TYPES);
}

// Call as part of initUsersUI
initUsersAddToGateUI();

  $("usersShowAllBtn")?.addEventListener("click", async () => {
    $("usersSearch").value = "";
    setStatus($("usersListStatus"), "Loading…", false);
    try {
      await loadUsers(null);
      fillUserSelect($("usersSelect"), allUsers);
      setStatus($("usersListStatus"), `Loaded ${allUsers.length} users`, false);
    } catch (e) {
      setStatus($("usersListStatus"), "Load error: " + e.message, true);
    }
  });

  // ⚠ Correct Profile Loader Binding
  $("usersLoadProfileBtn")?.addEventListener("click", async () => {
    const userId = $("usersSelect").value;
    if (!userId) {
      setStatus($("usersProfileStatus"), "Select a user first", true);
      return;
    }
    setStatus($("usersProfileStatus"), "Loading profile…", false);
    try {
      await loadAndRenderUserProfile(userId);
    } catch (e) {
      setStatus($("usersProfileStatus"), "Error loading profile: " + e.message, true);
      console.error("Profile load error:", e);
    }
  });

  $("usersSelect")?.addEventListener("change", () => {
    $("usersProfileJson").textContent = "";
    setStatus($("usersProfileStatus"), "", false);
  });

  $("usersDeleteBtn")?.addEventListener("click", async () => {
    const userId = $("usersSelect").value;
    if (!userId) return setStatus($("usersStatus"), "Select a user", true);
    if (!confirm("Soft-delete this user?")) return;
    try {
      await apiJson(`/users/${encodeURIComponent(userId)}`, { method:"DELETE" });
      await loadUsers(null);
      fillUserSelect($("usersSelect"), allUsers);
      $("usersSelect").value = "";
      setStatus($("usersStatus"), "User deleted (soft)", false);
    } catch (e) {
      setStatus($("usersStatus"), "Delete failed: " + e.message, true);
    }
  });

  $("usersDeviceSelect")?.addEventListener("change", () => {
    onUsersGateChanged();
  });

  // Save Schedule
$("usersSaveScheduleBtn")?.addEventListener("click", async () => {
  const scheduleId = $("usersScheduleSelect").value || null;
  console.log("SaveSchedule clicked:", {
    userId: $("usersSelect").value,
    deviceId: $("usersDeviceSelect").value,
    scheduleId
  });
  

  // Basic validation
  if (!$("usersSelect").value || !$("usersDeviceSelect").value) {
    setStatus($("usersScheduleStatus"), "Pick user + gate", true);
    return;
  }

  try {
    await apiJson(
      `/devices/${encodeURIComponent($("usersDeviceSelect").value)}/users/${encodeURIComponent($("usersSelect").value)}/schedule-assignment`,
      { method: "PUT", body: { scheduleId } }
    );
    setStatus($("usersScheduleStatus"), "Schedule saved", false);
  } catch (e) {
    setStatus($("usersScheduleStatus"), "Save error: " + e.message, true);
  }
});

// Save Email Alerts
$("usersSaveEmailBtn")?.addEventListener("click", async () => {
  const eventTypes = getPanelChecked($("usersEmailPanel"));
  console.log("SaveEmail clicked:", {
    userId: $("usersSelect").value,
    deviceId: $("usersDeviceSelect").value,
    eventTypes
  });

  if (!$("usersSelect").value || !$("usersDeviceSelect").value) {
    setStatus($("usersEmailStatus"), "Pick user + gate", true);
    return;
  }

  try {
    await apiJson(
      `/devices/${encodeURIComponent($("usersDeviceSelect").value)}/users/${encodeURIComponent($("usersSelect").value)}/notifications`,
      { method: "PUT", body: { eventTypes } }
    );
    setStatus($("usersEmailStatus"), "Email subscriptions saved", false);
  } catch (e) {
    setStatus($("usersEmailStatus"), "Save email error: " + e.message, true);
  }
});
// … rest of the listeners remain unchanged …
$("usersAddGateBtn")?.addEventListener("click", async () => {
  const userId = $("usersSelect").value;
  const deviceId = $("usersAddGateSelect").value;
  const role = $("usersAddGateRole").value;
  const scheduleId = $("usersAddGateSchedule").value || null;
  const eventTypes = getPanelChecked($("usersAddGateEmailPanel"));

  if (!userId || !deviceId) {
    setStatus($("usersAddGateStatus"), "Pick user + gate", true);
    return;
  }

  try {
    await apiJson(`/devices/${encodeURIComponent(deviceId)}/users`, {
      method: "POST",
      body: { userId, role, scheduleId, eventTypes }
    });
    setStatus($("usersAddGateStatus"), "Added user to gate", false);
  } catch (e) {
    setStatus($("usersAddGateStatus"), "Add to gate error: " + e.message, true);
  }
});

}
