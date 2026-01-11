// index.js (Postgres / Supabase + Email Notifications)
// Profile-driven admin endpoint: GET /profiles/users/:id (no N+1 queries)
//
// Requires: npm i pg nodemailer bcryptjs jsonwebtoken express

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const BUILD_TAG = process.env.BUILD_TAG || "local-dev";


// Root -> serve admin UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "dev-only-admin-key";
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-jwt-secret";
const PORT = process.env.PORT || 3000;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn("*** WARNING: DATABASE_URL is not set (Postgres will not connect). ***");
}

// ---- Postgres pool (Supabase) ----
const PGSSL = String(process.env.PGSSL || "").toLowerCase() === "true";
const useSSL = PGSSL || process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
async function q(text, params = []) {
  return pool.query(text, params);
}
async function one(text, params = []) {
  const r = await q(text, params);
  return r.rows[0] || null;
}

// ---- SMTP / Email ----
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465;
const SMTP_SECURE = String(process.env.SMTP_SECURE || "true").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `Geata <${SMTP_USER}>` : "Geata");

const mailer =
  SMTP_HOST && SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      })
    : null;

console.log("SMTP env present:", {
  host: !!SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  user: !!SMTP_USER,
  pass: !!SMTP_PASS
});

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const SENDGRID_FROM = process.env.SENDGRID_FROM || process.env.SMTP_FROM || "";
const USE_SENDGRID = !!SENDGRID_API_KEY;

function parseFrom(from) {
  const m = String(from || "").match(/^(.*)<([^>]+)>$/);
  if (m) return { name: m[1].trim() || "Geata", email: m[2].trim() };
  return { name: "Geata", email: String(from || "").trim() };
}

