// index.js - Geata backend
// - SQLite (better-sqlite3)
// - Phone/email + password login (JWT)
// - Devices, users, device_users
// - Schedules, commands, device poll
// - Admin APIs + global user editing + CSV import
// - Device tokens (user_devices) for PWA auto-login

const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

console.log('*** GEATA BACKEND STARTING ***');
console.log('*** USING INDEX.JS AT:', __filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Config ----

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-only-admin-key';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-jwt-secret';
const PORT = process.env.PORT || 3000;

// ---- SQLite setup ----

const db = new Database('myapi.db');

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

    CREATE TABLE IF NOT EXISTS user_devices (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      device_token TEXT UNIQUE NOT NULL,
      created_at   TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_user_devices_user_id
      ON user_devices(user_id);
  `);

  // Seed example devices if none
  const countDevices = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
  if (countDevices === 0) {
    const insertDevice = db.prepare('INSERT INTO devices (id, name) VALUES (?, ?)');
    insertDevice.run('gate1', 'Warehouse Gate');
    insertDevice.run('gate2', 'Yard Barrier');
  }
}

initDb();

// ---- Helper functions ----

// Phone normalisation (Irish-centric)
function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).trim();

  // 00353... -> +353...
  if (p.startsWith('00')) {
    p = '+' + p.slice(2);
  }

  // If no +, assume Irish and leading 0 if present
  if (!p.startsWith('+')) {
    if (p.startsWith('0')) {
      p = '+353' + p.slice(1);
    } else {
      p = '+353' + p;
    }
  }

  return p;
}

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
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserByPhone(phone) {
  if (!phone) return null;
  const norm = normalizePhone(phone);
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(norm);
}

function createUser({ name, email, phone, password }) {
  const id = 'u_' + Date.now();
  const hash = password ? bcrypt.hashSync(password, 10) : null;
  const normPhone = phone ? normalizePhone(phone) : null;

  db.prepare(
    'INSERT INTO users (id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    name || email || normPhone || id,
    email || null,
    normPhone,
    hash
  );

  return getUserById(id);
}

function updateUser(userId, { name, email, phone, password }) {
  const user = getUserById(userId);
  if (!user) return null;

  const newName =
    name && String(name).trim() ? String(name).trim() : user.name;
  const newEmail =
    email && String(email).trim() ? String(email).trim() : user.email;
  const newPhone = phone ? normalizePhone(phone) : user.phone;

  let newHash = user.password_hash;
  if (typeof password === 'string' && password.length > 0) {
    newHash = bcrypt.hashSync(password, 10);
  }

  db.prepare(`
    UPDATE users
    SET name = ?, email = ?, phone = ?, password_hash = ?
    WHERE id = ?
  `).run(newName, newEmail, newPhone, newHash, userId);

  return getUserById(userId);
}

// Device users
function getDeviceUsers(deviceId) {
  return db.prepare(`
    SELECT
      du.user_id AS userId,
      du.role,
      u.name,
      u.email,
      u.phone
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

// Access rules
function getUserAccessRuleRow(deviceId, userId) {
  return db.prepare(`
    SELECT * FROM user_access_rules
    WHERE device_id = ? AND user_id = ?
    LIMIT 1
  `).get(deviceId, userId);
}

function normalizeRule(row) {
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

  return normalizeRule(getUserAccessRuleRow(deviceId, userId));
}

function isWithinUserSchedule(deviceId, userId, now = new Date()) {
  const row = getUserAccessRuleRow(deviceId, userId);

  // No rule = 24/7 access
  if (!row) return true;

  const rule = normalizeRule(row);

  const day = now.getDay(); // 0–6
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
  const id = 'cmd_' + Date.now();
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

// User lookup with devices
function listUsersWithDevices(query) {
  let rows;
  if (query && query.trim()) {
    const q = '%' + query.trim().toLowerCase() + '%';
    rows = db.prepare(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        COALESCE(
          GROUP_CONCAT(du.device_id || ':' || du.role),
          ''
        ) AS devices_str
      FROM users u
      LEFT JOIN device_users du ON du.user_id = u.id
      WHERE lower(u.name) LIKE ?
         OR lower(IFNULL(u.email, '')) LIKE ?
         OR lower(IFNULL(u.phone, '')) LIKE ?
      GROUP BY u.id
      ORDER BY u.name
    `).all(q, q, q);
  } else {
    rows = db.prepare(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        COALESCE(
          GROUP_CONCAT(du.device_id || ':' || du.role),
          ''
        ) AS devices_str
      FROM users u
      LEFT JOIN device_users du ON du.user_id = u.id
      GROUP BY u.id
      ORDER BY u.name
    `).all();
  }

  return rows.map(r => {
    const devices = [];
    if (r.devices_str) {
      r.devices_str.split(',').forEach(entry => {
        const [deviceId, role] = entry.split(':');
        if (deviceId) {
          devices.push({ deviceId, role: role || 'operator' });
        }
      });
    }
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      devices
    };
  });
}

// Device tokens
function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex
}

function createOrReplaceDeviceTokenForUser(userId) {
  const nowIso = new Date().toISOString();
  // One device per user (for now): remove any existing tokens
  db.prepare('DELETE FROM user_devices WHERE user_id = ?').run(userId);

  const token = generateDeviceToken();
  db.prepare(`
    INSERT INTO user_devices (user_id, device_token, created_at, last_seen_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, token, nowIso, nowIso);

  return token;
}

function findUserByDeviceToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.*
    FROM user_devices ud
    JOIN users u ON u.id = ud.user_id
    WHERE ud.device_token = ?
  `).get(token);
  return row || null;
}

function touchDeviceToken(token) {
  if (!token) return;
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE user_devices SET last_seen_at = ? WHERE device_token = ?')
    .run(nowIso, token);
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

function requireDeviceToken(req, res, next) {
  const token = req.header('x-device-token');
  if (!token) {
    return res.status(401).json({ error: 'Missing device token' });
  }
  const user = findUserByDeviceToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid device token' });
  }
  touchDeviceToken(token);
  req.user = { id: user.id };
  req.deviceToken = token;
  next();
}

// ---- Auth endpoints ----

// Register (demo; not critical in production)
app.post('/auth/register', (req, res) => {
  const { name, email, phone, password } = req.body;

  if ((!phone && !email) || !password) {
    return res
      .status(400)
      .json({ error: 'phone or email and password are required' });
  }

  if (email) {
    const existingEmail = getUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
  }
  if (phone) {
    const existingPhone = getUserByPhone(phone);
    if (existingPhone) {
      return res.status(409).json({ error: 'User with this phone already exists' });
    }
  }

  const user = createUser({ name, email, phone, password });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

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

// Login with phone or email
app.post('/auth/login', (req, res) => {
  const { phone, email, password } = req.body;

  console.log('*** /auth/login CALLED ***');
  console.log('*** BODY:', req.body);

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
    console.log('*** /auth/login INVALID USER OR NO PASSWORD_HASH');
    return res.status(401).json({ error: 'Invalid login or password' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    console.log('*** /auth/login BAD PASSWORD');
    return res.status(401).json({ error: 'Invalid login or password' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

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

// ---- User-facing / app routes ----

app.get('/', (req, res) => {
  res.send('Geata API is running');
});

// List all devices (for debug/admin; app uses /me/devices*)
app.get('/devices', (req, res) => {
  res.json(getDevices());
});

// Devices for logged-in user (JWT)
app.get('/me/devices', requireUser, (req, res) => {
  const userId = req.user.id;
  const rows = db.prepare(`
    SELECT d.id, d.name, du.role
    FROM devices d
    JOIN device_users du ON du.device_id = d.id
    WHERE du.user_id = ?
    ORDER BY d.name
  `).all(userId);
  res.json(rows);
});

// Devices for user identified by device token
app.get('/me/devices-by-token', requireDeviceToken, (req, res) => {
  const userId = req.user.id;
  const rows = db.prepare(`
    SELECT d.id, d.name, du.role
    FROM devices d
    JOIN device_users du ON du.device_id = d.id
    WHERE du.user_id = ?
    ORDER BY d.name
  `).all(userId);
  res.json(rows);
});

// Create or replace device token for logged-in user
app.post('/device/activate', requireUser, (req, res) => {
  const userId = req.user.id;
  const token = createOrReplaceDeviceTokenForUser(userId);
  res.json({ deviceToken: token });
});

// Open gate (user-facing, JWT)
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

// Open gate using device token
app.post('/devices/:id/open-by-token', requireDeviceToken, (req, res) => {
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

// ---- Admin routes ----

// Create a new device
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

// List users attached to a device
app.get('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  res.json(getDeviceUsers(deviceId));
});

// Create/reuse user and attach to device
//
// Accepts either:
//  - { userId, role }
//  - or { name, email, phone, password, role }
app.post('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  let { userId, name, email, phone, password, role } = req.body;

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  let user = null;

  if (userId) {
    user = getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
  } else {
    if (!phone && !email) {
      return res.status(400).json({
        error: 'userId or phone/email is required'
      });
    }

    if (phone) {
      user = getUserByPhone(phone);
    }
    if (!user && email) {
      user = getUserByEmail(email);
    }

    if (!user) {
      user = createUser({ name, email, phone, password });
    } else {
      user = updateUser(user.id, { name, email, phone, password });
    }

    userId = user.id;
  }

  addUserToDevice(deviceId, userId, role || 'operator');

  res.status(201).json({
    deviceId,
    userId,
    role: role || 'operator',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    }
  });
});

// Bulk import users CSV for a device
app.post('/devices/:id/users/import', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const { rows } = req.body;

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows array is required' });
  }

  const created = [];
  const reused  = [];

  rows.forEach(row => {
    const name  = row.name || '';
    const email = row.email || '';
    const phone = row.phone || '';
    const role  = row.role || 'operator';

    if (!email && !phone && !name) return;

    let user = null;

    if (phone) {
      user = getUserByPhone(phone);
    }
    if (!user && email) {
      user = getUserByEmail(email);
    }

    if (!user) {
      user = createUser({ name, email, phone, password: null });
      created.push({ id: user.id, name: user.name, email: user.email, phone: user.phone });
    } else {
      const updated = updateUser(user.id, { name, email, phone, password: null });
      reused.push({ id: updated.id, name: updated.name, email: updated.email, phone: updated.phone });
      user = updated;
    }

    addUserToDevice(deviceId, user.id, role);
  });

  res.json({ created, reused });
});

// Remove user from a device
app.delete('/devices/:id/users/:userId', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const ok = removeUserFromDevice(deviceId, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ status: 'removed' });
});

// Get user schedule for a device
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

  res.json(normalizeRule(row));
});

// Set/replace user schedule for a device
app.put('/devices/:id/users/:userId/schedule', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const updated = upsertUserAccessRule(deviceId, userId, req.body);
  res.json(updated);
});

// Recent commands
app.get('/commands', requireAdminKey, (req, res) => {
  res.json(getRecentCommands(20));
});

// ---- Device route: ESP/gate polls here ----

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

// ---- User lookup for admin ----

// GET /users?q=...
app.get('/users', requireAdminKey, (req, res) => {
  const q = (req.query.q || '').trim();
  const users = listUsersWithDevices(q || null);
  res.json(users);
});

// PUT /users/:userId – global user edit
app.put('/users/:userId', requireAdminKey, (req, res) => {
  const userId = req.params.userId;
  const { name, email, phone, password } = req.body;

  const updated = updateUser(userId, { name, email, phone, password });
  if (!updated) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    phone: updated.phone
  });
});

// DELETE /users/:userId – remove completely
app.delete('/users/:userId', requireAdminKey, (req, res) => {
  const userId = req.params.userId;

  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.prepare('DELETE FROM device_users WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_access_rules WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_devices WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  res.json({ status: 'deleted', userId });
});

// ---- Start server ----

app.listen(PORT, () => {
  console.log(`Geata API listening on port ${PORT}`);
  console.log(`Admin API key is: ${ADMIN_API_KEY}`);
});
