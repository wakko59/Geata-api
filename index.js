// index.js
// Backend for Geata:
// - Express + SQLite (better-sqlite3)
// - Admin API (x-api-key)
// - Users with name / phone / email / password_hash
// - Phone-or-email login (JWT)
// - Per-device user lists, CSV import
// - Commands queue + /device/poll for ESP/4G module
// - PWA static files served from /public

const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Serve static files (app.html, admin.html, manifest, icons, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// ---- Config ----

// Admin API key (used by admin.html via x-api-key header)
// On Render, set ADMIN_API_KEY as an environment variable.
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-only-admin-key';

// JWT secret for user tokens
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-jwt-secret';

// ---- SQLite setup ----

const db = new Database('myapi.db');

// Phone normalisation helper (basic, Irish-friendly)
//
// - Removes spaces/dashes
// - "00353..." → "+353..."
// - "0xxxx..." → "+353xxxx..." (assumes IE as default country)
// - "+..." left as-is
//
function normalizePhone(phone) {
  if (!phone) return null;
  let s = String(phone).trim();

  // remove spaces, hyphens, parentheses
  s = s.replace(/[\s\-()]/g, '');

  if (s.startsWith('00')) {
    s = '+' + s.slice(2);
  } else if (s.startsWith('+')) {
    // already international
  } else if (s.startsWith('0')) {
    // assume Irish default country code
    s = '+353' + s.slice(1);
  }

  return s;
}

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
      phone         TEXT UNIQUE,
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS device_users (
      device_id TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      role      TEXT NOT NULL,
      PRIMARY KEY (device_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_access_rules (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id    TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      active_from  TEXT,
      active_to    TEXT,
      days_of_week TEXT,
      windows      TEXT
    );

    CREATE TABLE IF NOT EXISTS commands (
      id           TEXT PRIMARY KEY,
      device_id    TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      result       TEXT,
      duration_ms  INTEGER NOT NULL
    );
  `);

  // Seed example devices if none exist
  const countDevices = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
  if (countDevices === 0) {
    const insertDevice = db.prepare('INSERT INTO devices (id, name) VALUES (?, ?)');
    insertDevice.run('gate1', 'Warehouse Gate');
    insertDevice.run('gate2', 'Yard Barrier');
  }

  // We no longer seed any users by default.
}

initDb();

// ---- Helper functions ----

// Devices
function getDevices() {
  return db.prepare('SELECT id, name FROM devices').all();
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
  const e = String(email).trim();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(e);
}

function getUserByPhone(phone) {
  if (!phone) return null;
  const norm = normalizePhone(phone);
  if (!norm) return null;
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(norm);
}

function createUser({ name, email, phone, password }) {
  const id = 'u_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const normPhone = normalizePhone(phone);
  const hash = password ? bcrypt.hashSync(password, 10) : null;

  db.prepare(
    'INSERT INTO users (id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    name || email || normPhone || id,
    email ? String(email).trim() : null,
    normPhone,
    hash
  );

  return getUserById(id);
}

// Device-users mapping
function getDeviceUsers(deviceId) {
  return db.prepare(`
    SELECT du.user_id AS userId, du.role, u.name, u.email, u.phone
    FROM device_users du
    LEFT JOIN users u ON u.id = du.user_id
    WHERE du.device_id = ?
  `).all(deviceId);
}

function addUserToDevice(deviceId, userId, role) {
  db.prepare(`
    INSERT OR IGNORE INTO device_users (device_id, user_id, role)
    VALUES (?, ?, ?)
  `).run(deviceId, userId, role || 'operator');
}

function removeUserFromDevice(deviceId, userId) {
  const info = db.prepare(
    'DELETE FROM device_users WHERE device_id = ? AND user_id = ?'
  ).run(deviceId, userId);
  return info.changes > 0;
}

function isUserAllowedOnDevice(deviceId, userId) {
  const row = db
    .prepare('SELECT 1 AS ok FROM device_users WHERE device_id = ? AND user_id = ?')
    .get(deviceId, userId);
  return !!row;
}

function getUserDevices(userId) {
  return db.prepare(`
    SELECT d.id, d.name, du.role
    FROM device_users du
    JOIN devices d ON d.id = du.device_id
    WHERE du.user_id = ?
    ORDER BY d.id
  `).all(userId);
}

// Access rules
function getUserAccessRuleRow(deviceId, userId) {
  return db.prepare(`
    SELECT * FROM user_access_rules
    WHERE device_id = ? AND user_id = ?
    LIMIT 1
  `).get(deviceId, userId);
}

function normalizeRuleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    userId: row.user_id,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    daysOfWeek: row.days_of_week ? JSON.parse(row.days_of_week) : [],
    windows: row.windows ? JSON.parse(row.windows) : []
  };
}

function upsertUserAccessRule(deviceId, userId, ruleData) {
  const existing = getUserAccessRuleRow(deviceId, userId);

  const activeFrom = ruleData.activeFrom || null;
  const activeTo = ruleData.activeTo || null;

  const daysOfWeek = Array.isArray(ruleData.daysOfWeek)
    ? ruleData.daysOfWeek
    : [];
  const windows = Array.isArray(ruleData.windows)
    ? ruleData.windows.slice(0, 2)
    : [];

  const daysJson = daysOfWeek.length > 0 ? JSON.stringify(daysOfWeek) : null;
  const windowsJson = windows.length > 0 ? JSON.stringify(windows) : null;

  if (!existing) {
    db.prepare(`
      INSERT INTO user_access_rules
      (device_id, user_id, active_from, active_to, days_of_week, windows)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(deviceId, userId, activeFrom, activeTo, daysJson, windowsJson);
  } else {
    db.prepare(`
      UPDATE user_access_rules
      SET active_from = ?, active_to = ?, days_of_week = ?, windows = ?
      WHERE id = ?
    `).run(activeFrom, activeTo, daysJson, windowsJson, existing.id);
  }

  return normalizeRuleRow(getUserAccessRuleRow(deviceId, userId));
}

function isWithinUserSchedule(deviceId, userId, now = new Date()) {
  const row = getUserAccessRuleRow(deviceId, userId);

  // No rule = 24/7 access
  if (!row) return true;

  const rule = normalizeRuleRow(row);

  const day = now.getDay(); // 0–6 (Sun–Sat)
  const timeStr = now.toTimeString().slice(0, 5); // "HH:MM"
  const dateStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

  if (rule.activeFrom && dateStr < rule.activeFrom) return false;
  if (rule.activeTo && dateStr > rule.activeTo) return false;

  if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
    if (!rule.daysOfWeek.includes(day)) return false;
  }

  if (rule.windows && rule.windows.length > 0) {
    const allowed = rule.windows.some(w => {
      return timeStr >= w.start && timeStr <= w.end;
    });
    if (!allowed) return false;
  }

  return true;
}