async function sendEmail(to, subject, text) {
  if (!to) return false;

  if (USE_SENDGRID) {
    try {
      const from = parseFrom(SENDGRID_FROM);
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from.email, name: from.name },
          subject,
          content: [{ type: "text/plain", value: text }]
        })
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn("SendGrid send failed:", res.status, body);
        return false;
      }
      return true;
    } catch (err) {
      console.warn("SendGrid send exception:", err?.message || err);
      return false;
    }
  }

  if (!mailer) return false;
  try {
    await mailer.sendMail({ from: SMTP_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.warn("Email send failed:", err?.message || err);
    return false;
  }
}

async function verifyMailer() {
  if (USE_SENDGRID) {
    console.log("Email enabled: SendGrid", {
      fromSet: !!SENDGRID_FROM,
      apiKeySet: !!SENDGRID_API_KEY
    });
    return;
  }

  if (!mailer) {
    console.log("Email disabled: SMTP_* env vars not set");
    return;
  }

  try {
    await mailer.verify();
    console.log(`Email enabled: SMTP OK as ${SMTP_USER} via ${SMTP_HOST}:${SMTP_PORT} secure=${SMTP_SECURE}`);
  } catch (err) {
    console.log("Email configured but verify FAILED:", err?.message || err);
  }
}

// ---- Helpers ----
function normalizePhone(raw) {
  if (!raw) return null;
  return String(raw).trim();
}

function randomId(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
}

function shortHash(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex").slice(0, 10);
}

// ---- DB INIT ----
async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS devices (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE,
      phone         TEXT,
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_slots (
      id           INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      schedule_id  INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      days_of_week TEXT,
      start        TEXT NOT NULL,
      "end"        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_users (
      device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
      PRIMARY KEY (device_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS commands (
      id           TEXT PRIMARY KEY,
      device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      result       TEXT,
      duration_ms  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_settings (
      device_id  TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
      settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS device_events (
      id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      at         TEXT NOT NULL,
      details    TEXT
    );

    CREATE TABLE IF NOT EXISTS device_notification_subscriptions (
      device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (device_id, user_id, event_type)
    );

    CREATE INDEX IF NOT EXISTS idx_device_users_user ON device_users(user_id);
    CREATE INDEX IF NOT EXISTS idx_commands_device_status_req ON commands(device_id, status, requested_at);
    CREATE INDEX IF NOT EXISTS idx_device_events_device_at ON device_events(device_id, at);
    CREATE INDEX IF NOT EXISTS idx_device_events_user_at ON device_events(user_id, at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_notify_device_event ON device_notification_subscriptions(device_id, event_type);
  `);

  const row = await one("SELECT COUNT(*)::int AS c FROM devices");
  if ((row?.c || 0) === 0) {
    await q(
      `INSERT INTO devices (id, name) VALUES ($1,$2),($3,$4)
       ON CONFLICT (id) DO NOTHING`,
      ["gate1", "Example Gate 1", "gate2", "Example Gate 2"]
    );
  }
}

// ---- Data Access ----

// Devices
async function getDevices() {
  const r = await q("SELECT id, name FROM devices ORDER BY id");
  return r.rows;
}
async function getDeviceById(id) {
  return one("SELECT id, name FROM devices WHERE id = $1", [id]);
}
async function createDevice(id, name) {
  await q("INSERT INTO devices (id, name) VALUES ($1, $2)", [id, name]);
  return getDeviceById(id);
}

// Users
async function getUserById(id) {
  return one("SELECT * FROM users WHERE id = $1", [id]);
}
async function getUserByEmail(email) {
  if (!email) return null;
  return one("SELECT * FROM users WHERE email = $1", [email]);
}
async function getUserByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return one("SELECT * FROM users WHERE phone = $1", [p]);
}
async function createUser({ name, email, phone, password }) {
  const id = randomId("u");
  const normalizedPhone = normalizePhone(phone);
  const hash = password ? bcrypt.hashSync(password, 10) : null;

  await q(
    "INSERT INTO users (id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5)",
    [id, name || email || normalizedPhone || id, email || null, normalizedPhone || null, hash]
  );
  return getUserById(id);
}
async function updateUser(id, { name, email, phone, password }) {
  const user = await getUserById(id);
  if (!user) return null;

  const newName = name != null && name !== "" ? name : user.name;
  const newEmail = email != null && email !== "" ? email : user.email;
  const newPhone = phone != null && phone !== "" ? normalizePhone(phone) : user.phone;

  let newHash = user.password_hash;
  if (password && password.length > 0) {
    newHash = bcrypt.hashSync(password, 10);
  }

  await q("UPDATE users SET name=$1, email=$2, phone=$3, password_hash=$4 WHERE id=$5", [
    newName,
    newEmail,
    newPhone,
    newHash,
    id
  ]);

  return getUserById(id);
}
async function deleteUser(id) {
  await q("DELETE FROM device_users WHERE user_id = $1", [id]);
  await q("DELETE FROM users WHERE id = $1", [id]);
}
async function searchUsers(qstr) {
  if (!qstr) {
    const r = await q("SELECT * FROM users ORDER BY LOWER(name)");
    return r.rows;
  }
  const pattern = "%" + qstr + "%";
  const r = await q(
    `
    SELECT *
    FROM users
    WHERE name  ILIKE $1
       OR email ILIKE $1
       OR phone ILIKE $1
       OR id    ILIKE $1
    ORDER BY LOWER(name)
    `,
    [pattern]
  );
  return r.rows;
}

// Device-users
async function attachUserToDevice(deviceId, userId, role) {
  const rRole = role || "operator";
  await q(
    `
    INSERT INTO device_users (device_id, user_id, role)
    VALUES ($1,$2,$3)
    ON CONFLICT (device_id, user_id) DO NOTHING
    `,
    [deviceId, userId, rRole]
  );
  return { deviceId, userId, role: rRole };
}
async function detachUserFromDevice(deviceId, userId) {
  const r = await q("DELETE FROM device_users WHERE device_id=$1 AND user_id=$2", [deviceId, userId]);
  return r.rowCount > 0;
}
async function setDeviceUserSchedule(deviceId, userId, scheduleId) {
  await q(
    `
    UPDATE device_users
    SET schedule_id = $1
    WHERE device_id = $2 AND user_id = $3
    `,
    [scheduleId || null, deviceId, userId]
  );
}
async function listDeviceUsers(deviceId) {
  const r = await q(
    `
    SELECT
      du.user_id     AS "userId",
      du.role        AS "role",
      du.schedule_id AS "scheduleId",
      u.name         AS "name",
      u.email        AS "email",
      u.phone        AS "phone"
    FROM device_users du
    LEFT JOIN users u ON u.id = du.user_id
    WHERE du.device_id = $1
    ORDER BY LOWER(u.name)
    `,
    [deviceId]
  );
  return r.rows;
}
async function listUserDevices(userId) {
  const r = await q(
    `
    SELECT du.device_id AS "deviceId",
           du.role      AS "role"
    FROM device_users du
    WHERE du.user_id = $1
    ORDER BY du.device_id
    `,
    [userId]
  );
  return r.rows;
}
async function isUserOnDevice(deviceId, userId) {
  const row = await one("SELECT 1 AS present FROM device_users WHERE device_id=$1 AND user_id=$2", [deviceId, userId]);
  return !!row;
}
async function getDeviceUserScheduleId(deviceId, userId) {
  const row = await one("SELECT schedule_id FROM device_users WHERE device_id=$1 AND user_id=$2", [deviceId, userId]);
  return row ? row.schedule_id : null;
}

// Schedules
async function getScheduleSlots(scheduleId) {
  const r = await q(
    `
    SELECT id, schedule_id, days_of_week, start, "end" AS end
    FROM schedule_slots
    WHERE schedule_id = $1
    ORDER BY id
    `,
    [scheduleId]
  );
  return r.rows;
}
async function getScheduleById(id) {
  const row = await one("SELECT id, name, description, created_at FROM schedules WHERE id = $1", [id]);
  if (!row) return null;

  const slotsRows = await getScheduleSlots(id);
  const slots = slotsRows.map(s => ({
    id: s.id,
    scheduleId: s.schedule_id,
    daysOfWeek: s.days_of_week ? JSON.parse(s.days_of_week) : [],
    start: s.start,
    end: s.end
  }));

  return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at, slots };
}
async function listSchedules() {
  const r = await q("SELECT id, name, description, created_at FROM schedules ORDER BY LOWER(name)");
  const out = [];
  for (const sched of r.rows) {
    const slotsRows = await getScheduleSlots(sched.id);
    const slots = slotsRows.map(s => ({
      id: s.id,
      scheduleId: s.schedule_id,
      daysOfWeek: s.days_of_week ? JSON.parse(s.days_of_week) : [],
      start: s.start,
      end: s.end
    }));
    out.push({ id: sched.id, name: sched.name, description: sched.description, createdAt: sched.created_at, slots });
  }
  return out;
}
async function createSchedule({ name, description, slots }) {
  const createdAt = new Date().toISOString();
  const info = await one(
    `
    INSERT INTO schedules (name, description, created_at)
    VALUES ($1,$2,$3)
    RETURNING id
    `,
    [name, description || null, createdAt]
  );
  const scheduleId = info.id;

  if (Array.isArray(slots)) {
    for (const s of slots) {
      const daysJson =
        Array.isArray(s.daysOfWeek) && s.daysOfWeek.length > 0 ? JSON.stringify(s.daysOfWeek) : null;

      await q(`INSERT INTO schedule_slots (schedule_id, days_of_week, start, "end") VALUES ($1,$2,$3,$4)`, [
        scheduleId,
        daysJson,
        s.start,
        s.end
      ]);
    }
  }
  return getScheduleById(scheduleId);
}
async function updateSchedule(id, { name, description, slots }) {
  const existing = await getScheduleById(id);
  if (!existing) return null;

  await q("UPDATE schedules SET name=$1, description=$2 WHERE id=$3", [name || existing.name, description || null, id]);
  await q("DELETE FROM schedule_slots WHERE schedule_id = $1", [id]);

  if (Array.isArray(slots)) {
    for (const s of slots) {
      const daysJson =
        Array.isArray(s.daysOfWeek) && s.daysOfWeek.length > 0 ? JSON.stringify(s.daysOfWeek) : null;

      await q(`INSERT INTO schedule_slots (schedule_id, days_of_week, start, "end") VALUES ($1,$2,$3,$4)`, [
        id,
        daysJson,
        s.start,
        s.end
      ]);
    }
  }
  return getScheduleById(id);
}
async function deleteSchedule(id) {
  await q("UPDATE device_users SET schedule_id = NULL WHERE schedule_id = $1", [id]);
  await q("DELETE FROM schedule_slots WHERE schedule_id = $1", [id]);
  await q("DELETE FROM schedules WHERE id = $1", [id]);
}

// Schedule check
async function isUserAllowedNow(deviceId, userId, now) {
  now = now || new Date();

  if (!(await isUserOnDevice(deviceId, userId))) return false;

  const scheduleId = await getDeviceUserScheduleId(deviceId, userId);
  if (!scheduleId) return true; // 24/7

  const sched = await getScheduleById(scheduleId);
  if (!sched || !sched.slots || sched.slots.length === 0) return false;

  const day = now.getDay(); // 0–6
  const hh = now.getHours();
  const mm = now.getMinutes();
  const pad = n => (n < 10 ? "0" + n : "" + n);
  const timeStr = pad(hh) + ":" + pad(mm);

  for (const s of sched.slots) {
    const days = Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [];
    if (days.length > 0 && days.indexOf(day) === -1) continue;
    if (s.start && timeStr < s.start) continue;
    if (s.end && timeStr > s.end) continue;
    return true;
  }
  return false;
}

// ---- Notifications (subscriptions) ----
async function setUserSubscriptions(deviceId, userId, eventTypes) {
  const evs = Array.isArray(eventTypes) ? eventTypes.map(String) : [];
  await q("DELETE FROM device_notification_subscriptions WHERE device_id=$1 AND user_id=$2", [deviceId, userId]);

  for (const ev of evs) {
    const clean = (ev || "").trim();
    if (!clean) continue;
    await q(
      `
      INSERT INTO device_notification_subscriptions (device_id, user_id, event_type, enabled)
      VALUES ($1,$2,$3,TRUE)
      ON CONFLICT (device_id, user_id, event_type) DO UPDATE SET enabled = TRUE
      `,
      [deviceId, userId, clean]
    );
  }
}

async function getSubscribedEmails(deviceId, eventType) {
  const r = await q(
    `
    SELECT DISTINCT u.email
    FROM device_notification_subscriptions ns
    JOIN users u ON u.id = ns.user_id
    WHERE ns.device_id = $1
      AND ns.enabled = TRUE
      AND u.email IS NOT NULL
      AND (ns.event_type = $2 OR ns.event_type = '*')
    `,
    [deviceId, eventType]
  );
  return r.rows.map(x => x.email).filter(Boolean);
}
async function isUserSubscribed(deviceId, userId, eventType) {
  const row = await one(
    `
    SELECT 1
    FROM device_notification_subscriptions
    WHERE device_id=$1
      AND user_id=$2
      AND enabled=TRUE
      AND (event_type=$3 OR event_type='*')
    LIMIT 1
    `,
    [deviceId, userId, eventType]
  );
  return !!row;
}

// ---- Profile (admin) ----
// Efficient, stable profile payload for admin.html.
// Returns:
// { user:{id,name,email,phone}, devices:[{deviceId,deviceName,role,scheduleAssignment,schedule,notifications}] }
async function getUserProfile(userId) {
  const user = await one(
    `SELECT id, name, email, phone
     FROM users
     WHERE id = $1`,
    [userId]
  );
  if (!user) return null;

  const row = await one(
    `
    WITH device_rows AS (
      SELECT
        du.device_id,
        d.name AS device_name,
        du.role,
        du.schedule_id
      FROM device_users du
      JOIN devices d ON d.id = du.device_id
      WHERE du.user_id = $1
    ),
    subs AS (
      SELECT
        ns.device_id,
        json_agg(ns.event_type ORDER BY ns.event_type) AS event_types
      FROM device_notification_subscriptions ns
      WHERE ns.user_id = $1
        AND ns.enabled = TRUE
      GROUP BY ns.device_id
    ),
    sched AS (
      SELECT
        s.id,
        s.name,
        s.description,
        s.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ss.id,
              'daysOfWeek', COALESCE(ss.days_of_week::json, '[]'::json),
              'start', ss.start,
              'end', ss."end"
            )
            ORDER BY ss.id
          ) FILTER (WHERE ss.id IS NOT NULL),
          '[]'::json
        ) AS slots
      FROM schedules s
      LEFT JOIN schedule_slots ss ON ss.schedule_id = s.id
      GROUP BY s.id
    )
    SELECT
      COALESCE(
        json_agg(
          json_build_object(
            'deviceId', dr.device_id,
            'deviceName', dr.device_name,
            'role', dr.role,

            'scheduleAssignment', json_build_object(
              'scheduleId', dr.schedule_id,
              'mode', CASE WHEN dr.schedule_id IS NULL THEN 'ALWAYS' ELSE 'SCHEDULE' END
            ),

            'schedule',
              CASE
                WHEN dr.schedule_id IS NULL THEN NULL
                ELSE json_build_object(
                  'id', sc.id,
                  'name', sc.name,
                  'description', sc.description,
                  'createdAt', sc.created_at,
                  'slots', sc.slots
                )
              END,

            'notifications', json_build_object(
              'eventTypes', COALESCE(sb.event_types, '[]'::json)
            )
          )
          ORDER BY dr.device_id
        ),
        '[]'::json
      ) AS devices
    FROM device_rows dr
    LEFT JOIN subs sb ON sb.device_id = dr.device_id
    LEFT JOIN sched sc ON sc.id = dr.schedule_id
    `,
    [userId]
  );

  return { user, devices: row?.devices || [] };
}

// ---- Commands & events ----
async function logDeviceEvent(deviceId, eventType, opts) {
  opts = opts || {};
  const userId = opts.userId || null;
  const details = opts.details || null;
  const at = new Date().toISOString();

  await q(
    `INSERT INTO device_events (device_id, user_id, event_type, at, details)
     VALUES ($1,$2,$3,$4,$5)`,
    [deviceId, userId, eventType, at, details]
  );

  setImmediate(() => {
    notifyEventByEmail({ deviceId, eventType, at, userId, details }).catch(err =>
      console.warn("notifyEventByEmail failed:", err?.message || err)
    );
  });
}

function buildEmailSubject(ev) {
  return `Geata: ${ev.deviceId} ${ev.eventType}`;
}
function buildEmailBody(ev) {
  const lines = [
    `Device: ${ev.deviceId}`,
    `Event: ${ev.eventType}`,
    `Time (UTC): ${ev.at}`,
    ev.details ? `Details: ${ev.details}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

const ALWAYS_NOTIFY_USER_EVENTS = new Set([
  "OPEN_REQUESTED",
  "AUX1_REQUESTED",
  "AUX2_REQUESTED",
  "CMD_COMPLETED",
  "ACCESS_DENIED_NOT_ASSIGNED",
  "ACCESS_DENIED_SCHEDULE",
  "AUX1_DENIED_NOT_ASSIGNED",
  "AUX1_DENIED_SCHEDULE",
  "AUX2_DENIED_NOT_ASSIGNED",
  "AUX2_DENIED_SCHEDULE"
]);

function emailEnabled() {
  if (USE_SENDGRID) return !!SENDGRID_API_KEY && !!SENDGRID_FROM;
  return !!mailer;
}

async function notifyEventByEmail(ev) {
  if (!emailEnabled()) return;

  const recipients = new Set();

  const subscribed = await getSubscribedEmails(ev.deviceId, ev.eventType);
  subscribed.forEach(e => recipients.add(e));

  if (ev.userId && ALWAYS_NOTIFY_USER_EVENTS.has(ev.eventType)) {
    const wantsIt = await isUserSubscribed(ev.deviceId, ev.userId, ev.eventType);
    if (wantsIt) {
      const u = await getUserById(ev.userId);
      if (u?.email) recipients.add(u.email);
    }
  }

  if (recipients.size === 0) return;

  const subject = buildEmailSubject(ev);
  const text = buildEmailBody(ev);

  for (const to of recipients) {
    await sendEmail(to, subject, text);
  }
}

async function createCommand(deviceId, userId, type, durationMs) {
  const id = randomId("cmd");
  const nowIso = new Date().toISOString();

  await q(
    `INSERT INTO commands
      (id, device_id, user_id, type, status, requested_at, completed_at, result, duration_ms)
     VALUES ($1,$2,$3,$4,'queued',$5,NULL,NULL,$6)`,
    [id, deviceId, userId || null, type, nowIso, durationMs]
  );

  await logDeviceEvent(deviceId, "CMD_REQUESTED", {
    userId: userId || null,
    details: `type=${type};durationMs=${durationMs}`
  });

  return {
    id,
    deviceId,
    userId: userId || null,
    type,
    status: "queued",
    requestedAt: nowIso,
    completedAt: null,
    result: null,
    durationMs
  };
}

async function getQueuedCommands(deviceId) {
  const r = await q(
    `SELECT * FROM commands
     WHERE device_id=$1 AND status='queued'
     ORDER BY requested_at ASC`,
    [deviceId]
  );
  return r.rows;
}

async function completeCommand(deviceId, commandId, result) {
  const nowIso = new Date().toISOString();
  await q(
    `UPDATE commands
     SET status='completed', completed_at=$1, result=$2
     WHERE id=$3 AND device_id=$4 AND status='queued'`,
    [nowIso, result || null, commandId, deviceId]
  );
  return one("SELECT * FROM commands WHERE id = $1", [commandId]);
}

async function getDeviceEvents(deviceId, limit) {
  const lim = limit || 50;
  const r = await q(
    `
    SELECT
      e.id, e.device_id, e.user_id, e.event_type, e.at, e.details,
      u.name  AS user_name,
      u.phone AS user_phone
    FROM device_events e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.device_id = $1
    ORDER BY e.at DESC
    LIMIT $2
    `,
    [deviceId, lim]
  );
  return r.rows;
}

async function getEventsForReport(filters) {
  const deviceId = filters.deviceId || null;
  const userId = filters.userId || null;
  const from = filters.from || null;
  const to = filters.to || null;
  const limit = filters.limit || 500;

  let sql = `
    SELECT
      e.id, e.device_id, e.user_id, e.event_type, e.at, e.details,
      u.name  AS user_name,
      u.phone AS user_phone,
      u.email AS user_email,
      d.name  AS device_name
    FROM device_events e
    LEFT JOIN users   u ON u.id = e.user_id
    LEFT JOIN devices d ON d.id = e.device_id
    WHERE 1=1
  `;
  const params = [];
  let i = 1;

  if (deviceId) {
    sql += ` AND e.device_id = $${i++}`;
    params.push(deviceId);
  }
  if (userId) {
    sql += ` AND e.user_id = $${i++}`;
    params.push(userId);
  }
  if (from) {
    sql += ` AND e.at >= $${i++}`;
    params.push(from);
  }
  if (to) {
    sql += ` AND e.at <= $${i++}`;
    params.push(to);
  }

  sql += ` ORDER BY e.at DESC LIMIT $${i++}`;
  params.push(limit);

  const r = await q(sql, params);
  return r.rows;
}

// ---- Middleware ----
function requireAdminKey(req, res, next) {
  const key = req.header("x-api-key");
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
  }
  next();
}

function requireUser(req, res, next) {
  const auth = req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing auth token" });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ---- Routes ----

// ---- Build Tag ----
app.get("/__build", (req, res) => {
  res.json({
    buildTag: BUILD_TAG,
    node: process.version,
    time: new Date().toISOString()
  });
});


// Admin test email
app.post("/admin/test-email", requireAdminKey, asyncHandler(async (req, res) => {
  const to = (req.body && req.body.to) || SMTP_USER;
  const ok = await sendEmail(to, "Geata SMTP test", "If you got this, SMTP is working. Time: " + new Date().toISOString());
  res.json({ ok, to });
}));

// Auth
app.post("/auth/register", requireAdminKey, asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!password || (!email && !phone)) {
    return res.status(400).json({ error: "password and at least phone or email are required" });
  }

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) {
    const existingByPhone = await getUserByPhone(normalizedPhone);
    if (existingByPhone) return res.status(409).json({ error: "User with this phone already exists" });
  }
  if (email) {
    const existingByEmail = await getUserByEmail(email);
    if (existingByEmail) return res.status(409).json({ error: "User with this email already exists" });
  }

  const user = await createUser({ name, email, phone: normalizedPhone, password });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });

  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone }
  });
}));

