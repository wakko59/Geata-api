// utils/db.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const DATABASE_URL = process.env.DATABASE_URL;


const { Pool } = pg;

if (!DATABASE_URL) {
  console.warn("*** WARNING: DATABASE_URL is not set. ***");
}

const useSSL = String(process.env.PGSSL || "").toLowerCase() === "true"
  || process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

export async function q(text, params = []) {
  return pool.query(text, params);
}

export async function one(text, params = []) {
  const r = await q(text, params);
  return r.rows[0] || null;
}
