// admin‑js/api.js

import { setStatus } from "./helpers.js";

// Return headers including the stored admin API key
export function requireAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  const key = localStorage.getItem("geata_admin_api_key");
  if (key) headers["x-api-key"] = key;
  return headers;
}

// Return the currently stored API key (for auth UI)
export function getApiKey() {
  return localStorage.getItem("geata_admin_api_key") || "";
}

// Set the API key in localStorage
export function setApiKey(key) {
  if (key) localStorage.setItem("geata_admin_api_key", key);
  else localStorage.removeItem("geata_admin_api_key");
}

// JSON fetch helper used by the UI
export async function apiJson(path, { method="GET", body=null, statusEl=null }={}) {
  try {
    const res = await fetch(path, {
      method,
      headers: requireAuthHeaders(),
      body: body ? JSON.stringify(body) : null
    });

    const text = await res.text().catch(() => "");
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (statusEl) setStatus(statusEl, e.message, true);
    throw e;
  }
}