app.post("/auth/login", asyncHandler(async (req, res) => {
  const { phone, email, password } = req.body || {};
  if ((!phone && !email) || !password) {
    return res.status(400).json({ error: "phone or email and password are required" });
  }

  let user = null;
  if (phone) user = await getUserByPhone(phone);
  else if (email) user = await getUserByEmail(email);

  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid login or password" });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid login or password" });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone }
  });
}));

// Me
app.get("/me", requireUser, asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, name: user.name, email: user.email, phone: user.phone });
}));
app.get("/me/devices", requireUser, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const r = await q(
    `
    SELECT d.id, d.name, du.role
    FROM device_users du
    JOIN devices d ON d.id = du.device_id
    WHERE du.user_id = $1
    ORDER BY d.id
    `,
    [userId]
  );

  res.json(r.rows);
}));

// Devices (admin-only)
app.get("/devices", requireAdminKey, asyncHandler(async (req, res) => {
  res.json(await getDevices());
}));

app.post("/devices", requireAdminKey, asyncHandler(async (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: "id and name are required" });

  const existing = await getDeviceById(id);
  if (existing) return res.status(409).json({ error: "Device with this id already exists" });

  const dev = await createDevice(id, name);
  res.status(201).json(dev);
}));

// Device users (admin-only)
app.get("/devices/:id/users", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });
  res.json(await listDeviceUsers(deviceId));
}));

