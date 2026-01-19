// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { requireAdminKey } from "../utils/auth.js";
import { q } from "../utils/db.js";
import { badRequest } from "../utils/errors.js";

const router = express.Router();

// GET all users (admin)
router.get("/users", requireAdminKey, async (req, res) => {
  try {
    const result = await q(
      "SELECT id, name, email, phone FROM users ORDER BY id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /users failed:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// GET one user (admin)
router.get("/users/:id", requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await q(
      "SELECT id, name, email, phone FROM users WHERE id=$1",
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /users/:id failed:", err);
    res.status(500).json({ error: "Failed to load user" });
  }
});

// UPDATE user credentials (admin)
router.put("/users/:id", requireAdminKey, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, password } = req.body || {};

  if (
    name === undefined &&
    email === undefined &&
    phone === undefined &&
    password === undefined
  ) {
    return badRequest(res, "No valid fields provided to update");
  }

  try {
    // Verify user exists
    const exists = await q("SELECT id FROM users WHERE id = $1", [id]);
    if (!exists.rows.length) {
      return badRequest(res, "User not found");
    }

    // Build update parts
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
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${idx}`);
      values.push(hashed);
      idx++;
    }

    if (!updates.length) {
      return badRequest(res, "No valid fields to update");
    }

    // Add user id for WHERE
    values.push(id);

    // Run update
    const sql = `
      UPDATE users
         SET ${updates.join(", ")}
       WHERE id = $${idx}
    `;
    await q(sql, values);

    // Return updated user (basic fields)
    const updated = await q(
      "SELECT id, name, email, phone FROM users WHERE id = $1",
      [id]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error("PUT /users/:id failed:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// DELETE user (admin)
router.delete("/users/:id", requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    await q("DELETE FROM users WHERE id = $1", [id]);
    res.json({ deleted: id });
  } catch (err) {
    console.error("DELETE /users/:id failed:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
