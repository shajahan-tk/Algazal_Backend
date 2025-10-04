// routes/attendanceManagementRoutes.js - UPDATED
import express from "express";
import {
  createOrUpdateAttendance,
  deleteAttendanceRecord,
  getUserProjects,
} from "../controllers/attendanceManagementController";
import { authenticate } from "../middlewares/authMiddleware";

const router = express.Router();

// Create or update attendance record
router.post("/create-update", authenticate, createOrUpdateAttendance);

// Delete attendance record
router.delete("/delete/:attendanceId", authenticate, deleteAttendanceRecord);

// Get user's projects for dropdown
router.get("/user/:userId/projects", authenticate, getUserProjects);

export default router;