app.post("/devices/:id/users", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  const { userId, name, email, phone, password, role } = req.body || {};
  const rRole = role || "operator";

  let user = null;

  if (userId) {
    user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found for given userId" });
    await attachUserToDevice(deviceId, user.id, rRole);
    return res.status(201).json({
      deviceId,
      userId: user.id,
      role: rRole,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone }
    });
  }

  if (!email && !phone) {
    return res.status(400).json({ error: "At least email or phone is required (or provide userId)" });
  }

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) user = await getUserByPhone(normalizedPhone);
  if (!user && email) user = await getUserByEmail(email);

  if (!user) {
    user = await createUser({ name, email, phone: normalizedPhone, password });
  } else if (password && password.length > 0) {
    user = await updateUser(user.id, {
      name: name || user.name,
      email: email || user.email,
      phone: normalizedPhone || user.phone,
      password
    });
  } else if (name || email || normalizedPhone) {
    user = await updateUser(user.id, {
      name: name || user.name,
      email: email || user.email,
      phone: normalizedPhone || user.phone,
      password: null
    });
  }

  await attachUserToDevice(deviceId, user.id, rRole);

  res.status(201).json({
    deviceId,
    userId: user.id,
    role: rRole,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone }
  });
}));

app.delete("/devices/:id/users/:userId", requireAdminKey, asyncHandler(async (req, res) => {
  const removed = await detachUserFromDevice(req.params.id, req.params.userId);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.json({ status: "removed", deviceId: req.params.id, userId: req.params.userId });
}));

