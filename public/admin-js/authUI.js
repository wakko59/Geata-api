// admin-js/authUI.js
import { $, setStatus } from "./helpers.js";
import { apiJson, getApiKey } from "./api.js";

export function initAuthUI() {
  $("authApiKey").value = getApiKey();

  $("authSaveKey").addEventListener("click", () => {
    const key = $("authApiKey").value.trim();
    localStorage.setItem("geata_admin_api_key", key);
    setStatus($("authStatus"), key ? "API key saved" : "API key cleared", false);
  });

  $("authClearKey").addEventListener("click", () => {
    localStorage.removeItem("geata_admin_api_key");
    $("authApiKey").value = "";
    setStatus($("authStatus"), "API key cleared", false);
  });

  $("bootstrapBtn").addEventListener("click", async () => {
    setStatus($("bootstrapStatus"), "Loading…", false);
    try {
      await apiJson("/devices");
      await apiJson("/users");
      await apiJson("/schedules");
      setStatus($("bootstrapStatus"), "Bootstrap complete", false);
    } catch (e) {
      setStatus($("bootstrapStatus"), "Load failed: " + e.message, true);
    }
  });
}
