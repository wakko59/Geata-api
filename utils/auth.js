// utils/auth.js
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";


export function requireAdminKey(req, res, next) {
  const key = req.header("x-api-key");
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized: invalid admin key" });
  }
  next();
}

export function requireUser(req, res, next) {
  const auth = req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Invalid token format" });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
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

export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}