app.put("/devices/:id/users/:userId/schedule-assignment", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const scheduleId = req.body && req.body.scheduleId ? Number(req.body.scheduleId) : null;
  if (scheduleId) {
    const sched = await getScheduleById(scheduleId);
    if (!sched) return res.status(404).json({ error: "Schedule not found" });
  }

  await setDeviceUserSchedule(deviceId, userId, scheduleId || null);
  res.json({ deviceId, userId, scheduleId: scheduleId || null });
}));

// Device Settings (Admin)
app.get("/devices/:deviceId/settings", requireAdminKey, async (req, res) => {
  const deviceId = req.params.deviceId;
  try {
    const r = await pool.query("select settings from public.device_settings where device_id = $1", [deviceId]);
    if (r.rows.length === 0) return res.json({});
    return res.json(r.rows[0].settings || {});
  } catch (err) {
    console.error("GET /devices/:deviceId/settings failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/devices/:deviceId/settings", requireAdminKey, async (req, res) => {
  const deviceId = req.params.deviceId;
  const settings = req.body || {};
  try {
    const r = await pool.query(
      `
      insert into public.device_settings (device_id, settings, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (device_id)
      do update set settings = excluded.settings, updated_at = now()
      returning settings
      `,
      [deviceId, JSON.stringify(settings)]
    );
    return res.json(r.rows[0].settings || {});
  } catch (err) {
    console.error("PUT /devices/:deviceId/settings failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Purge old events (Admin)
app.post("/admin/purge-events", requireAdminKey, async (req, res) => {
  const olderThanDays = Number(req.body?.olderThanDays);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
    return res.status(400).json({ error: "olderThanDays must be a number >= 1" });
  }
  try {
    const r = await pool.query(
      `delete from public.device_events
       where at < (now() - make_interval(days => $1))`,
      [olderThanDays]
    );
    return res.json({ ok: true, deleted: r.rowCount });
  } catch (err) {
    console.error("POST /admin/purge-events failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Notification subscriptions (Admin)
app.put("/devices/:id/users/:userId/notifications", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const eventTypes = (req.body && req.body.eventTypes) || [];
  await setUserSubscriptions(deviceId, userId, eventTypes);

  res.json({ deviceId, userId, eventTypes });
}));

// Schedules (Admin)
app.get("/schedules", requireAdminKey, asyncHandler(async (req, res) => {
  res.json(await listSchedules());
}));
app.post("/schedules", requireAdminKey, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = (body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });

  const description = (body.description || "").trim();
  const slots = Array.isArray(body.slots) ? body.slots : [];
  const cleanSlots = slots
    .filter(s => s && s.start && s.end)
    .map(s => ({
      daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [],
      start: s.start,
      end: s.end
    }));

  const sched = await createSchedule({ name, description, slots: cleanSlots });
  res.status(201).json(sched);
}));
app.put("/schedules/:id", requireAdminKey, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid schedule id" });

  const body = req.body || {};
  const name = (body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });

  const description = (body.description || "").trim();
  const slots = Array.isArray(body.slots) ? body.slots : [];
  const cleanSlots = slots
    .filter(s => s && s.start && s.end)
    .map(s => ({
      daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [],
      start: s.start,
      end: s.end
    }));

  const sched = await updateSchedule(id, { name, description, slots: cleanSlots });
  if (!sched) return res.status(404).json({ error: "Schedule not found" });
  res.json(sched);
}));
app.delete("/schedules/:id", requireAdminKey, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid schedule id" });
  await deleteSchedule(id);
  res.json({ status: "deleted", id });
}));

