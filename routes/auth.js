// routes/auth.js
import express from "express";
import { normalizePhone, randomId } from "../utils/helpers.js";
import { signToken } from "../utils/auth.js";
import { one, q } from "../utils/db.js";
import bcrypt from "bcryptjs";
import { badRequest } from "../utils/errors.js";

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

// Login
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

export default router;
