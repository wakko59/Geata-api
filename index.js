<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Geata Admin</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root{
      --bg: #0b2535;
      --card:#123653;
      --muted:#b8d7ff;
      --accent:#1c5e86;
      --danger:#d9534f;
      --whitebox: rgba(255,255,255,0.95);
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: system-ui,-apple-system,Segoe UI,sans-serif;
      background: radial-gradient(circle at top, #1e3f5d 0, #cfdfee 45%, #b3cde5 100%);
      color:#f5f7fa;
    }
    .container{ max-width:1100px; margin:0 auto; padding:18px 14px 40px; }
    h1{ margin:0 0 8px; font-size:24px; }
    .sub{ margin:0 0 16px; color: var(--muted); font-size:13px; }
    .card{
      background: var(--bg);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 14px 16px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.18);
      margin-bottom: 14px;
    }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .grid2{ display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:12px; }
    @media (max-width: 900px){ .grid2{ grid-template-columns:1fr; } }
    label{ display:block; font-size:13px; margin-bottom:4px; color:#e3f2fd; }
    input, select{
      width:100%;
      padding:8px 10px;
      border-radius: 10px;
      border: 1px solid #ccd2dd;
      font-size: 13px;
      margin-bottom: 8px;
    }
    button{
      padding: 8px 12px;
      border:none;
      border-radius: 999px;
      background: var(--accent);
      color:#fff;
      font-size: 13px;
      cursor:pointer;
      margin-right: 6px;
      margin-bottom: 6px;
      display:inline-flex;
      gap:6px;
      align-items:center;
      white-space:nowrap;
    }
    button.secondary{ background:#345a77; }
    button.danger{ background: var(--danger); }
    button[disabled]{ opacity:0.5; cursor:default; }
    .status{ min-height:16px; font-size:12px; margin-top:6px; }
    .status.ok{ color:#ffb300; }
    .status.err{ color:#b00020; }

    .tabs{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
    .tabbtn{ background:#17405f; border:1px solid rgba(255,255,255,0.10); }
    .tabbtn.active{ filter: brightness(1.08); }

    .whitebox{
      background: var(--whitebox);
      color:#122b3a;
      border-radius: 12px;
      padding: 10px 12px;
      border: 1px solid rgba(0,0,0,0.12);
      margin: 8px 0 10px;
    }

    /* event checkbox panel */
    .event-panel{
      background: var(--card);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .event-row{
      display:grid;
      grid-template-columns: 26px 1fr;
      align-items:center;
      gap: 10px;
      padding: 6px 2px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .event-row:last-child{ border-bottom:none; }
    .event-row input[type=checkbox]{ width:16px; height:16px; margin:0; }
    .event-row span{ font-size:13px; }

    table{
      width:100%;
      border-collapse: collapse;
      background: var(--card);
      border-radius: 12px;
      overflow:hidden;
      font-size: 12px;
    }
    th, td{
      border: 1px solid #2a4358;
      padding: 6px;
      text-align:left;
      vertical-align:top;
    }
    th{ background:#17405f; }
    code{ font-size:12px; }
  </style>
</head>

<body>
<div class="container">
  <h1>Geata Admin</h1>
  <p class="sub">Profile-driven admin. Flow: Auth → Users (select user → select gate → schedule + emails) or Gates (select gate → users + settings + IO test)</p>

  <div class="card">
    <div class="tabs">
      <button id="tabAuth" class="tabbtn active">🔑 Auth</button>
      <button id="tabUsers" class="tabbtn">👤 Users</button>
      <button id="tabGates" class="tabbtn">🚪 Gates</button>
    </div>
    <div class="whitebox">
      <div class="row">
        <div><strong>Admin API key status:</strong></div>
        <code id="keyFingerprint">(not set)</code>
      </div>
    </div>
  </div>

  <!-- AUTH -->
  <section id="screen-auth" class="card">
    <label for="apiKeyInput">Admin API Key</label>
    <input id="apiKeyInput" type="text" placeholder="Enter admin API key" />
    <div class="row">
      <button id="saveKeyBtn">Save</button>
      <button id="clearKeyBtn" class="secondary">Clear</button>
      <button id="smokeBtn" class="secondary">Smoke Test (load devices)</button>
    </div>
    <div id="authStatus" class="status"></div>
    <div class="sub">Stored locally in your browser (localStorage). Sent as <code>x-api-key</code>.</div>
  </section>

  <!-- USERS -->
  <section id="screen-users" class="card" style="display:none;">
    <div class="grid2">
      <div>
        <label for="userSelect">Select User</label>
        <select id="userSelect">
          <option value="">-- select a user --</option>
        </select>
        <button id="refreshUsersBtn" class="secondary">Refresh Users</button>
      </div>
      <div>
        <label for="userGateSelect">Select Gate</label>
        <select id="userGateSelect" disabled>
          <option value="">-- select a gate --</option>
        </select>
        <button id="refreshProfileBtn" class="secondary" disabled>Refresh Profile</button>
      </div>
    </div>

    <div class="whitebox">
      <div class="row" style="justify-content:space-between;">
        <div>
          <div><strong>User:</strong> <span id="userSummary">(none)</span></div>
          <div class="sub" style="margin:6px 0 0;">Data source: <code>GET /profiles/users/:id</code></div>
        </div>
        <div>
          <div><strong>Selected Gate:</strong> <span id="gateSummary">(none)</span></div>
        </div>
      </div>
    </div>

    <div class="grid2">
      <div>
        <h3 style="margin:6px 0 8px; font-size:15px;">Schedule Assignment</h3>
        <label for="scheduleSelect">Schedule</label>
        <select id="scheduleSelect" disabled>
          <option value="">24/7 (no schedule)</option>
        </select>
        <div class="whitebox">
          <div><strong>Schedule details</strong></div>
          <div id="scheduleDetails" class="sub" style="color:#122b3a;margin-top:6px;">Select a gate to view schedule details.</div>
        </div>
        <button id="saveScheduleBtn" disabled>Save Schedule</button>
      </div>

      <div>
        <h3 style="margin:6px 0 8px; font-size:15px;">Email Notifications</h3>
        <div id="emailPanel"></div>
        <button id="saveEmailsBtn" disabled>Save Email Subscriptions</button>
      </div>
    </div>

    <div id="usersStatus" class="status"></div>
  </section>

  <!-- GATES -->
  <section id="screen-gates" class="card" style="display:none;">
    <div class="grid2">
      <div>
        <label for="gateSelect">Select Gate</label>
        <select id="gateSelect">
          <option value="">-- select a gate --</option>
        </select>
        <div class="row">
          <button id="refreshGatesBtn" class="secondary">Refresh Devices</button>
          <button id="loadGateUsersBtn" class="secondary">Load Users on Gate</button>
        </div>
      </div>
      <div>
        <label>Device Settings (AUX1 Mode)</label>
        <div class="event-panel">
          <label class="event-row">
            <input type="radio" name="aux1Mode" value="relay">
            <span>relay — AUX1 acts as a simple switch output</span>
          </label>
          <label class="event-row">
            <input type="radio" name="aux1Mode" value="gate2">
            <span>gate2 — Input2 monitors pedestrian gate status</span>
          </label>
        </div>
        <div class="row" style="margin-top:8px;">
          <button id="loadSettingsBtn" class="secondary">Load Settings</button>
          <button id="saveSettingsBtn">Save Settings</button>
        </div>
      </div>
    </div>

    <h3 style="margin:10px 0 8px; font-size:15px;">Users on Gate</h3>
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Email</th>
          <th>Phone</th>
          <th>Role</th>
          <th>Schedule</th>
        </tr>
      </thead>
      <tbody id="gateUsersTbody"></tbody>
    </table>

    <div style="margin-top:12px;">
      <h3 style="margin:6px 0 8px; font-size:15px;">I/O Test (Admin)</h3>
      <div class="row">
        <button id="aux1PulseBtn" class="secondary">AUX1 Pulse 1s</button>
        <button id="aux2PulseBtn" class="secondary">Output3 Pulse 2s</button>
      </div>
      <div class="row">
        <button id="simOpenBtn">Sim OPEN_REQUESTED</button>
        <button id="simOpenedBtn">Sim GATE_OPENED</button>
        <button id="simClosedBtn">Sim GATE_CLOSED</button>
        <button id="simTamperBtn" class="danger">Sim TAMPER_OPENED</button>
      </div>
    </div>

    <div id="gatesStatus" class="status"></div>
  </section>

</div>

<script>
  // ---------------------------
  // constants
  // ---------------------------
  const EMAIL_EVENT_TYPES = [
    "OPEN_REQUESTED",
    "CMD_COMPLETED",
    "GATE_OPENED",
    "GATE_CLOSED",
    "GATE_FORCED_OPEN",
    "DOOR_FORCED_OPEN",
    "GATE_OPEN_TOO_LONG",
    "TAMPER_OPENED",
    "ACCESS_DENIED_NOT_ASSIGNED",
    "ACCESS_DENIED_SCHEDULE",
    "AUX1_REQUESTED",
    "AUX2_REQUESTED",
    "AUX1_DENIED_NOT_ASSIGNED",
    "AUX1_DENIED_SCHEDULE",
    "AUX2_DENIED_NOT_ASSIGNED",
    "AUX2_DENIED_SCHEDULE"
  ];

  // ---------------------------
  // state
  // ---------------------------
  let apiKey = localStorage.getItem("geata_admin_api_key") || "";
  let allUsers = [];
  let allDevices = [];
  let allSchedules = [];
  const profilesByUserId = new Map(); // userId -> profile

  function $(id){ return document.getElementById(id); }

  function setStatus(el, msg, isError){
    if (!el) return;
    el.textContent = msg || "";
    el.className = "status " + (isError ? "err" : "ok");
  }

  function headersJson(){
    const h = { "Content-Type":"application/json" };
    if (apiKey) h["x-api-key"] = apiKey;
    return h;
  }

  async function apiJson(path, opts = {}){
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: { ...headersJson(), ...(opts.headers || {}) },
      body: opts.body
    });
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok){
      const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : ("HTTP " + res.status));
      throw new Error(msg);
    }
    return data;
  }

  function fingerprintKey(k){
    if (!k) return "(not set)";
    // purely UI - not cryptographic. Just a short display.
    return "set (" + k.slice(0, 4) + "…" + k.slice(-4) + ")";
  }

  function invalidateProfile(userId){
    if (!userId) return;
    profilesByUserId.delete(userId);
  }

  async function loadUserProfile(userId, { force=false } = {}){
    if (!userId) return null;
    if (!force && profilesByUserId.has(userId)) return profilesByUserId.get(userId);
    const profile = await apiJson("/profiles/users/" + encodeURIComponent(userId));
    profilesByUserId.set(userId, profile);
    return profile;
  }

  function renderEventCheckboxPanel(containerEl, eventTypes){
    containerEl.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "event-panel";
    (eventTypes || []).forEach(ev => {
      const row = document.createElement("label");
      row.className = "event-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = ev;
      const txt = document.createElement("span");
      txt.textContent = ev;
      row.appendChild(cb);
      row.appendChild(txt);
      panel.appendChild(row);
    });
    containerEl.appendChild(panel);
  }

  function setPanelChecked(containerEl, selectedList){
    const set = new Set((selectedList || []).map(String));
    containerEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = set.has(cb.value);
    });
  }

  function getPanelChecked(containerEl){
    const out = [];
    containerEl.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => out.push(cb.value));
    return out;
  }

  function dayName(d){ return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d] || "?"; }
  function describeSlots(slots){
    if (!slots || !slots.length) return "No slots (denies all)";
    return slots.map(s => {
      const days = Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [];
      const dayStr = days.length ? days.map(dayName).join(",") : "All days";
      return `${dayStr} ${s.start || ""}-${s.end || ""}`;
    }).join(" | ");
  }

  // ---------------------------
  // load lists
  // ---------------------------
  async function loadDevices(){
    allDevices = await apiJson("/devices");
    const gateSelect = $("gateSelect");
    const userGateSelect = $("userGateSelect");

    gateSelect.innerHTML = `<option value="">-- select a gate --</option>`;
    allDevices.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = `${d.id} – ${d.name}`;
      gateSelect.appendChild(opt);
    });

    // userGateSelect is populated from profile devices, not allDevices
    setStatus($("gatesStatus"), `Loaded ${allDevices.length} devices`, false);
  }

  async function loadUsers(){
    allUsers = await apiJson("/users");
    const sel = $("userSelect");
    sel.innerHTML = `<option value="">-- select a user --</option>`;
    allUsers.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = `${u.name || "(no name)"}${u.email ? " · " + u.email : ""}${u.phone ? " · " + u.phone : ""} [${u.id}]`;
      sel.appendChild(opt);
    });
    setStatus($("usersStatus"), `Loaded ${allUsers.length} users`, false);
  }

  async function loadSchedules(){
    allSchedules = await apiJson("/schedules");
    // scheduleSelect is filled when a profile device is chosen (so we can set selected value safely)
  }

  function fillScheduleSelect(selectEl){
    selectEl.innerHTML = `<option value="">24/7 (no schedule)</option>`;
    allSchedules.forEach(s => {
      const opt = document.createElement("option");
      opt.value = String(s.id);
      opt.textContent = s.name;
      selectEl.appendChild(opt);
    });
  }

  // ---------------------------
  // Users screen: profile-driven
  // ---------------------------
  async function onUserSelected(){
    const userId = $("userSelect").value;
    $("userGateSelect").innerHTML = `<option value="">-- select a gate --</option>`;
    $("userGateSelect").disabled = true;
    $("refreshProfileBtn").disabled = true;
    $("scheduleSelect").disabled = true;
    $("saveScheduleBtn").disabled = true;
    $("saveEmailsBtn").disabled = true;
    $("scheduleDetails").textContent = "Select a gate to view schedule details.";
    setPanelChecked($("emailPanel"), []);
    $("userSummary").textContent = "(none)";
    $("gateSummary").textContent = "(none)";

    if (!userId) return;

    try{
      const profile = await loadUserProfile(userId, { force:true });
      $("userSummary").textContent = `${profile.user.name || "(no name)"} [${profile.user.id}]`;

      const devices = Array.isArray(profile.devices) ? profile.devices : [];
      devices.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.deviceName ? `${d.deviceId} – ${d.deviceName}` : d.deviceId;
        $("userGateSelect").appendChild(opt);
      });

      $("userGateSelect").disabled = false;
      $("refreshProfileBtn").disabled = false;
      setStatus($("usersStatus"), `Loaded profile: ${devices.length} enrolled gates`, false);
    }catch(e){
      setStatus($("usersStatus"), "Profile load error: " + e.message, true);
    }
  }

  async function onUserGateSelected(){
    const userId = $("userSelect").value;
    const deviceId = $("userGateSelect").value;
    $("gateSummary").textContent = deviceId || "(none)";

    $("scheduleSelect").disabled = true;
    $("saveScheduleBtn").disabled = true;
    $("saveEmailsBtn").disabled = true;

    if (!userId || !deviceId) return;

    try{
      const profile = await loadUserProfile(userId, { force:false });
      const dev = (profile.devices || []).find(x => x.deviceId === deviceId);
      if (!dev){
        setStatus($("usersStatus"), "This user is not enrolled on that gate.", true);
        return;
      }

      // schedule dropdown
      fillScheduleSelect($("scheduleSelect"));
      const scheduleId = dev.scheduleAssignment?.scheduleId ? String(dev.scheduleAssignment.scheduleId) : "";
      $("scheduleSelect").value = scheduleId;
      $("scheduleSelect").disabled = false;

      // schedule details
      if (!dev.schedule){
        $("scheduleDetails").textContent = "24/7 (no schedule)";
      }else{
        const s = dev.schedule;
        $("scheduleDetails").textContent = `${s.name} — ${describeSlots(s.slots || [])}`;
      }

      // notifications from profile
      setPanelChecked($("emailPanel"), dev.notifications?.eventTypes || []);

      $("saveScheduleBtn").disabled = false;
      $("saveEmailsBtn").disabled = false;
      setStatus($("usersStatus"), "Ready. Edit schedule or notifications, then Save.", false);
    }catch(e){
      setStatus($("usersStatus"), "Error: " + e.message, true);
    }
  }

  async function saveSchedule(){
    const userId = $("userSelect").value;
    const deviceId = $("userGateSelect").value;
    if (!userId || !deviceId) return;

    const scheduleId = $("scheduleSelect").value || null;

    try{
      await apiJson(`/devices/${encodeURIComponent(deviceId)}/users/${encodeURIComponent(userId)}/schedule-assignment`, {
        method:"PUT",
        body: JSON.stringify({ scheduleId })
      });

      invalidateProfile(userId);
      await loadUserProfile(userId, { force:true });
      await onUserGateSelected();

      setStatus($("usersStatus"), "Saved schedule assignment", false);
    }catch(e){
      setStatus($("usersStatus"), "Save schedule error: " + e.message, true);
    }
  }

  async function saveEmailSubs(){
    const userId = $("userSelect").value;
    const deviceId = $("userGateSelect").value;
    if (!userId || !deviceId) return;

    try{
      const eventTypes = getPanelChecked($("emailPanel"));
      await apiJson(`/devices/${encodeURIComponent(deviceId)}/users/${encodeURIComponent(userId)}/notifications`, {
        method:"PUT",
        body: JSON.stringify({ eventTypes })
      });

      invalidateProfile(userId);
      await loadUserProfile(userId, { force:true });
      await onUserGateSelected();

      setStatus($("usersStatus"), "Saved email subscriptions", false);
    }catch(e){
      setStatus($("usersStatus"), "Save email error: " + e.message, true);
    }
  }

  // ---------------------------
  // Gates screen
  // ---------------------------
  function getAux1ModePicked(){
    const picked = document.querySelector('input[name="aux1Mode"]:checked');
    return picked ? picked.value : "relay";
  }
  function setAux1ModeRadios(mode){
    const m = mode ? String(mode) : "relay";
    document.querySelectorAll('input[name="aux1Mode"]').forEach(r => r.checked = (r.value === m));
  }

  async function loadGateUsers(){
    const deviceId = $("gateSelect").value;
    const tbody = $("gateUsersTbody");
    tbody.innerHTML = "";
    if (!deviceId){
      setStatus($("gatesStatus"), "Select a gate first", true);
      return;
    }

    try{
      const rows = await apiJson(`/devices/${encodeURIComponent(deviceId)}/users`);
      // Need schedule names: resolve from allSchedules by id (if loaded)
      const scheduleNameById = new Map(allSchedules.map(s => [String(s.id), s.name]));

      rows.forEach(u => {
        const tr = document.createElement("tr");
        const schedName = u.scheduleId ? (scheduleNameById.get(String(u.scheduleId)) || String(u.scheduleId)) : "24/7";
        tr.innerHTML = `
          <td>${(u.name || "")} <div class="sub">[${u.userId}]</div></td>
          <td>${u.email || ""}</td>
          <td>${u.phone || ""}</td>
          <td>${u.role || ""}</td>
          <td>${schedName}</td>
        `;
        tbody.appendChild(tr);
      });

      setStatus($("gatesStatus"), `Loaded ${rows.length} users on ${deviceId}`, false);
    }catch(e){
      setStatus($("gatesStatus"), "Load gate users error: " + e.message, true);
    }
  }

  async function loadSettings(){
    const deviceId = $("gateSelect").value;
    if (!deviceId){
      setStatus($("gatesStatus"), "Select a gate first", true);
      return;
    }
    try{
      const settings = await apiJson(`/devices/${encodeURIComponent(deviceId)}/settings`);
      setAux1ModeRadios(settings.aux1Mode || "relay");
      setStatus($("gatesStatus"), "Loaded device settings", false);
    }catch(e){
      setStatus($("gatesStatus"), "Load settings error: " + e.message, true);
    }
  }

  async function saveSettings(){
    const deviceId = $("gateSelect").value;
    if (!deviceId){
      setStatus($("gatesStatus"), "Select a gate first", true);
      return;
    }
    try{
      const current = await apiJson(`/devices/${encodeURIComponent(deviceId)}/settings`);
      current.aux1Mode = getAux1ModePicked();
      await apiJson(`/devices/${encodeURIComponent(deviceId)}/settings`, {
        method:"PUT",
        body: JSON.stringify(current)
      });
      setStatus($("gatesStatus"), "Saved device settings", false);
    }catch(e){
      setStatus($("gatesStatus"), "Save settings error: " + e.message, true);
    }
  }

  async function pulse(path, durationMs){
    const deviceId = $("gateSelect").value;
    if (!deviceId){
      setStatus($("gatesStatus"), "Select a gate first", true);
      return;
    }
    try{
      await apiJson(`/devices/${encodeURIComponent(deviceId)}/${path}`, {
        method:"POST",
        body: JSON.stringify({ durationMs })
      });
      setStatus($("gatesStatus"), `Triggered ${path} (${durationMs}ms)`, false);
    }catch(e){
      setStatus($("gatesStatus"), "Pulse error: " + e.message, true);
    }
  }

  async function sim(type){
    const deviceId = $("gateSelect").value;
    if (!deviceId){
      setStatus($("gatesStatus"), "Select a gate first", true);
      return;
    }
    try{
      await apiJson(`/devices/${encodeURIComponent(deviceId)}/simulate-event`, {
        method:"POST",
        body: JSON.stringify({ type })
      });
      setStatus($("gatesStatus"), "Simulated " + type, false);
    }catch(e){
      setStatus($("gatesStatus"), "Sim error: " + e.message, true);
    }
  }

  // ---------------------------
  // Tabs
  // ---------------------------
  function showTab(which){
    $("screen-auth").style.display = (which === "auth") ? "block" : "none";
    $("screen-users").style.display = (which === "users") ? "block" : "none";
    $("screen-gates").style.display = (which === "gates") ? "block" : "none";

    $("tabAuth").classList.toggle("active", which === "auth");
    $("tabUsers").classList.toggle("active", which === "users");
    $("tabGates").classList.toggle("active", which === "gates");
  }

  // ---------------------------
  // Init
  // ---------------------------
  window.addEventListener("load", async () => {
    $("apiKeyInput").value = apiKey;
    $("keyFingerprint").textContent = fingerprintKey(apiKey);

    renderEventCheckboxPanel($("emailPanel"), EMAIL_EVENT_TYPES);

    $("tabAuth").addEventListener("click", () => showTab("auth"));
    $("tabUsers").addEventListener("click", () => showTab("users"));
    $("tabGates").addEventListener("click", () => showTab("gates"));

    $("saveKeyBtn").addEventListener("click", async () => {
      apiKey = $("apiKeyInput").value.trim();
      localStorage.setItem("geata_admin_api_key", apiKey);
      $("keyFingerprint").textContent = fingerprintKey(apiKey);
      setStatus($("authStatus"), apiKey ? "Saved API key" : "Cleared API key", false);

      // reload lists
      if (apiKey){
        try{
          await loadDevices();
          await loadSchedules();
          await loadUsers();
          setStatus($("authStatus"), "Loaded devices/schedules/users", false);
        }catch(e){
          setStatus($("authStatus"), "Load error: " + e.message, true);
        }
      }
    });

    $("clearKeyBtn").addEventListener("click", () => {
      apiKey = "";
      $("apiKeyInput").value = "";
      localStorage.removeItem("geata_admin_api_key");
      $("keyFingerprint").textContent = fingerprintKey(apiKey);
      setStatus($("authStatus"), "Cleared API key", false);
    });

    $("smokeBtn").addEventListener("click", async () => {
      try{
        await loadDevices();
        setStatus($("authStatus"), "OK: devices loaded", false);
      }catch(e){
        setStatus($("authStatus"), "Smoke test failed: " + e.message, true);
      }
    });

    // Users events
    $("refreshUsersBtn").addEventListener("click", async () => {
      try{
        await loadUsers();
        setStatus($("usersStatus"), "Refreshed users", false);
      }catch(e){
        setStatus($("usersStatus"), "Refresh users error: " + e.message, true);
      }
    });

    $("userSelect").addEventListener("change", onUserSelected);
    $("userGateSelect").addEventListener("change", onUserGateSelected);

    $("refreshProfileBtn").addEventListener("click", async () => {
      const userId = $("userSelect").value;
      if (!userId) return;
      try{
        await loadUserProfile(userId, { force:true });
        await onUserSelected();
        await onUserGateSelected();
        setStatus($("usersStatus"), "Profile refreshed", false);
      }catch(e){
        setStatus($("usersStatus"), "Profile refresh error: " + e.message, true);
      }
    });

    $("saveScheduleBtn").addEventListener("click", saveSchedule);
    $("saveEmailsBtn").addEventListener("click", saveEmailSubs);

    // Gates events
    $("refreshGatesBtn").addEventListener("click", async () => {
      try{
        await loadDevices();
        setStatus($("gatesStatus"), "Refreshed devices", false);
      }catch(e){
        setStatus($("gatesStatus"), "Refresh devices error: " + e.message, true);
      }
    });

    $("loadGateUsersBtn").addEventListener("click", loadGateUsers);
    $("loadSettingsBtn").addEventListener("click", loadSettings);
    $("saveSettingsBtn").addEventListener("click", saveSettings);

    $("aux1PulseBtn").addEventListener("click", () => pulse("aux1-test", 1000));
    $("aux2PulseBtn").addEventListener("click", () => pulse("aux2-test", 2000));

    $("simOpenBtn").addEventListener("click", () => sim("OPEN_REQUESTED"));
    $("simOpenedBtn").addEventListener("click", () => sim("GATE_OPENED"));
    $("simClosedBtn").addEventListener("click", () => sim("GATE_CLOSED"));
    $("simTamperBtn").addEventListener("click", () => sim("TAMPER_OPENED"));

    // initial load if apiKey present
    if (apiKey){
      try{
        await loadDevices();
        await loadSchedules();
        await loadUsers();
        setStatus($("authStatus"), "Ready", false);
      }catch(e){
        setStatus($("authStatus"), "Initial load error: " + e.message, true);
      }
    }else{
      setStatus($("authStatus"), "Set Admin API key to begin.", true);
    }
  });
</script>
</body>
</html>