// Users (Admin)
// ======================================================
// Admin Users (Alias + Create)
// Build: render-2026-01-08-e
// ======================================================

// Alias GET /admin/users -> same as GET /users
app.get("/admin/users", requireAdminKey, asyncHandler(async (req, res) => {
  const qstr = (req.query.q || "").trim();
  const rows = await searchUsers(qstr || null);

  const result = [];
  for (const u of rows) {
    const devices = await listUserDevices(u.id);
    result.push({ id: u.id, name: u.name, email: u.email, phone: u.phone, devices });
  }
  res.json(result);
}));

// Create user (admin-only) + optionally attach to multiple devices
// Body:
// {
//   name, email, phone, password,
//   devices: [{ deviceId, role, scheduleId? }, ...]
// }
app.post("/admin/users", requireAdminKey, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = (body.name || "").trim();
  const email = (body.email || "").trim() || null;
  const phone = normalizePhone(body.phone || null);
  const password = body.password || "";

  if (!password) return res.status(400).json({ error: "password is required" });
  if (!email && !phone) return res.status(400).json({ error: "Provide at least email or phone" });

  // Prevent duplicates
  if (phone) {
    const existingByPhone = await getUserByPhone(phone);
    if (existingByPhone) return res.status(409).json({ error: "User with this phone already exists" });
  }
  if (email) {
    const existingByEmail = await getUserByEmail(email);
    if (existingByEmail) return res.status(409).json({ error: "User with this email already exists" });
  }

  // Create
  const user = await createUser({ name, email, phone, password });

  // Optional attach to devices
  const devices = Array.isArray(body.devices) ? body.devices : [];
  for (const d of devices) {
    const deviceId = (d?.deviceId || "").trim();
    if (!deviceId) continue;

    const role = (d?.role || "operator").trim() || "operator";
    await attachUserToDevice(deviceId, user.id, role);

    // Optional schedule assignment
    const scheduleId = d?.scheduleId ? Number(d.scheduleId) : null;
    if (scheduleId) {
      const sched = await getScheduleById(scheduleId);
      if (!sched) return res.status(404).json({ error: `Schedule not found: ${scheduleId}` });
      await setDeviceUserSchedule(deviceId, user.id, scheduleId);
    }
  }

  // Return created user (and optionally a profile if you want)
  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
  });
}));

