// admin.js — full admin page frontend logic
// Using localStorage for admin API key and fetch wrapper

const STORAGE_KEY = "adminApiKey";

function $(id) {
  return document.getElementById(id);
}

// ===== Auth =====

function saveApiKey() {
  const key = $("adminApiKeyInput").value.trim();
  if (!key) {
    $("authStatus").textContent = "API key required";
    return;
  }
  localStorage.setItem(STORAGE_KEY, key);
  $("authStatus").textContent = "Saved!";
  showMainSections();
}

function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

function requireAuth() {
  const key = getApiKey();
  if (!key) throw new Error("Missing API key");
  return { "x-api-key": key };
}

function showMainSections() {
  // hide auth
  $("authSection").classList.add("hidden");
  // show main
  $("usersSection").classList.remove("hidden");
  $("devicesSection").classList.remove("hidden");
  $("schedulesSection").classList.remove("hidden");
}

// ===== Fetch Helpers =====

async function apiJson(path, opts = {}) {
  try {
    const headers = { ...requireAuth(), "Content-Type": "application/json" };
    const res = await fetch(path, { ...opts, headers });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    console.error("API fetch error:", e);
    $("rawOutput").textContent = String(e);
    throw e;
  }
}

// ===== Users =====

async function loadUsers(q = "") {
  const list = $("usersList");
  list.innerHTML = "Loading users...";
  const data = await apiJson(`/users?q=${encodeURIComponent(q)}`);
  list.innerHTML = "";
  if (!Array.isArray(data)) return;

  data.forEach(u => {
    const btn = document.createElement("button");
    btn.textContent = `${u.name} (${u.email||u.phone})`;
    btn.onclick = () => loadUserProfile(u.id);
    list.append(btn);
  });
}

async function loadUserProfile(userId) {
  const profile = await apiJson(`/profiles/users/${userId}`);
  $("rawOutput").textContent = JSON.stringify(profile, null, 2);
}

// ===== Devices =====

async function loadDevices() {
  const list = $("devicesList");
  list.innerHTML = "Loading devices...";
  const data = await apiJson("/devices");
  list.innerHTML = "";
  if (!Array.isArray(data)) return;

  data.forEach(d => {
    const div = document.createElement("div");
    div.textContent = `${d.id} — ${d.name}`;
    list.append(div);
  });
}

// ===== Schedules =====

async function loadSchedules() {
  const list = $("schedulesList");
  list.innerHTML = "Loading...";
  const data = await apiJson("/schedules");
  list.innerHTML = "";
  if (!Array.isArray(data)) return;

  data.forEach(s => {
    const div = document.createElement("div");
    div.textContent = `${s.id}: ${s.name} — ${s.description||""}`;
    list.append(div);
  });
}

// ===== Event Binding =====

$("saveApiKeyBtn").addEventListener("click", saveApiKey);
$("userSearchBtn").addEventListener("click", () => {
  const q = $("userSearchInput").value;
  loadUsers(q);
});
$("loadDevicesBtn").addEventListener("click", loadDevices);
$("loadSchedulesBtn").addEventListener("click", loadSchedules);

// ===== Initial UI =====

// If key already saved, skip auth and show
if (getApiKey()) {
  $("authSection").classList.add("hidden");
  showMainSections();
}
