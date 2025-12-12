// index.js
// Geata backend with:
// - Devices, users, device-user mapping, schedules
// - JWT auth (phone/email + password)
// - Commands (OPEN / AUX1 / AUX2) and ESP polling
// - Event logging (all OPEN/AUX/Sim + command completion)
// - Reports endpoint for CSV/JSON audit trail

const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-only-admin-key';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-jwt-secret';
const PORT = process.env.PORT || 3000;

console.log('*** GEATA BACKEND STARTING ***');
console.log('*** USING INDEX.JS AT:', __filename);

const db = new Database('myapi.db');
db.pragma('journal_mode = WAL');

// ---- DB INIT ----

function initDb() {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS device_users (
      device_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL,
      schedule_id INTEGER,
      PRIMARY KEY (device_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_slots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id   INTEGER NOT NULL,
      days_of_week  TEXT,
      start         TEXT NOT NULL,
      "end"         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commands (
      id           TEXT PRIMARY KEY,
      device_id    TEXT NOT NULL,
      user_id      TEXT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      result       TEXT,
      duration_ms  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id  TEXT NOT NULL,
      user_id    TEXT,
      event_type TEXT NOT NULL,
      at         TEXT NOT NULL,
      details    TEXT
    );
  `);

  // Ensure schedule_id column exists on device_users for older DBs
  const cols = db.prepare(`PRAGMA table_info(device_users)`).all();
  const hasScheduleId = cols.some(c => c.name === 'schedule_id');
  if (!hasScheduleId) {
    db.exec(`ALTER TABLE device_users ADD COLUMN schedule_id INTEGER`);
  }

  const countDevices = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
  if (countDevices === 0) {
    const insertDevice = db.prepare('INSERT INTO devices (id, name) VALUES (?, ?)');
    insertDevice.run('gate1', 'Example Gate 1');
    insertDevice.run('gate2', 'Example Gate 2');
  }
}

initDb();

// ---- Helpers ----

function normalizePhone(raw) {
  if (!raw) return null;
  return String(raw).trim(); // keep simple to not break existing data
}

function randomId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

// Devices

function getDevices() {
  return db.prepare('SELECT id, name FROM devices ORDER BY id').all();
}

function getDeviceById(id) {
  return db.prepare('SELECT id, name FROM devices WHERE id = ?').get(id);
}

function createDevice(id, name) {
  db.prepare('INSERT INTO devices (id, name) VALUES (?, ?)').run(id, name);
  return getDeviceById(id);
}

// Users

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByEmail(email) {
  if (!email) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(p);
}

function createUser({ name, email, phone, password }) {
  const id = randomId('u');
  const normalizedPhone = normalizePhone(phone);
  const hash = password ? bcrypt.hashSync(password, 10) : null;
  db.prepare(
    'INSERT INTO users (id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    name || email || normalizedPhone || id,
    email || null,
    normalizedPhone || null,
    hash
  );
  return getUserById(id);
}

function updateUser(id, { name, email, phone, password }) {
  const user = getUserById(id);
  if (!user) return null;
  const newName = name != null && name !== '' ? name : user.name;
  const newEmail = email != null && email !== '' ? email : user.email;
  const newPhone = phone != null && phone !== '' ? normalizePhone(phone) : user.phone;
  let newHash = user.password_hash;
  if (password && password.length > 0) {
    newHash = bcrypt.hashSync(password, 10);
  }
  db.prepare(
    'UPDATE users SET name = ?, email = ?, phone = ?, password_hash = ? WHERE id = ?'
  ).run(newName, newEmail, newPhone, newHash, id);
  return getUserById(id);
}

function deleteUser(id) {
  db.prepare('DELETE FROM device_users WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function searchUsers(q) {
  if (!q) {
    return db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all();
  }
  const pattern = '%' + q + '%';
  return db.prepare(`
    SELECT *
    FROM users
    WHERE name  LIKE ?
       OR email LIKE ?
       OR phone LIKE ?
    ORDER BY name COLLATE NOCASE
  `).all(pattern, pattern, pattern);
}

// Device-users

function attachUserToDevice(deviceId, userId, role) {
  const r = role || 'operator';
  db.prepare(`
    INSERT OR IGNORE INTO device_users (device_id, user_id, role)
    VALUES (?, ?, ?)
  `).run(deviceId, userId, r);
  return { deviceId, userId, role: r };
}

function detachUserFromDevice(deviceId, userId) {
  const info = db.prepare(
    'DELETE FROM device_users WHERE device_id = ? AND user_id = ?'
  ).run(deviceId, userId);
  return info.changes > 0;
}

function setDeviceUserSchedule(deviceId, userId, scheduleId) {
  db.prepare(`
    UPDATE device_users
    SET schedule_id = ?
    WHERE device_id = ? AND user_id = ?
  `).run(scheduleId || null, deviceId, userId);
}

function listDeviceUsers(deviceId) {
  return db.prepare(`
    SELECT
      du.user_id     AS userId,
      du.role        AS role,
      du.schedule_id AS scheduleId,
      u.name         AS name,
      u.email        AS email,
      u.phone        AS phone
    FROM device_users du
    LEFT JOIN users u ON u.id = du.user_id
    WHERE du.device_id = ?
    ORDER BY u.name COLLATE NOCASE
  `).all(deviceId);
}

function listUserDevices(userId) {
  return db.prepare(`
    SELECT du.device_id AS deviceId,
           du.role      AS role
    FROM device_users du
    WHERE du.user_id = ?
    ORDER BY du.device_id
  `).all(userId);
}

function isUserOnDevice(deviceId, userId) {
  const row = db.prepare(`
    SELECT 1 AS present
    FROM device_users
    WHERE device_id = ? AND user_id = ?
  `).get(deviceId, userId);
  return !!row;
}

function getDeviceUserScheduleId(deviceId, userId) {
  const row = db.prepare(`
    SELECT schedule_id
    FROM device_users
    WHERE device_id = ? AND user_id = ?
  `).get(deviceId, userId);
  if (!row) return null;
  return row.schedule_id;
}

// Schedules

function getScheduleSlots(scheduleId) {
  return db.prepare(`
    SELECT id, schedule_id, days_of_week, start, "end" AS end
    FROM schedule_slots
    WHERE schedule_id = ?
    ORDER BY id
  `).all(scheduleId);
}

function getScheduleById(id) {
  const row = db.prepare(`
    SELECT id, name, description, created_at
    FROM schedules
    WHERE id = ?
  `).get(id);
  if (!row) return null;
  const slotsRows = getScheduleSlots(id);
  const slots = slotsRows.map(r => ({
    id: r.id,
    scheduleId: r.schedule_id,
    daysOfWeek: r.days_of_week ? JSON.parse(r.days_of_week) : [],
    start: r.start,
    end: r.end
  }));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    slots
  };
}

function listSchedules() {
  const rows = db.prepare(`
    SELECT id, name, description, created_at
    FROM schedules
    ORDER BY name COLLATE NOCASE
  `).all();
  return rows.map(r => {
    const slotsRows = getScheduleSlots(r.id);
    const slots = slotsRows.map(s => ({
      id: s.id,
      scheduleId: s.schedule_id,
      daysOfWeek: s.days_of_week ? JSON.parse(s.days_of_week) : [],
      start: s.start,
      end: s.end
    }));
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
      slots
    };
  });
}

function createSchedule({ name, description, slots }) {
  const createdAt = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO schedules (name, description, created_at)
    VALUES (?, ?, ?)
  `).run(name, description || null, createdAt);
  const scheduleId = info.lastInsertRowid;
  if (Array.isArray(slots)) {
    const insertSlot = db.prepare(`
      INSERT INTO schedule_slots (schedule_id, days_of_week, start, "end")
      VALUES (?, ?, ?, ?)
    `);
    slots.forEach(s => {
      const daysJson = Array.isArray(s.daysOfWeek) && s.daysOfWeek.length > 0
        ? JSON.stringify(s.daysOfWeek)
        : null;
      insertSlot.run(scheduleId, daysJson, s.start, s.end);
    });
  }
  return getScheduleById(scheduleId);
}

function updateSchedule(id, { name, description, slots }) {
  const existing = getScheduleById(id);
  if (!existing) return null;
  db.prepare(`
    UPDATE schedules
    SET name = ?, description = ?
    WHERE id = ?
  `).run(name || existing.name, description || null, id);
  db.prepare('DELETE FROM schedule_slots WHERE schedule_id = ?').run(id);
  if (Array.isArray(slots)) {
    const insertSlot = db.prepare(`
      INSERT INTO schedule_slots (schedule_id, days_of_week, start, "end")
      VALUES (?, ?, ?, ?)
    `);
    slots.forEach(s => {
      const daysJson = Array.isArray(s.daysOfWeek) && s.daysOfWeek.length > 0
        ? JSON.stringify(s.daysOfWeek)
        : null;
      insertSlot.run(id, daysJson, s.start, s.end);
    });
  }
  return getScheduleById(id);
}

function deleteSchedule(id) {
  db.prepare('UPDATE device_users SET schedule_id = NULL WHERE schedule_id = ?').run(id);
  db.prepare('DELETE FROM schedule_slots WHERE schedule_id = ?').run(id);
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

// Schedule check

function isUserAllowedNow(deviceId, userId, now) {
  now = now || new Date();

  if (!isUserOnDevice(deviceId, userId)) return false;

  const scheduleId = getDeviceUserScheduleId(deviceId, userId);
  if (!scheduleId) {
    // 24/7
    return true;
  }
  const sched = getScheduleById(scheduleId);
  if (!sched || !sched.slots || sched.slots.length === 0) {
    // schedule exists but has no slots => no access
    return false;
  }

  const day = now.getDay(); // 0–6
  const hh = now.getHours();
  const mm = now.getMinutes();
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const timeStr = pad(hh) + ':' + pad(mm);

  for (let i = 0; i < sched.slots.length; i++) {
    const s = sched.slots[i];
    const days = Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [];
    if (days.length > 0 && days.indexOf(day) === -1) continue;
    if (s.start && timeStr < s.start) continue;
    if (s.end && timeStr > s.end) continue;
    return true;
  }
  return false;
}

// Commands & events

function createCommand(deviceId, userId, type, durationMs) {
  const id = randomId('cmd');
  const nowIso = new Date().toISOString();

  // Insert into commands table
  db.prepare(`
    INSERT INTO commands
      (id, device_id, user_id, type, status, requested_at, completed_at, result, duration_ms)
    VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, ?)
  `).run(id, deviceId, userId || null, type, nowIso, durationMs);

  // Log a generic "command requested" event for *every* command
  const details = `type=${type};durationMs=${durationMs}`;
  logDeviceEvent(deviceId, 'CMD_REQUESTED', {
    userId: userId || null,
    details
  });

  return {
    id,
    deviceId,
    userId: userId || null,
    type,
    status: 'queued',
    requestedAt: nowIso,
    completedAt: null,
    result: null,
    durationMs
  };
}

function getQueuedCommands(deviceId) {
  return db.prepare(`
    SELECT *
    FROM commands
    WHERE device_id = ? AND status = 'queued'
    ORDER BY requested_at ASC
  `).all(deviceId);
}

function completeCommand(deviceId, commandId, result) {
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE commands
    SET status = 'completed',
        completed_at = ?,
        result = ?
    WHERE id = ? AND device_id = ? AND status = 'queued'
  `).run(nowIso, result || null, commandId, deviceId);
  return db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
}

function listRecentCommands(limit) {
  const lim = limit || 20;
  return db.prepare(`
    SELECT *
    FROM commands
    ORDER BY requested_at DESC
    LIMIT ?
  `).all(lim);
}

function logDeviceEvent(deviceId, eventType, opts) {
  opts = opts || {};
  const userId = opts.userId || null;
  const details = opts.details || null;
  const at = new Date().toISOString();
  db.prepare(`
    INSERT INTO device_events (device_id, user_id, event_type, at, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(deviceId, userId, eventType, at, details);
}

function getDeviceEvents(deviceId, limit) {
  const lim = limit || 50;
  return db.prepare(`
    SELECT
      e.id,
      e.device_id,
      e.user_id,
      e.event_type,
      e.at,
      e.details,
      u.name  AS user_name,
      u.phone AS user_phone
    FROM device_events e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.device_id = ?
    ORDER BY e.at DESC
    LIMIT ?
  `).all(deviceId, lim);
}

function getEventsForReport(filters) {
  const deviceId = filters.deviceId || null;
  const userId = filters.userId || null;
  const from = filters.from || null;
  const to = filters.to || null;
  const limit = filters.limit || 500;

  let sql = `
    SELECT
      e.id,
      e.device_id,
      e.user_id,
      e.event_type,
      e.at,
      e.details,
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
  if (deviceId) {
    sql += ' AND e.device_id = ?';
    params.push(deviceId);
  }
  if (userId) {
    sql += ' AND e.user_id = ?';
    params.push(userId);
  }
  if (from) {
    sql += ' AND e.at >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND e.at <= ?';
    params.push(to);
  }
  sql += ' ORDER BY e.at DESC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

// ---- Middleware ----

function requireAdminKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid API key' });
  }
  next();
}

function requireUser(req, res, next) {
  const auth = req.header('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---- Routes ----

// Health
app.get('/', (req, res) => {
  res.send('Geata API is running');
});

// Auth

app.post('/auth/register', (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!password || (!email && !phone)) {
    return res.status(400).json({ error: 'password and at least phone or email are required' });
  }
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) {
    const existingByPhone = getUserByPhone(normalizedPhone);
    if (existingByPhone) {
      return res.status(409).json({ error: 'User with this phone already exists' });
    }
  }
  if (email) {
    const existingByEmail = getUserByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
  }
  const user = createUser({ name, email, phone: normalizedPhone, password });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    }
  });
});

app.post('/auth/login', (req, res) => {
  const { phone, email, password } = req.body || {};
  console.log('*** /auth/login CALLED ***');
  console.log('*** BODY:', req.body);
  if ((!phone && !email) || !password) {
    return res.status(400).json({ error: 'phone or email and password are required' });
  }
  let user = null;
  if (phone) {
    user = getUserByPhone(phone);
  } else if (email) {
    user = getUserByEmail(email);
  }
  if (!user || !user.password_hash) {
    console.log('*** /auth/login INVALID USER OR NO PASSWORD_HASH');
    return res.status(401).json({ error: 'Invalid login or password' });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    console.log('*** /auth/login BAD PASSWORD');
    return res.status(401).json({ error: 'Invalid login or password' });
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  console.log('*** /auth/login SUCCESS for userId:', user.id);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    }
  });
});

// Me

app.get('/me', requireUser, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone
  });
});

app.get('/me/devices', requireUser, (req, res) => {
  const userId = req.user.id;
  const devices = db.prepare(`
    SELECT d.id, d.name, du.role
    FROM device_users du
    JOIN devices d ON d.id = du.device_id
    WHERE du.user_id = ?
    ORDER BY d.id
  `).all(userId);
  res.json(devices);
});

// Devices

app.get('/devices', (req, res) => {
  res.json(getDevices());
});

app.post('/devices', requireAdminKey, (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required' });
  }
  const existing = getDeviceById(id);
  if (existing) {
    return res.status(409).json({ error: 'Device with this id already exists' });
  }
  const dev = createDevice(id, name);
  res.status(201).json(dev);
});

// Device users

app.get('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const users = listDeviceUsers(deviceId);
  res.json(users);
});

app.post('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { userId, name, email, phone, password, role } = req.body || {};
  const r = role || 'operator';

  let user = null;

  // Option 1: attach by existing userId
  if (userId) {
    user = getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found for given userId' });
    }
    attachUserToDevice(deviceId, user.id, r);
    return res.status(201).json({
      deviceId,
      userId: user.id,
      role: r,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  }

  // Option 2: create/reuse by phone/email
  if (!email && !phone) {
    return res.status(400).json({ error: 'At least email or phone is required (or provide userId)' });
  }

  const normalizedPhone = normalizePhone(phone);

  if (normalizedPhone) {
    user = getUserByPhone(normalizedPhone);
  }
  if (!user && email) {
    user = getUserByEmail(email);
  }

  if (!user) {
    user = createUser({
      name,
      email,
      phone: normalizedPhone,
      password
    });
  } else if (password && password.length > 0) {
    const updated = updateUser(user.id, {
      name: name || user.name,
      email: email || user.email,
      phone: normalizedPhone || user.phone,
      password
    });
    user = updated;
  } else if (name || email || normalizedPhone) {
    const updated = updateUser(user.id, {
      name: name || user.name,
      email: email || user.email,
      phone: normalizedPhone || user.phone,
      password: null
    });
    user = updated;
  }

  attachUserToDevice(deviceId, user.id, r);

  res.status(201).json({
    deviceId,
    userId: user.id,
    role: r,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    }
  });
});

app.post('/devices/:id/users/import', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const rows = req.body && req.body.rows;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows array is required' });
  }

  const created = [];
  const reused = [];

  rows.forEach(r => {
    const name = (r.name || '').trim();
    const email = (r.email || '').trim();
    const phone = normalizePhone(r.phone || '');
    const role = (r.role || 'operator').trim() || 'operator';

    if (!email && !phone) {
      return;
    }

    let user = null;
    if (phone) {
      user = getUserByPhone(phone);
    }
    if (!user && email) {
      user = getUserByEmail(email);
    }
    if (!user) {
      user = createUser({ name, email, phone, password: null });
      created.push(user.id);
    } else {
      reused.push(user.id);
    }

    attachUserToDevice(deviceId, user.id, role);
  });

  res.json({ created, reused });
});

// Export users on a specific device as CSV (admin)
app.get('/devices/:id/users/export', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  // FIXED: use listDeviceUsers instead of non-existent getDeviceUsers
  const rows = listDeviceUsers(deviceId); // { userId, name, email, phone, role, scheduleId }

  const header = ['userId', 'name', 'email', 'phone', 'role', 'scheduleId'];
  const csvRows = [header.join(',')];

  for (const r of rows) {
    const out = [
      r.userId,
      r.name || '',
      r.email || '',
      r.phone || '',
      r.role || '',
      r.scheduleId || ''
    ].map(v => {
      const s = String(v == null ? '' : v);
      return '"' + s.replace(/"/g, '""') + '"';
    });
    csvRows.push(out.join(','));
  }

  const csv = csvRows.join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="device-${deviceId}-users.csv"`
  );
  res.send(csv);
});

// Export all users + their devices as CSV (admin)
app.get('/users/export-csv', requireAdminKey, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, phone
    FROM users
    ORDER BY id
  `).all();

  const du = db.prepare(`
    SELECT du.user_id, du.device_id, du.role, d.name AS device_name
    FROM device_users du
    LEFT JOIN devices d ON d.id = du.device_id
  `).all();

  const devicesByUser = {};
  for (const row of du) {
    if (!devicesByUser[row.user_id]) devicesByUser[row.user_id] = [];
    const label =
      row.device_id +
      (row.device_name ? `(${row.device_name})` : '') +
      ':' +
      (row.role || 'operator');
    devicesByUser[row.user_id].push(label);
  }

  const header = ['userId', 'name', 'email', 'phone', 'devices'];
  const csvRows = [header.join(',')];

  for (const u of users) {
    const devs = (devicesByUser[u.id] || []).join(' | ');
    const out = [
      u.id,
      u.name || '',
      u.email || '',
      u.phone || '',
      devs
    ].map(v => {
      const s = String(v == null ? '' : v);
      return '"' + s.replace(/"/g, '""') + '"';
    });
    csvRows.push(out.join(','));
  }

  const csv = csvRows.join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="geata-users-devices.csv"'
  );
  res.send(csv);
});

app.delete('/devices/:id/users/:userId', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;
  const removed = detachUserFromDevice(deviceId, userId);
  if (!removed) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ status: 'removed', deviceId, userId });
});

app.put('/devices/:id/users/:userId/schedule-assignment', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const user = getUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const scheduleId = req.body && req.body.scheduleId
    ? Number(req.body.scheduleId)
    : null;

  if (scheduleId) {
    const sched = getScheduleById(scheduleId);
    if (!sched) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
  }

  setDeviceUserSchedule(deviceId, userId, scheduleId || null);
  res.json({ deviceId, userId, scheduleId: scheduleId || null });
});

// Schedules

app.get('/schedules', requireAdminKey, (req, res) => {
  const list = listSchedules();
  res.json(list);
});

app.post('/schedules', requireAdminKey, (req, res) => {
  const body = req.body || {};
  const name = (body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const description = (body.description || '').trim();
  const slots = Array.isArray(body.slots) ? body.slots : [];
  const cleanSlots = slots
    .filter(s => s && s.start && s.end)
    .map(s => ({
      daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [],
      start: s.start,
      end: s.end
    }));
  const sched = createSchedule({ name, description, slots: cleanSlots });
  res.status(201).json(sched);
});

app.put('/schedules/:id', requireAdminKey, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid schedule id' });
  const body = req.body || {};
  const name = (body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const description = (body.description || '').trim();
  const slots = Array.isArray(body.slots) ? body.slots : [];
  const cleanSlots = slots
    .filter(s => s && s.start && s.end)
    .map(s => ({
      daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [],
      start: s.start,
      end: s.end
    }));
  const sched = updateSchedule(id, { name, description, slots: cleanSlots });
  if (!sched) return res.status(404).json({ error: 'Schedule not found' });
  res.json(sched);
});

app.delete('/schedules/:id', requireAdminKey, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid schedule id' });
  deleteSchedule(id);
  res.json({ status: 'deleted', id });
});

// Users (admin)

app.get('/users', requireAdminKey, (req, res) => {
  const q = (req.query.q || '').trim();
  const rows = searchUsers(q || null);
  const result = rows.map(u => {
    const devices = listUserDevices(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      devices
    };
  });
  res.json(result);
});

app.put('/users/:id', requireAdminKey, (req, res) => {
  const id = req.params.id;
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const updated = updateUser(id, {
    name: req.body && req.body.name,
    email: req.body && req.body.email,
    phone: req.body && req.body.phone,
    password: req.body && req.body.password
  });
  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    phone: updated.phone
  });
});

app.delete('/users/:id', requireAdminKey, (req, res) => {
  const id = req.params.id;
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  deleteUser(id);
  res.json({ status: 'deleted', id });
});

// User-facing open gate

app.post('/devices/:id/open', requireUser, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const userId = req.user.id;
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;

  if (!isUserOnDevice(deviceId, userId)) {
    logDeviceEvent(deviceId, 'ACCESS_DENIED_NOT_ASSIGNED', { userId, details: 'open' });
    return res.status(403).json({ error: 'User not allowed on this device' });
  }

  if (!isUserAllowedNow(deviceId, userId, new Date())) {
    logDeviceEvent(deviceId, 'ACCESS_DENIED_SCHEDULE', { userId, details: 'open' });
    return res.status(403).json({ error: 'Access not allowed at this time' });
  }

  const cmd = createCommand(deviceId, userId, 'OPEN', durationMs);
  logDeviceEvent(deviceId, 'OPEN_REQUESTED', { userId, details: 'durationMs=' + durationMs });
  res.status(201).json(cmd);
});

// User-facing AUX1 / AUX2 (same checks as OPEN)

app.post('/devices/:id/aux1', requireUser, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const userId = req.user.id;
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;

  if (!isUserOnDevice(deviceId, userId)) {
    logDeviceEvent(deviceId, 'AUX1_DENIED_NOT_ASSIGNED', { userId, details: 'aux1' });
    return res.status(403).json({ error: 'User not allowed on this device' });
  }

  if (!isUserAllowedNow(deviceId, userId, new Date())) {
    logDeviceEvent(deviceId, 'AUX1_DENIED_SCHEDULE', { userId, details: 'aux1' });
    return res.status(403).json({ error: 'Access not allowed at this time' });
  }

  const cmd = createCommand(deviceId, userId, 'AUX1', durationMs);
  logDeviceEvent(deviceId, 'AUX1_REQUESTED', { userId, details: 'durationMs=' + durationMs });
  res.status(201).json(cmd);
});

app.post('/devices/:id/aux2', requireUser, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const userId = req.user.id;
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;

  if (!isUserOnDevice(deviceId, userId)) {
    logDeviceEvent(deviceId, 'AUX2_DENIED_NOT_ASSIGNED', { userId, details: 'aux2' });
    return res.status(403).json({ error: 'User not allowed on this device' });
  }

  if (!isUserAllowedNow(deviceId, userId, new Date())) {
    logDeviceEvent(deviceId, 'AUX2_DENIED_SCHEDULE', { userId, details: 'aux2' });
    return res.status(403).json({ error: 'Access not allowed at this time' });
  }

  const cmd = createCommand(deviceId, userId, 'AUX2', durationMs);
  logDeviceEvent(deviceId, 'AUX2_REQUESTED', { userId, details: 'durationMs=' + durationMs });
  res.status(201).json(cmd);
});

// AUX tests (admin, used by admin.html)

app.post('/devices/:id/aux1-test', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;
  const cmd = createCommand(deviceId, null, 'AUX1', durationMs);
  logDeviceEvent(deviceId, 'AUX1_TRIGGER', { details: 'durationMs=' + durationMs });
  res.status(201).json(cmd);
});

app.post('/devices/:id/aux2-test', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const durationMs = req.body && req.body.durationMs ? Number(req.body.durationMs) : 1000;
  const cmd = createCommand(deviceId, null, 'AUX2', durationMs);
  logDeviceEvent(deviceId, 'AUX2_TRIGGER', { details: 'durationMs=' + durationMs });
  res.status(201).json(cmd);
});

// Simulated gate inputs (admin tests)

app.post('/devices/:id/simulate-event', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const type = (req.body && req.body.type) || 'UNKNOWN';
  // Important: NO userId here => no random "Alice" on simulated events
  logDeviceEvent(deviceId, type, { details: 'simulated=true' });
  res.json({ status: 'ok', deviceId, type });
});

// Device events per gate (admin)

app.get('/devices/:id/events', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const limit = req.query.limit ? Number(req.query.limit) || 50 : 50;
  const events = getDeviceEvents(deviceId, limit);
  res.json(events);
});

// Global events / reports (admin)

app.get('/events', requireAdminKey, (req, res) => {
  const deviceId = (req.query.deviceId || '').trim() || null;
  const userId = (req.query.userId || '').trim() || null;
  const from = (req.query.from || '').trim() || null;
  const to = (req.query.to || '').trim() || null;
  const limit = req.query.limit ? Number(req.query.limit) || 500 : 500;
  const format = (req.query.format || 'json').toLowerCase();

  const events = getEventsForReport({ deviceId, userId, from, to, limit });

  if (format === 'csv') {
    let csv = 'timestamp,deviceId,deviceName,userId,userName,userPhone,eventType,details\r\n';
    events.forEach(ev => {
      const row = [
        ev.at || '',
        ev.device_id || '',
        ev.device_name || '',
        ev.user_id || '',
        ev.user_name || '',
        ev.user_phone || '',
        ev.event_type || '',
        ev.details || ''
      ];
      const line = row
        .map(val => {
          const s = String(val || '');
          const escaped = s.replace(/"/g, '""');
          return '"' + escaped + '"';
        })
        .join(',');
      csv += line + '\r\n';
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="events-report.csv"');
    return res.send(csv);
  }

  res.json(events);
});

// Commands listing (admin)

app.get('/commands', requireAdminKey, (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) || 20 : 20;
  const cmds = listRecentCommands(limit);
  res.json(cmds);
});

// ESP poll endpoint

app.post('/device/poll', (req, res) => {
  const body = req.body || {};
  const deviceId = body.deviceId;
  const lastResults = Array.isArray(body.lastResults) ? body.lastResults : [];

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }
  const device = getDeviceById(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not registered' });

  lastResults.forEach(r => {
    if (!r || !r.commandId) return;
    const cmdRow = completeCommand(deviceId, r.commandId, r.result || '');
    if (cmdRow) {
      logDeviceEvent(deviceId, 'CMD_COMPLETED', {
        userId: cmdRow.user_id || null,
        details: cmdRow.type + ' result=' + (r.result || '')
      });
    }
  });

  const queued = getQueuedCommands(deviceId);
  const toSend = queued.map(c => ({
    commandId: c.id,
    type: c.type,
    durationMs: c.duration_ms
  }));

  res.json({ commands: toSend });
});

// ---- Start server ----

app.listen(PORT, () => {
  console.log(`Geata API listening on port ${PORT}`);
  console.log(`Admin API key is: ${ADMIN_API_KEY}`);
});