app.get("/users", requireAdminKey, asyncHandler(async (req, res) => {
  const qstr = (req.query.q || "").trim();
  const rows = await searchUsers(qstr || null);

  const result = [];
  for (const u of rows) {
    const devices = await listUserDevices(u.id);
    result.push({ id: u.id, name: u.name, email: u.email, phone: u.phone, devices });
  }
  res.json(result);
}));
app.get("/users/:id", requireAdminKey, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const u = await getUserById(id);
  if (!u) return res.status(404).json({ error: "User not found" });
  const devices = await listUserDevices(u.id);
  res.json({ id: u.id, name: u.name, email: u.email, phone: u.phone, devices });
}));
app.put("/users/:id", requireAdminKey, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const user = await getUserById(id);
  if (!user) return res.status(404).json({ error: "User not found" });
// ======================================================
// Admin-only: Create user + attach to multiple gates
// POST /admin/users
// Body: { name, email, phone, password, devices:[{deviceId, role}] }
// ======================================================
app.post("/admin/users", requireAdminKey, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = (body.name || "").trim() || null;
  const email = (body.email || "").trim() || null;
  const phone = normalizePhone(body.phone || null);
  const password = body.password || "";

  const devices = Array.isArray(body.devices) ? body.devices : [];

  if (!password || (!email && !phone)) {
    return res.status(400).json({ error: "password and at least phone or email are required" });
  }

  // Uniqueness checks (same as /auth/register)
  if (phone) {
    const existingByPhone = await getUserByPhone(phone);
    if (existingByPhone) return res.status(409).json({ error: "User with this phone already exists" });
  }
  if (email) {
    const existingByEmail = await getUserByEmail(email);
    if (existingByEmail) return res.status(409).json({ error: "User with this email already exists" });
  }

  // Create user (uses your existing helper, hashes password)
  const user = await createUser({ name: name || email || phone, email, phone, password });

  // Attach to multiple devices (optional)
  const attached = [];
  for (const d of devices) {
    const deviceId = (d?.deviceId || "").trim();
    if (!deviceId) continue;

    const device = await getDeviceById(deviceId);
    if (!device) continue; // ignore unknown device ids

    const role = (d?.role || "operator").trim() || "operator";
    await attachUserToDevice(deviceId, user.id, role);
    attached.push({ deviceId, role });
  }

  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    devices: attached
  });
}));


  const updated = await updateUser(id, {
    name: req.body && req.body.name,
    email: req.body && req.body.email,
    phone: req.body && req.body.phone,
    password: req.body && req.body.password
  });

  res.json({ id: updated.id, name: updated.name, email: updated.email, phone: updated.phone });
}));
app.delete("/users/:id", requireAdminKey, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const user = await getUserById(id);
  if (!user) return res.status(404).json({ error: "User not found" });
  await deleteUser(id);
  res.json({ status: "deleted", id });
}));

// Profile (Admin) - profile-driven UI endpoint
app.get("/profiles/users/:id", requireAdminKey, asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const profile = await getUserProfile(userId);
  if (!profile) return res.status(404).json({ error: "User not found" });
  res.json(profile);
}));

// User-facing device settings (non-secret)
app.get("/devices/:id/user-settings", requireUser, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const userId = req.user.id;

  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  if (!(await isUserOnDevice(deviceId, userId))) {
    return res.status(403).json({ error: "Not allowed on this device" });
  }

  const r = await q("select settings from public.device_settings where device_id = $1", [deviceId]);
  if (!r.rows.length) return res.json({});
  res.json(r.rows[0].settings || {});
}));

// User-accessible device events feed
app.get("/devices/:id/user-events", requireUser, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const userId = req.user.id;
  const limit = req.query.limit ? Math.min(Number(req.query.limit) || 30, 100) : 30;

  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  if (!(await isUserOnDevice(deviceId, userId))) {
    return res.status(403).json({ error: "Not allowed on this device" });
  }

  const r = await q(
    `
    select id, device_id, user_id, event_type, at, details
    from public.device_events
    where device_id = $1
    order by at desc
    limit $2
    `,
    [deviceId, limit]
  );

  res.json(r.rows);
}));

// User-facing open/aux
app.post("/devices/:id/open", requireUser, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  const userId = req.user.id;
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;

  if (!(await isUserOnDevice(deviceId, userId))) {
    await logDeviceEvent(deviceId, "ACCESS_DENIED_NOT_ASSIGNED", { userId, details: "open" });
    return res.status(403).json({ error: "User not allowed on this device" });
  }

  if (!(await isUserAllowedNow(deviceId, userId, new Date()))) {
    await logDeviceEvent(deviceId, "ACCESS_DENIED_SCHEDULE", { userId, details: "open" });
    return res.status(403).json({ error: "Access not allowed at this time" });
  }

  const cmd = await createCommand(deviceId, userId, "OPEN", durationMs);
  await logDeviceEvent(deviceId, "OPEN_REQUESTED", { userId, details: "durationMs=" + durationMs });
  res.status(201).json(cmd);
}));

