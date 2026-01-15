// routes/users.js
import express from "express";
import { requireAdminKey, requireUser } from "../utils/auth.js";
import { one, q } from "../utils/db.js";
import { normalizePhone } from "../utils/helpers.js";
import { badRequest, notFound } from "../utils/errors.js";

const router = express.Router();

// Admin: list/search users
router.get("/users", requireAdminKey, async (req, res) => {
  const qstr = (req.query.q || "").trim();
  const pattern = `%${qstr}%`;
  const r = await q(
    `SELECT * FROM users
     WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR id ILIKE $1
     ORDER BY LOWER(name)`,
    [pattern]
  );

  const users = [];
  for (const u of r.rows) {
    const devices = (await q("SELECT device_id AS \"deviceId\", role FROM device_users WHERE user_id=$1", [u.id])).rows;
    users.push({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      devices,
    });
  }
  res.json(users);
});

// GET single user
router.get("/users/:id", requireAdminKey, async (req, res) => {
  const { id } = req.params;
  const u = await one("SELECT * FROM users WHERE id=$1", [id]);
  if (!u) return notFound(res, "user");
  const devices = (await q("SELECT device_id AS \"deviceId\", role FROM device_users WHERE user_id=$1", [id])).rows;
  res.json({ ...u, devices });
});

// UPDATE user (admin)
router.put("/users/:id", requireAdminKey, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, password } = req.body || {};
  const p = normalizePhone(phone);

  // Duplicate checks
  if (p) {
    const dup = await one("SELECT 1 FROM users WHERE phone=$1 AND id<>$2", [p, id]);
    if (dup) return badRequest(res, "Phone already in use");
  }
  if (email) {
    const dup2 = await one("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [email, id]);
    if (dup2) return badRequest(res, "Email already in use");
  }

  const cols = [];
  const vals = [];
  if (name) { cols.push("name=$" + (cols.length + 1)); vals.push(name); }
  if (email) { cols.push("email=$" + (cols.length + 1)); vals.push(email); }
  if (p) { cols.push("phone=$" + (cols.length + 1)); vals.push(p); }
  if (password) { 
    const hash = bcrypt.hashSync(password, 10);
    cols.push("password_hash=$" + (cols.length + 1)); 
    vals.push(hash);
  }

  if (!cols.length) return badRequest(res, "No fields to update");

  await q(`UPDATE users SET ${cols.join(",")} WHERE id=$${cols.length+1}`, [...vals, id]);
  const updated = await one("SELECT * FROM users WHERE id=$1", [id]);
  res.json(updated);
});

// DELETE user (admin)
router.delete("/users/:id", requireAdminKey, async (req, res) => {
  await q("DELETE FROM users WHERE id=$1", [req.params.id]);
  res.json({ status: "deleted" });
});

// Profile (for front end user profile)
router.get("/me", requireUser, async (req, res) => {
  const u = await one("SELECT id,name,email,phone FROM users WHERE id=$1", [req.user.id]);
  if (!u) return notFound(res, "user");
  res.json(u);
});

export default router;
