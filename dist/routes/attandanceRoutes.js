"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const attendanceController_1 = require("../controllers/attendanceController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// PROJECT ATTENDANCE ROUTES
// Driver marks project attendance
router.post("/project/:projectId/user/:userId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["driver"]), attendanceController_1.markAttendance);
// Get user project attendance
router.get("/project/:projectId/user/:userId", authMiddleware_1.authenticate, attendanceController_1.getAttendance);
// Get project-wide attendance
router.get("/project/:projectId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["admin", "super_admin", "project_manager"]), attendanceController_1.getProjectAttendance);
// Get today's project attendance
router.get("/project/:projectId/today", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["admin", "super_admin", "project_manager", "driver"]), attendanceController_1.getTodayProjectAttendance);
// Get project attendance summary
router.get("/project/:projectId/summary", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["admin", "super_admin", "project_manager", "engineer"]), attendanceController_1.getAttendanceSummary);
// NORMAL ATTENDANCE ROUTES
// Mark normal attendance
router.post("/normal/:userId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["super_admin", "admin"]), attendanceController_1.markAttendance);
// Get daily normal attendance for all users
router.get("/normal/daily", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["super_admin", "admin"]), attendanceController_1.dailyNormalAttendance);
// FIXED: Get user's monthly attendance (all types combined)
router.get("/normal/monthly/:userId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["super_admin", "admin", "project_manager"]), attendanceController_1.getNormalMonthlyAttendance);
// NEW: Get user's monthly attendance by specific type or all types
router.get("/user/:userId/monthly", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["super_admin", "admin", "project_manager"]), attendanceController_1.getUserMonthlyAttendanceByType);
// NEW: Get user's all attendance records (for calendar view)
router.get("/user/:userId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["super_admin", "admin", "project_manager"]), attendanceController_1.getAttendance);
exports.default = router;
//# sourceMappingURL=attandanceRoutes.js.map