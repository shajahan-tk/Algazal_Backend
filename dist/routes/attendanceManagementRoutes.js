"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// routes/attendanceManagementRoutes.js - UPDATED
const express_1 = __importDefault(require("express"));
const attendanceManagementController_1 = require("../controllers/attendanceManagementController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Create or update attendance record
router.post("/create-update", authMiddleware_1.authenticate, attendanceManagementController_1.createOrUpdateAttendance);
// Delete attendance record
router.delete("/delete/:attendanceId", authMiddleware_1.authenticate, attendanceManagementController_1.deleteAttendanceRecord);
// Get user's projects for dropdown
router.get("/user/:userId/projects", authMiddleware_1.authenticate, attendanceManagementController_1.getUserProjects);
exports.default = router;
//# sourceMappingURL=attendanceManagementRoutes.js.map