// config.js
import dotenv from "dotenv";
dotenv.config();

export const BUILD_TAG = process.env.BUILD_TAG || "local-dev";
export const PORT = process.env.PORT || 3000;

export const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
export const JWT_SECRET = process.env.JWT_SECRET;

export const USE_SENDGRID = Boolean(process.env.SENDGRID_API_KEY);
export const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
export const SENDGRID_FROM = process.env.SENDGRID_FROM;

export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
export const SMTP_SECURE = String(process.env.SMTP_SECURE || "true") === "true";
export const SMTP_USER = process.env.SMTP_USER;
export const SMTP_PASS = process.env.SMTP_PASS;
export const SMTP_FROM = process.env.SMTP_FROM;
