import express from "express";
import { requireAdminKey } from "../utils/auth.js";
import { q } from "../utils/db.js";
import { badRequest } from "../utils/errors.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// PUT update user credentials
router.put(
  "/users/:userId",
  requireAdminKey,
  async (req, res) => {
    const { userId } = req.params;
    let { name, email, phone, password } = req.body || {};

    if (!name && !email && !phone && !password) {
      return badRequest(res, "No fields provided to update");
    }

    try {
      // First — get existing user to ensure it exists
      const existing = await q(
        "SELECT id FROM users WHERE id = $1",
        [userId]
      );

      if (!existing.rows.length) {
        return badRequest(res, "User not found");
      }

      const updates = [];
      const values = [];
      let idx = 1;

      if (name !== undefined) {
        updates.push(`name = $${idx}`);
        values.push(name);
        idx++;
      }
      if (email !== undefined) {
        updates.push(`email = $${idx}`);
        values.push(email);
        idx++;
      }
      if (phone !== undefined) {
        updates.push(`phone = $${idx}`);
        values.push(phone);
        idx++;
      }
      if (password) {
        // Hash the new password
        const passwordHash = await bcrypt.hash(password, 10);
        updates.push(`password_hash = $${idx}`);
        values.push(passwordHash);
        idx++;
      }

      if (updates.length === 0) {
        return badRequest(res, "No valid fields to update");
      }

      // Add userId for WHERE clause
      values.push(userId);

      // Build and execute update
      const sql = `
        UPDATE users
           SET ${updates.join(", ")}
         WHERE id = $${idx}
      `;
      await q(sql, values);

      // Respond with the updated user basic info
      const out = await q(
        "SELECT id, name, email, phone FROM users WHERE id = $1",
        [userId]
      );

      res.json(out.rows[0]);
    } catch (err) {
      console.error("Error updating user:", err);
      res
        .status(500)
        .json({ error: "Failed to update user credentials" });
    }
  }
);

export default router;
