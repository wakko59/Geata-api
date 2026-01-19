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
let userCredEditing = false;
let currentUserIdForCreds = null;


// ==========================
// Users Screen
// ==========================

export async function loadUsers(query=null) {
  const url = query ? ("/users?q=" + encodeURIComponent(query)) : "/users";
  const list = await apiJson(url);
  allUsers = Array.isArray(list) ? list : [];
}

function fillUserSelect(selectEl, users) {
  if (!selectEl) return;
  const list = users || allUsers;
  selectEl.innerHTML = `<option value="">-- Select a user --</option>`;
  list.forEach(u=>{
    const o = document.createElement("option");
    o.value = u.id;
    const label = `${u.name || "(no name)"}` +
                  `${u.email ? " · " + u.email : ""}` +
                  `${u.phone ? " · " + u.phone : ""}` +
                  ` [${u.id}]`;
    o.textContent = label;
    selectEl.appendChild(o);
  });
}


export function initUsersUI() {

  renderEventCheckboxPanel($("usersEmailPanel"), window.ALERT_EVENT_TYPES);

  // Search Button
  $("usersSearchBtn")?.addEventListener("click", async ()=>{
    const q = $("usersSearch").value.trim();
    setStatus($("usersListStatus"), "Searching…", false);
    try{
      await loadUsers(q || null);
      fillUserSelect($("usersSelect"), allUsers);
      setStatus($("usersListStatus"), `Found ${allUsers.length} users`, false);
    } catch(e){
      setStatus($("usersListStatus"), "Search error: " + e.message, true);
    }
  });

  // Show All
  $("usersShowAllBtn")?.addEventListener("click", async ()=>{
    $("usersSearch").value = "";
    setStatus($("usersListStatus"), "Loading…", false);
    try{
      await loadUsers(null);
      fillUserSelect($("usersSelect"), allUsers);
      setStatus($("usersListStatus"), `Loaded ${allUsers.length} users`, false);
    } catch(e){
      setStatus($("usersListStatus"), "Load error: " + e.message, true);
    }
  });

  // Load Profile
$("usersLoadProfileBtn")?.addEventListener("click", async () => {
  const userId = $("usersSelect").value;
  if (!userId) {
    setStatus($("usersProfileStatus"), "Select a user first", true);
    return;
  }
  setStatus($("usersProfileStatus"), "Loading user...", false);

  try {
    const user = await apiJson(`/users/${encodeURIComponent(userId)}`);
    currentUserProfile = user;
	currentUserId = user.id;

	

    $("usersProfileJson").textContent = JSON.stringify(user, null, 2);
    setStatus($("usersProfileStatus"), "User loaded", false);

    const devSel = $("usersDeviceSelect");
    devSel.innerHTML = `<option value="">-- Select a gate --</option>`;
    if (Array.isArray(user.devices)) {
      user.devices.forEach(d => {
        const o = document.createElement("option");
        o.value = d.deviceId;
        o.textContent = d.deviceName
          ? `${d.deviceName} (${d.deviceId})`
          : d.deviceId;
        devSel.appendChild(o);
      });
    }
    devSel.disabled = false;

    $("usersScheduleSelect").innerHTML = "";
    setPanelChecked($("usersEmailPanel"), []);
  } catch (e) {
    setStatus($("usersProfileStatus"), "Error loading user: " + e.message, true);
  }
});



 // Remove auto‑load on select change; only Load Profile button triggers profile load
$("usersSelect")?.addEventListener("change", ()=> {
  // Optionally clear the profile panel when changing selection
  $("usersProfileJson").textContent = "";
  setStatus($("usersProfileStatus"), "", false);
});


  // Delete user
  $("usersDeleteBtn")?.addEventListener("click", async ()=>{
    const userId = $("usersSelect").value;
    if (!userId) return setStatus($("usersStatus"), "Select a user", true);
    if (!confirm("Soft-delete this user?")) return;

    try{
      await apiJson(`/users/${encodeURIComponent(userId)}`, { method:"DELETE" });
      await loadUsers(null);
      fillUserSelect($("usersSelect"), allUsers);
      $("usersSelect").value = "";
      setStatus($("usersStatus"), "User deleted (soft)", false);
    }catch(e){
      setStatus($("usersStatus"), "Delete failed: " + e.message, true);
    }
  });

  // Device select change
  $("usersDeviceSelect")?.addEventListener("change", () => {
  onUsersGateChanged();
});


  // Save Schedule
  $("usersSaveScheduleBtn")?.addEventListener("click", async ()=>{
    if (!currentUserId || !currentUserDeviceId) {
      setStatus($("usersScheduleStatus"), "Pick user + gate", true);
      return;
    }
    const scheduleId = $("usersScheduleSelect").value || null;
    setStatus($("usersScheduleStatus"), "Saving…", false);
    try{
      await apiJson(`/devices/${encodeURIComponent(currentUserDeviceId)}/users/${encodeURIComponent(currentUserId)}/schedule-assignment`, {
        method:"PUT",
        body: { scheduleId }
      });
      onUsersGateChanged();
      setStatus($("usersScheduleStatus"), "Saved schedule", false);
    }catch(e){
      setStatus($("usersScheduleStatus"), "Save error: " + e.message, true);
    }
  });

  // Save Email Alerts
  $("usersSaveEmailBtn")?.addEventListener("click", async ()=>{
    if (!currentUserId || !currentUserDeviceId) {
      setStatus($("usersEmailStatus"), "Pick user + gate", true);
      return;
    }
    const eventTypes = getPanelChecked($("usersEmailPanel"));
    setStatus($("usersEmailStatus"), "Saving…", false);
    try{
      await apiJson(`/devices/${encodeURIComponent(currentUserDeviceId)}/users/${encodeURIComponent(currentUserId)}/notifications`, {
        method:"PUT",
        body: { eventTypes }
      });
      onUsersGateChanged();
      setStatus($("usersEmailStatus"), "Saved email subscriptions", false);
    }catch(e){
      setStatus($("usersEmailStatus"), "Save error: " + e.message, true);
    }
  });

  // Render event checkboxes
  renderEventCheckboxPanel($("usersEmailPanel"), window.ALERT_EVENT_TYPES);
  initUserCredEditor();
}


