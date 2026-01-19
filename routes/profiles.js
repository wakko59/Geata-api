// routes/profiles.js
import express from "express";
import { requireAdminKey } from "../utils/auth.js";
import { q } from "../utils/db.js";

const router = express.Router();

// GET full user profile with devices + schedule + alerts
router.get("/profiles/users/:id", requireAdminKey, async (req, res) => {
  const { id } = req.params;

  try {
    // Load user info
    const userResult = await q(
      "SELECT id, name, email, phone FROM users WHERE id = $1",
      [id]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userResult.rows[0];

   // Load enrolled devices for this user
const devResult = await q(
  `SELECT
     du.device_id        AS device_id,
     d.name              AS device_name,
     du.role             AS role,
     du.schedule_id      AS schedule_id
   FROM device_users du
   INNER JOIN devices d
      ON d.id = du.device_id
   WHERE du.user_id = $1
   ORDER BY du.device_id`,
  [id]
);


    const devices = devResult.rows.map((r) => ({
      deviceId: r.device_id,
      deviceName: r.device_name,
      role: r.role,
      scheduleId: r.schedule_id,
      notifications: { eventTypes: [] }, // fill below
    }));

    // Fetch alert subscriptions per device
    for (let dev of devices) {
      const notifResult = await q(
        `SELECT event_type
         FROM device_notifications_subscriptions
         WHERE user_id = $1 AND device_id = $2 AND enabled = TRUE`,
        [id, dev.deviceId]
      );
      dev.notifications.eventTypes = notifResult.rows.map(r => r.event_type);
    }

    res.json({ user, devices });

  } catch (err) {
    console.error("GET /profiles/users/:id error:", err);
    res.status(500).json({ error: "Failed to load full profile" });
  }
});

export default router;
