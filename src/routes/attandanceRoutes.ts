import express from "express";
import {
  markAttendance,
  getAttendance,
  getProjectAttendance,
  getTodayProjectAttendance,
  getAttendanceSummary,
  dailyNormalAttendance,
  getNormalMonthlyAttendance,
  getUserMonthlyAttendanceByType,
} from "../controllers/attendanceController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// PROJECT ATTENDANCE ROUTES
// Driver marks project attendance
router.post(
  "/project/:projectId/user/:userId",
  authenticate,
  authorize(["driver"]),
  markAttendance
);

// Get user project attendance
router.get("/project/:projectId/user/:userId", authenticate, getAttendance);

// Get project-wide attendance
router.get(
  "/project/:projectId",
  authenticate,
  authorize(["admin", "super_admin", "project_manager"]),
  getProjectAttendance
);

// Get today's project attendance
router.get(
  "/project/:projectId/today",
  authenticate,
  authorize(["admin", "super_admin", "project_manager", "driver"]),
  getTodayProjectAttendance
);

// Get project attendance summary
router.get(
  "/project/:projectId/summary",
  authenticate,
  authorize(["admin", "super_admin", "project_manager", "engineer"]),
  getAttendanceSummary
);

// NORMAL ATTENDANCE ROUTES
// Mark normal attendance
router.post(
  "/normal/:userId",
  authenticate,
  authorize(["super_admin", "admin"]),
  markAttendance
);

// Get daily normal attendance for all users
router.get(
  "/normal/daily",
  authenticate,
  authorize(["super_admin", "admin"]),
  dailyNormalAttendance
);

// FIXED: Get user's monthly attendance (all types combined)
router.get(
  "/normal/monthly/:userId",
  authenticate,
  authorize(["super_admin", "admin", "project_manager"]),
  getNormalMonthlyAttendance
);

// NEW: Get user's monthly attendance by specific type or all types
router.get(
  "/user/:userId/monthly",
  authenticate,
  authorize(["super_admin", "admin", "project_manager"]),
  getUserMonthlyAttendanceByType
);

// NEW: Get user's all attendance records (for calendar view)
router.get(
  "/user/:userId",
  authenticate,
  authorize(["super_admin", "admin", "project_manager"]),
  getAttendance
);

export default router;