// ==========================
// Profile Load + Render
// ==========================

export async function loadUserProfile(userId, { force=false }={}) {
  if (!userId) return null;
  if (!force && window.profilesByUserId?.has(userId)) return window.profilesByUserId.get(userId);
  const profile = await apiJson(`/profiles/users/${encodeURIComponent(userId)}`);
  window.profilesByUserId.set(userId, profile);
  return profile;
}

export async function loadAndRenderUserProfile(userId) {
  currentUserId = userId || "";
  currentUserProfile = null;
  currentUserDeviceId = "";

  // Reset UI fields
  $("usersDeviceSelect").innerHTML = "";
  $("usersScheduleSelect").innerHTML = "";
  $("usersScheduleSelect").disabled = true;
  $("usersSaveScheduleBtn").disabled = true;
  setPanelChecked($("usersEmailPanel"), []);
  $("usersSaveEmailBtn").disabled = true;
  $("usersProfileJson").textContent = "";
  $("usersPickedUser") && ($("usersPickedUser").textContent = "");
  $("usersPickedEmail") && ($("usersPickedEmail").textContent = "");
  $("usersPickedPhone") && ($("usersPickedPhone").textContent = "");

  if (!currentUserId) {
    setStatus($("usersProfileStatus"), "No user selected", true);
    return;
  }

  setStatus($("usersProfileStatus"), "Loading profile…", false);

  try {
    const profile = await loadUserProfile(currentUserId, { force:true });
    currentUserProfile = profile;

    // Update static user info
    $("usersPickedUser") && ($("usersPickedUser").textContent = `${profile.user?.name || "(no name)"} [${profile.user?.id || currentUserId}]`);
    $("usersPickedEmail") && ($("usersPickedEmail").textContent = profile.user?.email || "(none)");
    $("usersPickedPhone") && ($("usersPickedPhone").textContent = profile.user?.phone || "(none)");

    // Populate gate dropdown
    const sel = $("usersDeviceSelect");
    sel.innerHTML = "";
    const defaultGateOpt = document.createElement("option");
    defaultGateOpt.value = "";
    defaultGateOpt.textContent = "-- Select a gate --";
    sel.appendChild(defaultGateOpt);

    (profile.devices || []).forEach(d => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.deviceName ? `${d.deviceId} – ${d.deviceName}` : d.deviceId;
      sel.appendChild(o);
    });

    sel.disabled = false;
    sel.onchange = onUsersGateChanged; // bind

    // Profile JSON display
    $("usersProfileJson").textContent = JSON.stringify(profile, null, 2);

    setStatus($("usersProfileStatus"), "Profile loaded", false);

  } catch (e) {
    setStatus($("usersProfileStatus"), "Profile load error: " + e.message, true);
  }
}



