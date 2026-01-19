// routes/devices.js
import express from "express";
import { requireAdminKey, requireUser } from "../utils/auth.js";
import { one, q } from "../utils/db.js";
import { normalizePhone } from "../utils/helpers.js";
import { notFound, badRequest } from "../utils/errors.js";

const router = express.Router();

// GET all devices (admin)
router.get("/devices", requireAdminKey, async (req, res) => {
  const r = await q("SELECT id,name FROM devices ORDER BY id");
  res.json(r.rows);
});

// POST new device (admin)
router.post("/devices", requireAdminKey, async (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !name) return badRequest(res, "id and name required");

  const exists = await one("SELECT 1 FROM devices WHERE id=$1", [id]);
  if (exists) return badRequest(res, "Device id already exists");

  await q("INSERT INTO devices (id,name) VALUES($1,$2)", [id, name]);
  res.status(201).json({ id, name });
});

// GET device users
router.get("/devices/:id/users", requireAdminKey, async (req, res) => {
  const { id } = req.params;
  const dev = await one("SELECT id FROM devices WHERE id=$1", [id]);
  if (!dev) return notFound(res, "device");

  const r = await q(
    `SELECT du.user_id AS "userId", du.role, du.schedule_id AS "scheduleId",
            u.name, u.email, u.phone
     FROM device_users du
     JOIN users u ON u.id = du.user_id
     WHERE du.device_id=$1`,
    [id]
  );
  res.json(r.rows);
});

// POST attach user to device
router.post("/devices/:id/users", requireAdminKey, async (req, res) => {
  const { id: deviceId } = req.params;
  const { userId, name, email, phone, password, role } = req.body || {};

  const dev = await one("SELECT id FROM devices WHERE id=$1", [deviceId]);
  if (!dev) return notFound(res, "device");

  // Must specify either existing userId or new user details
  if (!userId && !email && !phone)
    return badRequest(res, "Provide userId or email/phone");

  let user = null;
  if (userId) user = await one("SELECT * FROM users WHERE id=$1", [userId]);
  if (!user && email) user = await one("SELECT * FROM users WHERE email=$1", [email]);
  if (!user && phone)
    user = await one("SELECT * FROM users WHERE phone=$1", [normalizePhone(phone)]);

  // Create user if not found
  if (!user) {
    const newId = randomId("u");
    const p = normalizePhone(phone);
    await q(
      "INSERT INTO users (id,name,email,phone,password_hash) VALUES($1,$2,$3,$4,$5)",
      [newId, name || email || p, email || null, p, password || null]
    );
    user = await one("SELECT * FROM users WHERE id=$1", [newId]);
  }

  // Link user to device
  const r = await q(
    "INSERT INTO device_users(device_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [deviceId, user.id, role || "operator"]
  );

  res.status(201).json({ deviceId, user, role: role || "operator" });
});

// DELETE detach user
router.delete("/devices/:id/users/:userId", requireAdminKey, async (req, res) => {
  const { id: deviceId, userId } = req.params;
  const r = await q(
    "DELETE FROM device_users WHERE device_id=$1 AND user_id=$2",
    [deviceId, userId]
  );
  if (r.rowCount === 0) return notFound(res, "membership");
  res.json({ status: "removed" });
});

// GET device settings (admin)
router.get("/devices/:id/settings", requireAdminKey, async (req, res) => {
  const { id } = req.params;
  const r = await q("SELECT settings FROM device_settings WHERE device_id=$1", [id]);
  if (!r.rows.length) return res.json({});
  res.json(r.rows[0].settings || {});
});

// PUT device settings (admin)
router.put("/devices/:id/settings", requireAdminKey, async (req, res) => {
  const { id } = req.params;
  const settings = req.body || {};
  const r = await q(
    `
    INSERT INTO device_settings(device_id,settings,updated_at)
    VALUES($1,$2,now())
    ON CONFLICT(device_id) DO UPDATE SET settings=$2,updated_at=now()
    RETURNING settings
    `,
    [id, settings]
  );
  res.json(r.rows[0].settings || {});
});
// =========================
// User–Gate Nested Routes
// =========================

// GET current schedule assignment for a user at a gate
router.get(
  "/devices/:deviceId/users/:userId/schedule-assignment",
  requireAdminKey,
  async (req, res) => {
    const { deviceId, userId } = req.params;
    const r = await one(
      `SELECT schedule_id FROM device_users WHERE device_id=$1 AND user_id=$2`,
      [deviceId, userId]
    );
    res.json({ scheduleId: r?.schedule_id || null });
  }
);

// PUT update schedule assignment
router.put(
  "/devices/:deviceId/users/:userId/schedule-assignment",
  requireAdminKey,
  async (req, res) => {
    const { deviceId, userId } = req.params;
    let { scheduleId } = req.body || {};
    const sid =
      scheduleId === "" || scheduleId === null ? null : scheduleId;

    try {
      console.log("Saving schedule assignment:", {
        deviceId,
        userId,
        scheduleId: sid,
      });

      // First try to UPDATE if row exists
      const result = await q(
        `UPDATE device_users
           SET schedule_id = $1
         WHERE device_id = $2
           AND user_id = $3
         RETURNING device_id`,
        [sid, deviceId, userId]
      );

      if (result.rowCount === 0) {
        // Row did not exist, so INSERT with a default role
        const defaultRole = "operator"; // or "administrator" if you prefer
        await q(
          `INSERT INTO device_users (device_id, user_id, role, schedule_id)
           VALUES ($1, $2, $3, $4)`,
          [deviceId, userId, defaultRole, sid]
        );
      }

      res.json({ deviceId, userId, scheduleId: sid });
    } catch (err) {
      console.error("PUT schedule-assignment failed:", err);
      res
        .status(500)
        .json({ error: "Failed to save schedule assignment" });
    }
  }
);



// GET current notifications (event types) for a user at a gate
router.get(
  "/devices/:deviceId/users/:userId/notifications",
  requireAdminKey,
  async (req, res) => {
    const { deviceId, userId } = req.params;
    const r = await q(
      `SELECT event_type FROM device_notifications_subscriptions
       WHERE device_id=$1 AND user_id=$2 AND enabled=TRUE`,
      [deviceId, userId]
    );
    const eventTypes = r.rows.map(r => r.event_type);
    res.json({ eventTypes });
  }
);

// PUT update notifications
router.put(
  "/devices/:deviceId/users/:userId/notifications",
  requireAdminKey,
  async (req, res) => {
    const { deviceId, userId } = req.params;
    const { eventTypes } = req.body || {};
    if (!Array.isArray(eventTypes))
      return badRequest(res, "eventTypes must be an array");

    // Delete old subscriptions
    await q(
      `DELETE FROM device_notifications_subscriptions
       WHERE device_id=$1 AND user_id=$2`,
      [deviceId, userId]
    );

    // Insert new ones
    for (const eventType of eventTypes) {
      await q(
        `INSERT INTO device_notifications_subscriptions (device_id, user_id, event_type, enabled)
         VALUES ($1, $2, $3, TRUE)`,
        [deviceId, userId, eventType]
      );
    }

    res.json({ eventTypes });
  }
);


export default router;