// Commands
function createCommand(deviceId, userId, type, durationMs) {
  const id = 'cmd_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO commands
    (id, device_id, user_id, type, status, requested_at, completed_at, result, duration_ms)
    VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, ?)
  `).run(id, deviceId, userId, type, nowIso, durationMs);

  return {
    id,
    deviceId,
    userId,
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
    SELECT id, type, duration_ms
    FROM commands
    WHERE device_id = ? AND status = 'queued'
  `).all(deviceId);
}

function applyCommandResults(deviceId, lastResults) {
  if (!Array.isArray(lastResults)) return;
  const update = db.prepare(`
    UPDATE commands
    SET status = 'completed',
        result = ?,
        completed_at = ?
    WHERE id = ?
      AND device_id = ?
      AND status = 'queued'
  `);
  const completedAt = new Date().toISOString();
  lastResults.forEach(r => {
    update.run(r.result || 'unknown', completedAt, r.commandId, deviceId);
  });
}

function getRecentCommands(limit = 20) {
  return db.prepare(`
    SELECT *
    FROM commands
    ORDER BY requested_at DESC
    LIMIT ?
  `).all(limit);
}

// All users + their devices (for admin lookup)
function listUsersWithDevices(searchTerm) {
  let where = '';
  let param = null;
  if (searchTerm) {
    where = `
      WHERE u.name LIKE ?
         OR u.email LIKE ?
         OR u.phone LIKE ?
    `;
    const like = `%${searchTerm}%`;
    param = [like, like, like];
  }

  const users = db.prepare(
    `SELECT u.id, u.name, u.email, u.phone
     FROM users u
     ${where}
     ORDER BY u.name COLLATE NOCASE`
  ).all(param || []);

  const duRows = db.prepare(`
    SELECT du.device_id, du.user_id, du.role, d.name AS device_name
    FROM device_users du
    JOIN devices d ON d.id = du.device_id
  `).all();

  const deviceMap = {};
  duRows.forEach(r => {
    if (!deviceMap[r.user_id]) deviceMap[r.user_id] = [];
    deviceMap[r.user_id].push({
      deviceId: r.device_id,
      deviceName: r.device_name,
      role: r.role
    });
  });

  return users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    devices: deviceMap[u.id] || []
  }));
}

// ---- Middleware ----

// Admin key (for admin endpoints & admin.html)
function requireAdminKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid API key' });
  }
  next();
}

// User auth (JWT) for app endpoints
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

// ---- Auth endpoints ----

// Register a new user (phone OR email + password)
app.post('/auth/register', (req, res) => {
  const { name, phone, email, password } = req.body;

  if ((!phone && !email) || !password) {
    return res
      .status(400)
      .json({ error: 'phone or email and password are required' });
  }

  let existing = null;
  if (phone) {
    existing = getUserByPhone(phone);
  }
  if (!existing && email) {
    existing = getUserByEmail(email);
  }
  if (existing) {
    return res
      .status(409)
      .json({ error: 'User with this phone/email already exists' });
  }

  const user = createUser({ name, email, phone, password });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email
    }
  });
});

