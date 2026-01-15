import express from "express";
import config from "./config.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import deviceRoutes from "./routes/devices.js";
import scheduleRoutes from "./routes/schedules.js";
import eventRoutes from "./routes/events.js";
import reportRoutes from "./routes/reports.js";
import adminRoutes from "./routes/admin.js";
import pollingRoutes from "./routes/polling.js";
import { pool } from "./utils/db.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Mount routes
app.use(authRoutes);
app.use(userRoutes);
app.use(deviceRoutes);
app.use(scheduleRoutes);
app.use(eventRoutes);
app.use(reportRoutes);
app.use(adminRoutes);
app.use(pollingRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Start
const PORT = config.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}, build ${config.BUILD_TAG}`);
});
