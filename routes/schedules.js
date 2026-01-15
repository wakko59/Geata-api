// routes/schedules.js
import express from "express";
import { requireAdminKey } from "../utils/auth.js";
import { one, q } from "../utils/db.js";
import { badRequest } from "../utils/errors.js";

const router = express.Router();

// GET schedules
router.get("/schedules", requireAdminKey, async (req, res) => {
  const rows = (await q("SELECT * FROM schedules ORDER BY LOWER(name)")).rows;
  const out = [];
  for (const r of rows) {
    const slots = (await q("SELECT * FROM schedule_slots WHERE schedule_id=$1", [r.id])).rows;
    out.push({ ...r, slots });
  }
  res.json(out);
});

// POST schedule
router.post("/schedules", requireAdminKey, async (req, res) => {
  const { name, description, slots } = req.body || {};
  if (!name) return badRequest(res, "name required");

  const createdAt = new Date().toISOString();
  const info = await q(
    "INSERT INTO schedules(name,description,created_at) VALUES($1,$2,$3) RETURNING id",
    [name, description, createdAt]
  );

  const scheduleId = info.rows[0].id;
  for (const s of slots || []) {
    await q(
      "INSERT INTO schedule_slots(schedule_id,days_of_week,start,end) VALUES($1,$2,$3,$4)",
      [scheduleId, JSON.stringify(s.daysOfWeek || []), s.start, s.end]
    );
  }
  res.status(201).json({ id: scheduleId });
});

export default router;
