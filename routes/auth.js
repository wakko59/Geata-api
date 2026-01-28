// routes/auth.js
import express from "express";
import { normalizePhone, randomId } from "../utils/helpers.js";
import { signToken } from "../utils/auth.js";
import { one, q } from "../utils/db.js";
import bcrypt from "bcryptjs";
import { badRequest } from "../utils/errors.js";
import jwt from "jsonwebtoken";

const router = express.Router();

// ======================
// Auth helper
// ======================
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    console.error("requireAuth JWT verify failed:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ======================
// Register new user
// Requires ADMIN API KEY (external checks may be needed)
// ======================
router.post("/auth/register", async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!password || (!email && !phone)) {
    return badRequest(res, "password and at least phone or email required");
  }

  // Normalize phone
  const p = normalizePhone(phone);

  // Check duplicates
  if (p) {
    const existingPhone = await one("SELECT 1 FROM users WHERE phone=$1", [p]);
    if (existingPhone) return badRequest(res, "Phone exists");
  }
  if (email) {
    const existingEmail = await one("SELECT 1 FROM users WHERE email=$1", [email]);
    if (existingEmail) return badRequest(res, "Email exists");
  }

  // Create user
  const hash = bcrypt.hashSync(password, 10);
  const id = randomId("u");
  await q(
    "INSERT INTO users(id,name,email,phone,password_hash) VALUES($1,$2,$3,$4,$5)",
    [id, name, email, p, hash]
  );

  const token = signToken(id);
  res.status(201).json({ token, user: { id, name, email, phone: p } });
});

// ================================
// GET /me — Return the logged‑in user
// ================================
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await one(
      "SELECT id, name, email, phone FROM users WHERE id=$1",
      [req.userId]
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (err) {
    console.error("GET /me error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================================
// POST /auth/login
// ================================
router.post("/auth/login", async (req, res) => {
  const { phone, email, password } = req.body || {};
  if ((!phone && !email) || !password) {
    return badRequest(res, "phone/email and password required");
  }

  const user = phone
    ? await one("SELECT * FROM users WHERE phone=$1", [normalizePhone(phone)])
    : await one("SELECT * FROM users WHERE email=$1", [email]);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken(user.id);
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
  });
});

// ============================================
// GET /me/devices — Return devices for the user
// ============================================
router.get("/me/devices", requireAuth, async (req, res) => {
  try {
    const result = await q(
      `
      SELECT 
        du.device_id AS id,
        d.name AS name,
        du.role AS role
      FROM device_users du
      JOIN devices d ON d.id = du.device_id
      WHERE du.user_id = $1
      `,
      [req.userId]
    );

    const rows = Array.isArray(result) ? result : result?.rows || [];

    const devices = rows.map((d) => ({
      id: d.id,
      name: d.name,
      role: d.role || "operator",
    }));

    res.json(devices);
  } catch (err) {
    console.error("GET /me/devices error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /devices/:deviceId/open
// Acknowledge/queue OPEN command
// ============================================
router.post("/devices/:deviceId/open", requireAuth, async (req, res) => {
  const { deviceId } = req.params;
  try {
    // STUB: queue logic later
    return res.json({ status: "queued", command: "OPEN" });
  } catch (err) {
    console.error("POST /devices/open error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /devices/:deviceId/aux1
// Acknowledge/queue AUX1 command
// ============================================
router.post("/devices/:deviceId/aux1", requireAuth, async (req, res) => {
  const { deviceId } = req.params;
  try {
    // STUB: queue logic later
    return res.json({ status: "queued", command: "AUX1" });
  } catch (err) {
    console.error("POST /devices/aux1 error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ======================================================
// GET /devices/:deviceId/user-settings
// Return merged device settings
// ======================================================
router.get("/devices/:deviceId/user-settings", requireAuth, async (req, res) => {
  const { deviceId } = req.params;

  try {
    const row = await one(
      `
      SELECT
        aux1_mode,
        gate_ajar_seconds,
        notify_supervisor_eng,
        settings
      FROM device_settings
      WHERE device_id = $1
      `,
      [deviceId]
    );

    const defaults = {
      aux1Mode: "relay",
      gateAjarSeconds: 60,
      notifySupervisorOnEng: false,
    };

    if (!row) {
      return res.json(defaults);
    }

    const merged = {
      ...defaults,
      ...(row.settings || {}),
      ...(row.aux1_mode != null && { aux1Mode: row.aux1_mode }),
      ...(row.gate_ajar_seconds != null && {
        gateAjarSeconds: row.gate_ajar_seconds,
      }),
      ...(row.notify_supervisor_eng != null && {
        notifySupervisorOnEng: row.notify_supervisor_eng,
      }),
    };

    return res.json(merged);
  } catch (err) {
    console.error("GET user-settings error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
