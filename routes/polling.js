// routes/polling.js
import express from "express";
import { one, q } from "../utils/db.js";
import { safeCompare } from "../utils/helpers.js";

const router = express.Router();

router.post("/device/poll", async (req, res) => {
  const { deviceId, secret, lastResults } = req.body || {};
  if (!deviceId || !secret) return res.status(400).json({ error: "deviceId and secret required" });

  const dev = await one("SELECT id FROM devices WHERE id=$1", [deviceId]);
  if (!dev) return res.status(404).json({ error: "Device not registered" });

  const row = await one("SELECT secret FROM device_secrets WHERE device_id=$1", [deviceId]);
  if (!row || !safeCompare(row.secret, secret)) {
    return res.status(401).json({ error: "Unauthorized device" });
  }

  // Complete previous commands & log events
  const results = Array.isArray(lastResults) ? lastResults : [];
  for (const r of results) {
    if (r?.commandId) {
      const cmd = await q(
        `UPDATE commands SET status='completed', completed_at=now(), result=$1
         WHERE id=$2 AND device_id=$3 RETURNING *`,
        [r.result, r.commandId, deviceId]
      );
      if (cmd.rows[0]) {
        await q(
          `INSERT INTO device_events(device_id,user_id,event_type,at,details)
           VALUES ($1,$2,'CMD_COMPLETED',now(),$3)`,
          [deviceId, cmd.rows[0].user_id, `${cmd.rows[0].type} result=${r.result}`]
        );
      }
    }
  }

  // Return queued commands
  const queued = (await q(
    "SELECT id,type,duration_ms FROM commands WHERE device_id=$1 AND status='queued' ORDER BY requested_at ASC",
    [deviceId]
  )).rows;

  res.json({
    commands: queued.map((c) => ({
      commandId: c.id,
      type: c.type,
      durationMs: c.duration_ms,
    })),
  });
});

export default router;
