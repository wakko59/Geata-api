// routes/events.js
import express from "express";
import { requireAdminKey } from "../utils/auth.js";
import { q } from "../utils/db.js";

const router = express.Router();

// GET device events
router.get("/devices/:id/events", requireAdminKey, async (req, res) => {
  const { id } = req.params;
  const limit = Number(req.query.limit) || 50;
  const rows = (await q(
    `SELECT * FROM device_events WHERE device_id=$1 ORDER BY at DESC LIMIT $2`,
    [id, limit]
  )).rows;
  res.json(rows);
});

// GET admin alerts
router.get("/admin/alerts", requireAdminKey, async (req, res) => {
  const { deviceId, userId, from, to, limit } = req.query;
  const params = [];
  let where = "WHERE 1=1";

  if (deviceId) { where += ` AND device_id=$${params.length+1}`; params.push(deviceId); }
  if (userId) { where += ` AND user_id=$${params.length+1}`; params.push(userId); }
  if (from) { where += ` AND at>=$${params.length+1}`; params.push(from); }
  if (to) { where += ` AND at<=$${params.length+1}`; params.push(to); }

  const rows = (await q(
    `SELECT * FROM device_events ${where} ORDER BY at DESC LIMIT $${params.length+1}`,
    [...params, Number(limit) || 500]
  )).rows;
  res.json(rows);
});

export default router;