// Login: phone OR email + password -> JWT
app.post('/auth/login', (req, res) => {
  const { phone, email, password } = req.body;

  if ((!phone && !email) || !password) {
    return res
      .status(400)
      .json({ error: 'phone or email and password are required' });
  }

  let user = null;
  if (phone) {
    user = getUserByPhone(phone);
  }
  if (!user && email) {
    user = getUserByEmail(email);
  }

  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Invalid login or password' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid login or password' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email
    }
  });
});

// ---- Simple health route ----

app.get('/', (req, res) => {
  res.send('Geata API is running');
});

// ---- Devices (admin + public list) ----

// Public devices list (for debugging / admin)
app.get('/devices', (req, res) => {
  res.json(getDevices());
});

// Create a new device (admin)
app.post('/devices', requireAdminKey, (req, res) => {
  const { id, name } = req.body;
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

// List users attached to a device (admin)
app.get('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  res.json(getDeviceUsers(deviceId));
});

// Add user to device (admin)
// Expects JSON: { userId, role } where userId already exists in users table
app.post('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const { userId, role } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  addUserToDevice(deviceId, userId, role || 'operator');
  res.status(201).json({ deviceId, userId, role: role || 'operator' });
});

// Remove user from device (admin)
app.delete('/devices/:id/users/:userId', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const ok = removeUserFromDevice(deviceId, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ status: 'removed' });
});

// Get user schedule (admin)
app.get('/devices/:id/users/:userId/schedule', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const row = getUserAccessRuleRow(deviceId, userId);
  if (!row) {
    return res.json({
      deviceId,
      userId,
      defaultAccess: true,
      message: 'No specific schedule; user has 24/7 access'
    });
  }

  res.json(normalizeRuleRow(row));
});

// Set/replace user schedule (admin)
app.put('/devices/:id/users/:userId/schedule', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const updated = upsertUserAccessRule(deviceId, userId, req.body);
  res.json(updated);
});

// Bulk import users for a device (admin)
// Expects JSON: { rows: [ { name, email, phone, role }, ... ] }
app.post('/devices/:id/users/import', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const { rows } = req.body;

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array is required' });
  }

  const created = [];
  const reused = [];

  rows.forEach((r) => {
    const name = r.name && String(r.name).trim() ? String(r.name).trim() : null;
    const email = r.email && String(r.email).trim() ? String(r.email).trim() : null;
    const phone = r.phone && String(r.phone).trim() ? String(r.phone).trim() : null;
    const role = r.role && String(r.role).trim() ? String(r.role).trim() : 'operator';

    if (!phone && !email) {
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

    addUserToDevice(deviceId, user.id, role);
  });

  res.json({
    status: 'ok',
    created,
    reused
  });
});

// ---- User lookup for admin ----

// GET /users?q=...  (admin)
// Returns all users (optionally filtered) + their devices
app.get('/users', requireAdminKey, (req, res) => {
  const q = (req.query.q || '').trim();
  const users = listUsersWithDevices(q || null);
  res.json(users);
});

// ---- User-facing endpoints ----

// Current user's devices (for app.html)
app.get('/me/devices', requireUser, (req, res) => {
  const devices = getUserDevices(req.user.id);
  res.json(devices);
});

// Open gate (user-facing) – requires JWT, uses logged-in user
app.post('/devices/:id/open', requireUser, (req, res) => {
  const deviceId = req.params.id;
  const { durationMs } = req.body;

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const userId = req.user.id;

  if (!isUserAllowedOnDevice(deviceId, userId)) {
    return res.status(403).json({ error: 'User not allowed on this device' });
  }

  if (!isWithinUserSchedule(deviceId, userId)) {
    return res.status(403).json({ error: 'Access not allowed at this time' });
  }

  const cmd = createCommand(deviceId, userId, 'OPEN', durationMs || 1000);
  res.status(201).json(cmd);
});

// Recent commands (admin)
app.get('/commands', requireAdminKey, (req, res) => {
  res.json(getRecentCommands(20));
});

// ---- Device route: ESP/gate polls here ----
//
// Body: { deviceId, lastResults: [ { commandId, result }, ... ] }
// Response: { commands: [ { commandId, type, durationMs }, ... ] }
//
app.post('/device/poll', (req, res) => {
  const { deviceId, lastResults } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not registered' });
  }

  applyCommandResults(deviceId, lastResults);

  const queued = getQueuedCommands(deviceId);
  const toSend = queued.map(c => ({
    commandId: c.id,
    type: c.type,
    durationMs: c.duration_ms
  }));

  res.json({ commands: toSend });
});

// ---- Start server ----

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Geata API listening on port ${PORT}`);
  console.log(`Admin API key is: ${ADMIN_API_KEY}`);
});
