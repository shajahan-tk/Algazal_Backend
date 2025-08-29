"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// routes/analytics.routes.ts
const express_1 = __importDefault(require("express"));
const attendanceAnalytics_1 = require("../controllers/attendanceAnalytics");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Main dashboard overview
router.get("/overview", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["hr", "admin", "super_admin"]), attendanceAnalytics_1.getOverviewStats);
// Individual employee trend
router.get("/employee/:employeeId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["hr", "admin", "super_admin"]), attendanceAnalytics_1.getEmployeeTrend);
// All projects analytics
router.get("/projects", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["hr", "admin", "super_admin"]), attendanceAnalytics_1.getProjectAnalyticsAll);
// Specific project analytics
router.get("/projects/:projectId", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["hr", "admin", "super_admin"]), attendanceAnalytics_1.getProjectAnalytics);
exports.default = router;
//# sourceMappingURL=analyticalRoute.js.map