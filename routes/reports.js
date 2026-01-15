// routes/reports.js
import express from "express";
import ExcelJS from "exceljs";
import { requireAdminKey } from "../utils/auth.js";
import { q } from "../utils/db.js";
import { sendEmail } from "../utils/email.js";

const router = express.Router();

// Internal helper
function toCsv(rows) {
  const header = ["at","device_id","user_id","event_type","details"];
  const escapeVal = (v) => `"${String(v).replace(/"/g,"''")}"`;
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      escapeVal(r.at), escapeVal(r.device_id),
      escapeVal(r.user_id), escapeVal(r.event_type),
      escapeVal(r.details)
    ].join(","));
  }
  return lines.join("\n");
}

// GET reports JSON
router.get("/events", requireAdminKey, async (req, res) => {
  const { deviceId, userId, from, to } = req.query;
  const params = [], where = [];
  if (deviceId) { where.push("device_id=$" + (params.length+1)); params.push(deviceId); }
  if (userId) { where.push("user_id=$" + (params.length+1)); params.push(userId); }
  if (from) { where.push("at>=$" + (params.length+1)); params.push(from); }
  if (to) { where.push("at<=$" + (params.length+1)); params.push(to); }

  const rows = (await q(
    `SELECT * FROM device_events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC`,
    params
  )).rows;
  res.json(rows);
});

// CSV export
router.get("/events/export.csv", requireAdminKey, async (req, res) => {
  const rows = (await q("SELECT * FROM device_events ORDER BY at DESC")).rows;
  const csv = toCsv(rows);
  res.setHeader("Content-Disposition","attachment; filename=events.csv");
  res.send(csv);
});

// XLSX export
router.get("/events/export.xlsx", requireAdminKey, async (req, res) => {
  const rows = (await q("SELECT * FROM device_events ORDER BY at DESC")).rows;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Events");
  ws.columns = [
    { header: "Time", key: "at" },
    { header: "Device ID", key: "device_id" },
    { header: "User ID", key: "user_id" },
    { header: "Type", key: "event_type" },
    { header: "Details", key: "details" },
  ];
  rows.forEach(r => ws.addRow(r));
  res.setHeader("Content-Disposition","attachment; filename=events.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

// Email report
router.post("/events/email", requireAdminKey, async (req, res) => {
  const { to, deviceId, userId, from, toDate } = req.body || {};
  if (!to) return res.status(400).json({ error: "Recipient email required" });

  const rows = (await q(
    `SELECT * FROM device_events
     WHERE ($1 IS NULL OR device_id=$1)
       AND ($2 IS NULL OR user_id=$2)
       AND ($3 IS NULL OR at>=$3)
       AND ($4 IS NULL OR at<=$4)
     ORDER BY at DESC`,
    [deviceId || null, userId || null, from || null, toDate || null]
  )).rows;

  const csv = toCsv(rows);
  const ok = await sendEmail(to, "Events Report", csv);
  res.json({ sent: ok });
});

export default router;
