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


export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}
