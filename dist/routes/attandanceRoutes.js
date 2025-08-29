"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const attendanceController_1 = require("../controllers/attendanceController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Driver marks attendance
router.post("/project/:projectId/user/:userId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["driver"]), attendanceController_1.markAttendance);
// Get user attendance
router.get("/project/:projectId/user/:userId", authMiddleware_1.authenticate, attendanceController_1.getAttendance);
// Get project-wide attendance
router.get("/project/:projectId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["admin", "super_admin", "project_manager"]), attendanceController_1.getProjectAttendance);
router.get("/project/:projectId/today", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["admin", "super_admin", "project_manager", "driver"]), attendanceController_1.getTodayProjectAttendance);
// Add this to your existing attendanceRoutes.ts
router.get("/project/:projectId/summary", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["admin", "super_admin", "project_manager", "engineer"]), attendanceController_1.getAttendanceSummary);
router.post("/normal/:userId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["super_admin", "admin"]), attendanceController_1.markAttendance);
router.get("/normal/daily", attendanceController_1.dailyNormalAttendance);
router.get("/normal/monthly/:userId", attendanceController_1.getNormalMonthlyAttendance);
exports.default = router;
//# sourceMappingURL=attandanceRoutes.js.map