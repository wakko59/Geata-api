// index.js
// Backend with:
// - SQLite persistence
// - Admin API key protection for admin endpoints
// - Users with name/email/phone/password_hash
// - Per-device roles (admin/operator) via device_users
// - Schedules per user+device (date range, days-of-week, time windows)
// - Commands queue for devices, device poll endpoint
// - JWT-based /auth/register and /auth/login (for the mobile/web app)
// - CSV import for users per device
// - User lookup endpoints /users and /users/:id
// - User deletion (only if not attached to any devices)

const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Config ----

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-only-admin-key';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-jwt-secret';

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
      email         TEXT,
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
  `);

  const countDevices = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
  if (countDevices === 0) {
    const insertDevice = db.prepare('INSERT INTO devices (id, name) VALUES (?, ?)');
    insertDevice.run('gate1', 'Warehouse Gate');
    insertDevice.run('gate2', 'Yard Barrier');
  }
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
  return db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(email);
}

function createUser({ name, email, phone, password }) {
  const id = 'u_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const hash = password ? bcrypt.hashSync(password, 10) : null;

  db.prepare(
    'INSERT INTO users (id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name || email || id, email || null, phone || null, hash);

  return getUserById(id);
}

function updateUserRecord(id, { name, email, phone, password }) {
  const user = getUserById(id);
  if (!user) return null;

  const newName =
    name !== undefined && name !== null && name !== '' ? name : user.name;
  const newEmail =
    email !== undefined && email !== null && email !== '' ? email : user.email;
  const newPhone =
    phone !== undefined && phone !== null && phone !== '' ? phone : user.phone;

  let newHash = user.password_hash;
  if (password) {
    newHash = bcrypt.hashSync(password, 10);
  }

  db.prepare(
    'UPDATE users SET name = ?, email = ?, phone = ?, password_hash = ? WHERE id = ?'
  ).run(newName, newEmail, newPhone, newHash, id);

  return getUserById(id);
}

// Find by ID or email
function findUserByIdentifier(identifier) {
  if (!identifier) return null;
  let user = getUserById(identifier);
  if (user) return user;
  if (identifier.includes('@')) {
    user = getUserByEmail(identifier);
    if (user) return user;
  }
  return null;
}

// Aggregate: users with devices/roles
function getUsersWithDevices(query) {
  let rows;
  if (query) {
    const like = `%${query}%`;
    rows = db.prepare(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        GROUP_CONCAT(d.id)   AS device_ids,
        GROUP_CONCAT(d.name) AS device_names,
        GROUP_CONCAT(du.role) AS roles
      FROM users u
      LEFT JOIN device_users du ON du.user_id = u.id
      LEFT JOIN devices d ON d.id = du.device_id
      WHERE u.name  LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
      GROUP BY u.id
      ORDER BY u.name
    `).all(like, like, like);
  } else {
    rows = db.prepare(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        GROUP_CONCAT(d.id)   AS device_ids,
        GROUP_CONCAT(d.name) AS device_names,
        GROUP_CONCAT(du.role) AS roles
      FROM users u
      LEFT JOIN device_users du ON du.user_id = u.id
      LEFT JOIN devices d ON d.id = du.device_id
      GROUP BY u.id
      ORDER BY u.name
    `).all();
  }

  return rows.map(r => {
    let devices = [];
    if (r.device_ids) {
      const ids = r.device_ids.split(',');
      const names = (r.device_names || '').split(',');
      const roles = (r.roles || '').split(',');
      devices = ids.map((id, idx) => ({
        deviceId: id,
        deviceName: names[idx] || null,
        role: roles[idx] || null
      }));
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

function getUserWithDevices(userId) {
  const row = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.phone,
      GROUP_CONCAT(d.id)   AS device_ids,
      GROUP_CONCAT(d.name) AS device_names,
      GROUP_CONCAT(du.role) AS roles
    FROM users u
    LEFT JOIN device_users du ON du.user_id = u.id
    LEFT JOIN devices d ON d.id = du.device_id
    WHERE u.id = ?
    GROUP BY u.id
  `).get(userId);

  if (!row) return null;

  let devices = [];
  if (row.device_ids) {
    const ids = row.device_ids.split(',');
    const names = (row.device_names || '').split(',');
    const roles = (row.roles || '').split(',');
    devices = ids.map((id, idx) => ({
      deviceId: id,
      deviceName: names[idx] || null,
      role: roles[idx] || null
    }));
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    devices
  };
}

