// admin-js/schedulesUI.js

import { $, setStatus } from "./helpers.js";
import { apiJson } from "./api.js";

let allSchedules = [];
let editingScheduleId = null;

// =========================
// Slots Helpers
// =========================

function dayName(d) { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d] || "?"; }

function describeSlots(slots) {
  if (!slots || slots.length === 0) return "No slots";
  return slots.map(s => {
    const days = Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [];
    const dayStr = days.length ? days.map(dayName).join(",") : "All days";
    return `${dayStr} ${s.start || ""}-${s.end || ""}`;
  }).join(" | ");
}

export function resetScheduleForm() {
  editingScheduleId = null;
  $("scheduleFormTitle").textContent = "Create / Edit Schedule";
  $("scheduleNameInput").value = "";
  $("scheduleDescInput").value = "";
  for (let i = 1; i <= 6; i++) {
    $(`slot${i}Days`).value = "";
    $(`slot${i}Start`).value = "";
    $(`slot${i}End`).value = "";
  }
  setScheduleEditing(false);
}

export function setScheduleEditing(enabled) {
  $("scheduleNameInput").disabled = !enabled;
  $("scheduleDescInput").disabled = !enabled;
  for (let i = 1; i <= 6; i++) {
    $(`slot${i}Days`).disabled = !enabled;
    $(`slot${i}Start`).disabled = !enabled;
    $(`slot${i}End`).disabled = !enabled;
  }
  $("scheduleSaveTopBtn").disabled = !enabled;
}

export function readSlotsFromForm() {
  const slots = [];
  for (let i = 1; i <= 6; i++) {
    const daysStr = $(`slot${i}Days`).value.trim();
    const start = $(`slot${i}Start`).value;
    const end = $(`slot${i}End`).value;
    if (!daysStr && !start && !end) continue;
    if (!start || !end) continue;
    slots.push({ daysOfWeek: parseDaysString(daysStr), start, end });
  }
  return slots;
}

// =========================
// Load / Render
// =========================

export async function loadSchedules() {
  try {
    const data = await apiJson("/schedules");
    allSchedules = Array.isArray(data) ? data : [];
    await renderSchedules();
    setStatus($("scheduleStatus"), `Loaded ${allSchedules.length} schedules`, false);
  } catch (e) {
    setStatus($("scheduleStatus"), "Error loading schedules: " + e.message, true);
  }
}

export async function renderSchedules() {
  const tbody = document.querySelector("#schedulesTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  allSchedules.forEach(s => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${s.id}</td>
      <td>${s.name || ""}</td>
      <td>${describeSlots(s.slots || [])}</td>
      <td></td>
      <td></td>
    `;

    const tdEdit = tr.children[3];
    const tdDel = tr.children[4];

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "Edit";
    btnEdit.className = "btn-small";
    btnEdit.addEventListener("click", () => {
      editingScheduleId = s.id;
      $("scheduleFormTitle").textContent = `Editing schedule ${s.id}`;
      $("scheduleNameInput").value = s.name || "";
      $("scheduleDescInput").value = s.description || "";
      fillSlotsFormFromSchedule(s);
      setScheduleEditing(true);
      setStatus($("scheduleStatus"), "Edit enabled. Adjust and Save.", false);
    });
    tdEdit.appendChild(btnEdit);

    const btnDel = document.createElement("button");
    btnDel.textContent = "Delete";
    btnDel.className = "btn-danger btn-small";
    btnDel.addEventListener("click", async () => {
      if (!confirm(`Delete schedule "${s.name}"?`)) return;
      try {
        await apiJson(`/schedules/${encodeURIComponent(s.id)}`, { method: "DELETE" });
        setStatus($("scheduleStatus"), "Deleted schedule", false);
        resetScheduleForm();
        await loadSchedules();
      } catch (e) {
        setStatus($("scheduleStatus"), "Delete error: " + e.message, true);
      }
    });
    tdDel.appendChild(btnDel);

    tbody.appendChild(tr);
  });
}

// =========================
// Form Helpers
// =========================

export function fillSlotsFormFromSchedule(s) {
  for (let i = 1; i <= 6; i++) {
    $(`slot${i}Days`).value = "";
    $(`slot${i}Start`).value = "";
    $(`slot${i}End`).value = "";
  }
  const slots = s.slots || [];
  for (let i = 0; i < slots.length && i < 6; i++) {
    const sl = slots[i];
    $(`slot${i+1}Days`).value = (sl.daysOfWeek || []).join(",");
    $(`slot${i+1}Start`).value = sl.start || "";
    $(`slot${i+1}End`).value = sl.end || "";
  }
}

// =========================
// Bootstrap UI
// =========================

export function initSchedulesUI() {
  $("refreshSchedulesBtn")?.addEventListener("click", loadSchedules);

  $("scheduleNewBtn")?.addEventListener("click", () => {
    resetScheduleForm();
    setScheduleEditing(true);
    setStatus($("scheduleStatus"), "Creating new schedule. Fill the form and click Save.", false);
  });

  $("scheduleSaveTopBtn")?.addEventListener("click", async () => {
    const name = $("scheduleNameInput").value.trim();
    if (!name) return setStatus($("scheduleStatus"), "Schedule name required", true);

    const payload = {
      name,
      description: $("scheduleDescInput").value.trim(),
      slots: readSlotsFromForm()
    };

    try {
      if (editingScheduleId) {
        await apiJson(`/schedules/${encodeURIComponent(editingScheduleId)}`, { method: "PUT", body: payload });
      } else {
        await apiJson("/schedules", { method: "POST", body: payload });
      }
      setStatus($("scheduleStatus"), "Saved schedule", false);
      resetScheduleForm();
      await loadSchedules();
    } catch (e) {
      setStatus($("scheduleStatus"), "Save error: " + e.message, true);
    }
  });

  $("resetScheduleFormBtn")?.addEventListener("click", resetScheduleForm);
  
  setScheduleEditing(false);
}
