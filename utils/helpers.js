// utils/helpers.js
import crypto from "crypto";

export function normalizePhone(raw) {
  if (!raw) return null;
  return String(raw).trim();
}

export function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export function safeCompare(a, b) {
  const bufA = Buffer.from(a || "", "utf8");
  const bufB = Buffer.from(b || "", "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