app.post("/devices/:id/aux1", requireUser, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  const userId = req.user.id;
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;

  if (!(await isUserOnDevice(deviceId, userId))) {
    await logDeviceEvent(deviceId, "AUX1_DENIED_NOT_ASSIGNED", { userId, details: "aux1" });
    return res.status(403).json({ error: "User not allowed on this device" });
  }

  if (!(await isUserAllowedNow(deviceId, userId, new Date()))) {
    await logDeviceEvent(deviceId, "AUX1_DENIED_SCHEDULE", { userId, details: "aux1" });
    return res.status(403).json({ error: "Access not allowed at this time" });
  }

  const cmd = await createCommand(deviceId, userId, "AUX1", durationMs);
  await logDeviceEvent(deviceId, "AUX1_REQUESTED", { userId, details: "durationMs=" + durationMs });
  res.status(201).json(cmd);
}));

app.post("/devices/:id/aux2", requireUser, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });

  const userId = req.user.id;
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;

  if (!(await isUserOnDevice(deviceId, userId))) {
    await logDeviceEvent(deviceId, "AUX2_DENIED_NOT_ASSIGNED", { userId, details: "aux2" });
    return res.status(403).json({ error: "User not allowed on this device" });
  }

  if (!(await isUserAllowedNow(deviceId, userId, new Date()))) {
    await logDeviceEvent(deviceId, "AUX2_DENIED_SCHEDULE", { userId, details: "aux2" });
    return res.status(403).json({ error: "Access not allowed at this time" });
  }

  const cmd = await createCommand(deviceId, userId, "AUX2", durationMs);
  await logDeviceEvent(deviceId, "AUX2_REQUESTED", { userId, details: "durationMs=" + durationMs });
  res.status(201).json(cmd);
}));

// AUX tests (admin)
app.post("/devices/:id/aux1-test", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;
  const cmd = await createCommand(deviceId, null, "AUX1", durationMs);
  await logDeviceEvent(deviceId, "AUX1_TRIGGER", { details: "durationMs=" + durationMs });
  res.status(201).json(cmd);
}));

app.post("/devices/:id/aux2-test", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;
  const cmd = await createCommand(deviceId, null, "AUX2", durationMs);
  await logDeviceEvent(deviceId, "AUX2_TRIGGER", { details: "durationMs=" + durationMs });
  res.status(201).json(cmd);
}));

// Simulated events (admin)
app.post("/devices/:id/simulate-event", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const type = (req.body && req.body.type) || "UNKNOWN";
  await logDeviceEvent(deviceId, type, { details: "simulated=true" });
  res.json({ status: "ok", deviceId, type });
}));

// Recent events per device (admin)
app.get("/devices/:id/events", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const limit = req.query.limit ? Number(req.query.limit) || 50 : 50;
  res.json(await getDeviceEvents(deviceId, limit));
}));

// Global events / reports (admin)
app.get("/events", requireAdminKey, asyncHandler(async (req, res) => {
  const deviceId = (req.query.deviceId || "").trim() || null;
  const userId = (req.query.userId || "").trim() || null;
  const from = (req.query.from || "").trim() || null;
  const to = (req.query.to || "").trim() || null;
  const limit = req.query.limit ? Number(req.query.limit) || 500 : 500;

  const events = await getEventsForReport({ deviceId, userId, from, to, limit });
  res.json(events);
}));

// ESP poll endpoint (no auth yet)
app.post("/device/poll", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const deviceId = body.deviceId;
  const lastResults = Array.isArray(body.lastResults) ? body.lastResults : [];

  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

  const device = await getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: "Device not registered" });

  for (const r of lastResults) {
    if (!r || !r.commandId) continue;
    const cmdRow = await completeCommand(deviceId, r.commandId, r.result || "");
    if (cmdRow) {
      await logDeviceEvent(deviceId, "CMD_COMPLETED", {
        userId: cmdRow.user_id || null,
        details: cmdRow.type + " result=" + (r.result || "")
      });
    }
  }

  const queued = await getQueuedCommands(deviceId);
  const toSend = queued.map(c => ({
    commandId: c.id,
    type: c.type,
    durationMs: c.duration_ms
  }));

  res.json({ commands: toSend });
}));

// Error handler
app.use((err, req, res, next) => {
  console.error("*** UNHANDLED ERROR ***", err);
  res.status(500).json({ error: "Internal server error" });
});

// ---- Start server ----
let server = null;

async function start() {
  await initDb();
  await verifyMailer();

  server = app.listen(PORT, () => {
    console.log(`Geata API listening on port ${PORT}`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`Admin API key is: ${ADMIN_API_KEY}`);
      console.log(`Admin key fingerprint: ${shortHash(process.env.ADMIN_API_KEY)}`);
    }
  });

  return server;
}

if (require.main === module) {
  start().catch(err => {
    console.error("*** STARTUP FAILED ***", err);
    process.exit(1);
  });
}

// graceful shutdown
async function shutdown() {
  try {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
  } catch (_) {}
  try {
    await pool.end();
  } catch (_) {}
}

process.on("SIGTERM", () => shutdown().finally(() => process.exit(0)));
process.on("SIGINT", () => shutdown().finally(() => process.exit(0)));

module.exports = { app, start, initDb, shutdown, pool };
