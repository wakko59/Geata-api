// utils/email.js
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import {
  USE_SENDGRID, SENDGRID_API_KEY, SENDGRID_FROM,
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
} from "../config.js";

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
