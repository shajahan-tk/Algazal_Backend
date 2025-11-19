import express from "express";
import {
  createOrUpdateAttendance,
  deleteAttendanceRecord,
  getUserProjects,
  getUserDateAttendance,  // ← ADD THIS IMPORT
} from "../controllers/attendanceManagementController";
import { authenticate } from "../middlewares/authMiddleware";

const router = express.Router();

// Create or update attendance record
router.post("/create-update", authenticate, createOrUpdateAttendance);

// Delete attendance record
router.delete("/delete/:attendanceId", authenticate, deleteAttendanceRecord);

// Get user's projects for dropdown
router.get("/user/:userId/projects", authenticate, getUserProjects);

// ✅ ADD THIS ROUTE
// Get user's attendance for a specific date
router.get("/user/:userId/date", authenticate, getUserDateAttendance);

export default router;