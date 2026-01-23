// admin-js/usersUI.js

import { $, setStatus, renderEventCheckboxPanel, setPanelChecked, getPanelChecked } from "./helpers.js";
import { apiJson } from "./api.js";

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

  // … rest of the listeners remain unchanged …
}
