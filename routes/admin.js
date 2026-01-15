// routes/admin.js
import express from "express";
import { requireAdminKey } from "../utils/auth.js";
import { q } from "../utils/db.js";

const router = express.Router();

// Purge old events
router.post("/admin/purge-events", requireAdminKey, async (req, res) => {
  const days = Number(req.body?.olderThanDays);
  if (!days || days < 1) return res.status(400).json({ error: "Invalid days" });

  const r = await q(
    "DELETE FROM device_events WHERE at < (now() - make_interval(days=> $1))",
    [days]
  );
  res.json({ deleted: r.rowCount });
});

// Build tag
router.get("/__build", requireAdminKey, (req, res) => {
  res.json({ buildTag: process.env.BUILD_TAG || "local-dev" });
});

export default router;
