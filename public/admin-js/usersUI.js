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
}


// ==========================
// Profile Load + Render
// ==========================

/*export async function loadUserProfile(userId, { force=false }={}) {
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

  $("usersDeviceSelect").innerHTML = `<option value="">-- Select a gate --</option>`;
  $("usersScheduleSelect").disabled = true;
  $("usersSaveScheduleBtn").disabled = true;
  setPanelChecked($("usersEmailPanel"), []);
  $("usersSaveEmailBtn").disabled = true;
  $("usersProfileJson").textContent = "";

  if (!currentUserId){
    setStatus($("usersProfileStatus"), "No user selected", true);
    return;
  }

  setStatus($("usersProfileStatus"), "Loading profile…", false);
  try{
    const profile = await loadUserProfile(currentUserId, { force:true });
    currentUserProfile = profile;

    const pickedUserEl = $("usersPickedUser");
if (pickedUserEl) pickedUserEl.textContent = `${profile.user?.name || "(no name)"} [${profile.user?.id || currentUserId}]`;

const emailEl = $("usersPickedEmail");
if (emailEl) emailEl.textContent = profile.user?.email || "(none)";

const phoneEl = $("usersPickedPhone");
if (phoneEl) phoneEl.textContent = profile.user?.phone || "(none)";

    // Populate deviceSelect
    const sel = $("usersDeviceSelect");
    sel.innerHTML = `<option value="">-- Select a gate --</option>`;
    (profile.devices || []).forEach(d => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.deviceName ? `${d.deviceId} – ${d.deviceName}` : d.deviceId;
      sel.appendChild(o);
    });

    $("usersScheduleSelect").disabled = false;
    $("usersSaveScheduleBtn").disabled = false;

    setPanelChecked($("usersEmailPanel"), profile.devices?.length ? [] : []);

    $("usersProfileJson").textContent = JSON.stringify(profile, null, 2);
    setStatus($("usersProfileStatus"), "Profile loaded", false);

  }catch(e){
    setStatus($("usersProfileStatus"), "Load error: " + e.message, true);
  }
}*/


export function onUsersGateChanged() {
  const deviceId = $("usersDeviceSelect").value || "";
  currentUserDeviceId = deviceId;

  $("usersSaveScheduleBtn").disabled = !deviceId;
  $("usersSaveEmailBtn").disabled = !deviceId;

  if (!currentUserProfile || !deviceId) {
    $("usersScheduleSelect").innerHTML = "";
    setPanelChecked($("usersEmailPanel"), []);
    return;
  }

  const dev = (currentUserProfile.devices || []).find(d => d.deviceId === deviceId) || {};

  $("usersScheduleSelect").innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "24/7 (no schedule)";
  $("usersScheduleSelect").appendChild(blank);

  (allSchedules || []).forEach(s => {
    const o = document.createElement("option");
    o.value = String(s.id);
    o.textContent = s.name;
    $("usersScheduleSelect").appendChild(o);
  });

  $("usersScheduleSelect").value = dev.scheduleId || "";

  renderEventCheckboxPanel($("usersEmailPanel"), window.ALERT_EVENT_TYPES);
  setPanelChecked($("usersEmailPanel"), dev.notifications?.eventTypes || []);
}

