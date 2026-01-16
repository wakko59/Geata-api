// admin-js/helpers.js
export function $(id) {
  return document.getElementById(id);
}

export function setStatus(el, msg, isErr=false) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status " + (isErr ? "err" : "ok");
}

export function renderEventCheckboxPanel(containerEl, eventTypes) {
  if (!containerEl) return;
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

export function getPanelChecked(containerEl) {
  const out = [];
  if (!containerEl) return out;
  containerEl.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => out.push(cb.value));
  return out;
}

export function setPanelChecked(containerEl, selectedList) {
  if(!containerEl) return;
  const set = new Set((selectedList||[]).map(String));
  containerEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = set.has(cb.value);
  });
}
