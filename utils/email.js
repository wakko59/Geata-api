// utils/email.js
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

const USE_SENDGRID = String(process.env.USE_SENDGRID || "false").toLowerCase() === "true";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM = process.env.SENDGRID_FROM;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || "465");
const SMTP_SECURE = String(process.env.SMTP_SECURE || "true").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `Geata <${SMTP_USER}>` : "Geata");


let smtpTransporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  smtpTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendEmail(to, subject, text) {
  if (!to) return false;

  // Try SendGrid first
  if (USE_SENDGRID && SENDGRID_API_KEY && SENDGRID_FROM) {
    try {
      const fromInfo = SENDGRID_FROM.match(/^(.*)<([^>]+)>$/) || [];
      const from = {
        email: fromInfo[2]?.trim() || SENDGRID_FROM.trim(),
        name: fromInfo[1]?.trim() || "Geata",
      };
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from,
          subject,
          content: [{ type: "text/plain", value: text }],
        }),
      });
      if (res.ok) return true;
    } catch {}
  }

  // Fallback to SMTP
  if (smtpTransporter) {
    try {
      await smtpTransporter.sendMail({ from: SMTP_FROM, to, subject, text });
      return true;
    } catch {}
  }

  return false;
}