export async function onUsersGateChanged() {
  const deviceId = $("usersDeviceSelect").value || "";
  currentUserDeviceId = deviceId;

  // Always clear status messages
  setStatus($("usersScheduleStatus"), "", false);
  setStatus($("usersEmailStatus"), "", false);

  // Disable buttons if no gate
  $("usersSaveScheduleBtn").disabled = !deviceId;
  $("usersSaveEmailBtn").disabled = !deviceId;

  if (!currentUserProfile || !deviceId) {
    // Clear dropdown and checkboxes if no gate is picked
    $("usersScheduleSelect").innerHTML = "";
    setPanelChecked($("usersEmailPanel"), []);
    return;
  }

  // -------------------------------
  // Populate Schedule Dropdown
  // -------------------------------
  const sel = $("usersScheduleSelect");
  sel.innerHTML = "";

  // Add default schedule option (NULL in DB → 24/7)
  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = "24/7 (no schedule)";
  sel.appendChild(blankOpt);

  // Add all named schedules from global list
  (window.appSchedules || []).forEach(s => {
    const o = document.createElement("option");
    o.value = String(s.id);
    o.textContent = s.name;
    sel.appendChild(o);
  });

  // Set the selected value based on the profile, if present
  const dev = currentUserProfile.devices.find(d => d.deviceId === deviceId) || {};
  sel.value = dev.scheduleId ? String(dev.scheduleId) : "";

  // -------------------------------
  // Populate Email Alerts
  // -------------------------------
  renderEventCheckboxPanel($("usersEmailPanel"), window.ALERT_EVENT_TYPES);

  const eventTypes = (dev.notifications && Array.isArray(dev.notifications.eventTypes))
    ? dev.notifications.eventTypes
    : [];
  setPanelChecked($("usersEmailPanel"), eventTypes);
}

async function loadSelectedUserIntoCredForm() {
  const userId = $("usersSelect") ? $("usersSelect").value : "";
  if (!userId) {
    currentUserIdForCreds = null;
    $("userCredId").textContent = "(none)";
    $("userCredName").value = "";
    $("userCredEmail").value = "";
    $("userCredPhone").value = "";
    $("userCredPassword").value = "";
    setUserCredEditing(false);
    return;
  }

  try {
    const profile = await apiJson(`/users/${encodeURIComponent(userId)}`);
    currentUserIdForCreds = profile.id;

    $("userCredId").textContent = profile.id || "(none)";
    $("userCredName").value = profile.name || "";
    $("userCredEmail").value = profile.email || "";
    $("userCredPhone").value = profile.phone || "";
    $("userCredPassword").value = ""; // never show existing password

    setUserCredEditing(false);
    setStatus($("userCredStatus"), "Loaded user credentials. Click Edit User to modify.", false);

  } catch (e) {
    setStatus($("userCredStatus"), "Profile load error: " + e.message, true);
  }
}

function initUserCredEditor() {
  $("editUserBtn")?.addEventListener("click", async () => {
    if (!currentUserIdForCreds) {
      await loadSelectedUserIntoCredForm(); // load first if needed
      if (!currentUserIdForCreds) return;
    }
    setUserCredEditing(true);
    setStatus($("userCredStatus"), "Edit enabled. Change fields and click Save User.", false);
  });

  $("saveUserBtn")?.addEventListener("click", saveUserCreds);

  $("usersSelect")?.addEventListener("change", async () => {
    await loadSelectedUserIntoCredForm();
  });

  setUserCredEditing(false);
}
// SAVE USERS CREDENTIALS
async function saveUserCreds() {
  if (!currentUserIdForCreds) {
    setStatus($("userCredStatus"), "No user loaded", true);
    return;
  }

  try {
    const payload = {
      name: $("userCredName").value.trim(),
      email: $("userCredEmail").value.trim(),
      phone: $("userCredPhone").value.trim(),
    };

    // Only send password if something was entered
    const pwd = $("userCredPassword").value;
    if (pwd) payload.password = pwd;

    await apiJson(`/users/${encodeURIComponent(currentUserIdForCreds)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    $("userCredPassword").value = "";
    setUserCredEditing(false);
    setStatus($("userCredStatus"), "Saved user credentials", false);

  } catch (e) {
    setStatus($("userCredStatus"), "Save error: " + e.message, true);
  }
}
//Edge Case No user selected
function setUserCredEditing(enabled) {
  userCredEditing = enabled;

  $("userCredName").disabled = !enabled;
  $("userCredEmail").disabled = !enabled;
  $("userCredPhone").disabled = !enabled;
  $("userCredPassword").disabled = !enabled;
  $("saveUserBtn").disabled = !enabled || !currentUserIdForCreds;
}




export { fillUserSelect };
