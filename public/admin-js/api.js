// admin-js/api.js
import { setStatus } from "./helpers.js";

export function getApiKey() {
  return localStorage.getItem("geata_admin_api_key") || "";
}

export function requireAuthHeaders() {
  const key = getApiKey();
  if (!key) throw new Error("Missing admin API key");
  return {
    "Content-Type": "application/json",
    "x-api-key": key
  };
}

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
