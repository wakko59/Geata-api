// routes/auth.js
import express from "express";
import { normalizePhone, randomId } from "../utils/helpers.js";
import { signToken } from "../utils/auth.js";
import { one, q } from "../utils/db.js";
import bcrypt from "bcryptjs";
import { badRequest } from "../utils/errors.js";
import jwt from "jsonwebtoken";


const router = express.Router();

// Create user (admin, with ADMIN API KEY)
router.post("/auth/register", async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!password || (!email && !phone)) {
    return badRequest(res, "password and at least phone or email required");
  }
  const p = normalizePhone(phone);
  if (p) {
    const existing = await one("SELECT 1 FROM users WHERE phone=$1", [p]);
    if (existing) return badRequest(res, "Phone exists");
  }
  if (email) {
    const existing = await one("SELECT 1 FROM users WHERE email=$1", [email]);
    if (existing) return badRequest(res, "Email exists");
  }
  const hash = bcrypt.hashSync(password, 10);
  const id = randomId("u");
  await q("INSERT INTO users(id,name,email,phone,password_hash) VALUES($1,$2,$3,$4,$5)", [
    id, name, email, p, hash,
  ]);
  const token = signToken(id);
  res.status(201).json({ token, user: { id, name, email, phone: p } });
});
// ————————————————
// Return the current logged‑in user
// ————————————————
// ================================
// GET /me — return logged-in user
// ================================
// ================================
// GET /me — Return the logged‑in user
// ================================
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = auth.slice(7);

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("JWT verify failed:", err);
      return res.status(401).json({ error: "Invalid token" });
    }

    // Fetch user (exclude password_hash)
    const user = await one(
      "SELECT id, name, email, phone FROM users WHERE id=$1",
      [payload.userId]
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (e) {
    console.error("GET /me error:", e);
    res.status(500).json({ error: e.message });
  }
});



// Login Route
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
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
});
// =======================================================
// GET /me/devices — return devices for logged-in user
// =======================================================
router.get("/me/devices", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }

    const token = auth.slice(7);

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Fetch devices this user belongs to
    const rows = await q(
      `
      SELECT 
        du.device_id AS id,
        d.name AS name,
        du.role AS role
      FROM device_users du
      JOIN devices d ON d.id = du.device_id
      WHERE du.user_id = $1
      `,
      [payload.userId]
    );

    // Normalize response
    const devices = (rows || []).map((d) => ({
      id: d.id,
      name: d.name,
      role: d.role,
    }));

    res.json(devices);
  } catch (e) {
    console.error("GET /me/devices error:", e);
    res.status(500).json({ error: e.message });
  }
});
export default router;