// Device users
function getDeviceUsers(deviceId) {
  return db.prepare(`
    SELECT du.user_id AS userId,
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

function updateDeviceUserRole(deviceId, userId, role) {
  db.prepare(`
    UPDATE device_users
    SET role = ?
    WHERE device_id = ? AND user_id = ?
  `).run(role, deviceId, userId);
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

// Does user still have any device assignments?
function userHasDevices(userId) {
  const c = db
    .prepare('SELECT COUNT(*) AS c FROM device_users WHERE user_id = ?')
    .get(userId).c;
  return c > 0;
}

// Access rules (schedules)
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

  if (!row) return true; // no rule = 24/7

  const rule = normalizeRule(row);

  const day = now.getDay(); // 0–6
  const timeStr = now.toTimeString().slice(0, 5);
  const dateStr = now.toISOString().slice(0, 10);

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

// ---- Auth endpoints ----

app.post('/auth/register', (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const existing = getUserByEmail(email);
  let user;

  if (existing) {
    if (existing.password_hash) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    user = updateUserRecord(existing.id, { name, email, phone, password });
  } else {
    user = createUser({ name, email, phone, password });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = getUserByEmail(email);
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });
});

// ---- App-facing routes ----

app.get('/', (req, res) => {
  res.send('API is running');
});

app.get('/me/devices', requireUser, (req, res) => {
  const userId = req.user.id;
  const rows = db.prepare(`
    SELECT d.id, d.name
    FROM devices d
    JOIN device_users du ON du.device_id = d.id
    WHERE du.user_id = ?
  `).all(userId);

  res.json(rows);
});

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

// ---- Admin routes ----

// Devices
app.get('/devices', (req, res) => {
  res.json(getDevices());
});

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

// Device users
app.get('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  res.json(getDeviceUsers(deviceId));
});

// Attach/create user to device
app.post('/devices/:id/users', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const { userId, role, name, email, phone, password } = req.body;

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  let finalUserId = userId;
  let user;

  if (userId) {
    // Attach existing user by ID or email
    user = findUserByIdentifier(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    finalUserId = user.id;
  } else {
    // Create or reuse by email
    if (!email) {
      return res.status(400).json({ error: 'email is required when creating a user' });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      user = updateUserRecord(existing.id, {
        name: name || existing.name,
        email: existing.email,
        phone: phone || existing.phone,
        password: password || null
      });
    } else {
      user = createUser({ name, email, phone, password: password || null });
    }
    finalUserId = user.id;
  }

  addUserToDevice(deviceId, finalUserId, role || 'operator');

  res.status(201).json({
    deviceId,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    },
    role: role || 'operator'
  });
});

// CSV import
app.post('/devices/:id/users/import', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const { users } = req.body;
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: 'users array is required' });
  }

  const createdOrAttached = [];

  users.forEach(u => {
    const name = (u.name || '').trim();
    const email = (u.email || '').trim();
    const phone = (u.phone || '').trim();
    let role = (u.role || '').trim().toLowerCase();

    if (role !== 'admin' && role !== 'operator') {
      role = 'operator';
    }

    if (!name && !email && !phone) {
      return;
    }

    let user = null;

    if (email) {
      const existing = getUserByEmail(email);
      if (existing) {
        user = updateUserRecord(existing.id, {
          name: name || existing.name,
          email: existing.email,
          phone: phone || existing.phone,
          password: null
        });
      } else {
        user = createUser({ name, email, phone, password: null });
      }
    } else {
      user = createUser({ name, email: null, phone, password: null });
    }

    addUserToDevice(deviceId, user.id, role);

    createdOrAttached.push({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role
    });
  });

  res.json({
    deviceId,
    importedCount: createdOrAttached.length,
    users: createdOrAttached
  });
});

// Update user & role for specific device
app.put('/devices/:id/users/:userId', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;
  const { name, email, phone, password, role } = req.body;

  const device = getDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const existingUser = getUserById(userId);
  if (!existingUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const updated = updateUserRecord(userId, { name, email, phone, password });

  if (role) {
    updateDeviceUserRole(deviceId, userId, role);
  }

  const du = db
    .prepare('SELECT role FROM device_users WHERE device_id = ? AND user_id = ?')
    .get(deviceId, userId);

  res.json({
    deviceId,
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone
    },
    role: du ? du.role : role || 'operator'
  });
});

// Remove user from device
app.delete('/devices/:id/users/:userId', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const ok = removeUserFromDevice(deviceId, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ status: 'removed' });
});

// Schedules
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

app.put('/devices/:id/users/:userId/schedule', requireAdminKey, (req, res) => {
  const deviceId = req.params.id;
  const userId = req.params.userId;

  const updated = upsertUserAccessRule(deviceId, userId, req.body);
  res.json(updated);
});

// Commands (admin)
app.get('/commands', requireAdminKey, (req, res) => {
  res.json(getRecentCommands(20));
});

// ---- User lookup + delete ----

app.get('/users', requireAdminKey, (req, res) => {
  const q = req.query.q || '';
  const users = getUsersWithDevices(q || null);
  res.json(users);
});

app.get('/users/:id', requireAdminKey, (req, res) => {
  const userId = req.params.id;
  const user = getUserWithDevices(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

// Delete a user entirely (only if not attached to any devices)
app.delete('/users/:id', requireAdminKey, (req, res) => {
  const userId = req.params.id;
  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (userHasDevices(userId)) {
    return res.status(400).json({
      error: 'User is still attached to one or more devices. Remove from devices first.'
    });
  }

  // Clean up any schedules or commands referencing this user
  db.prepare('DELETE FROM user_access_rules WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM commands WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  res.json({ status: 'deleted' });
});

// ---- Device poll (ESP) ----

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
  console.log(`Server listening on port ${PORT}`);
  console.log(`Admin API key is: ${ADMIN_API_KEY}`);
});
