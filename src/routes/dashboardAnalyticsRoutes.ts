// src/routes/dashboardAnalyticsRoutes.ts

import express from "express";
import {
  getDashboardSummary,
  getOverviewStats,
  getAttendanceData,
  getFinancialSummary,
  getProjectStatus,
  getHRAlerts,
  getTopClients,
  getPayrollData,
  getProjectProfitAnalytics,
  getEstimationAnalytics,

} from "../controllers/dashboard/dashboardAnalyticsController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { getMonthlyReport, getYearlyReport } from "../controllers/dashboard/exportController";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Overview routes
router.get("/summary", getDashboardSummary); // Combined endpoint for faster loading
router.get("/overview-stats", getOverviewStats);
router.get("/attendance-data", getAttendanceData);
router.get("/financial-summary", getFinancialSummary);
router.get("/project-status", getProjectStatus);
router.get("/hr-alerts", getHRAlerts);
router.get("/top-clients", getTopClients);

// Profit analytics
router.get(
  "/profit-analytics",
  authorize(["admin", "super_admin", "finance"]),
  getProjectProfitAnalytics
);

// Payroll analytics
router.get(
  "/payroll",
  authorize(["admin", "super_admin", "finance", "accountant"]),
  getPayrollData
);

// Estimation analytics
router.get("/estimation-analytics", getEstimationAnalytics);

// NEW: Report downloads
router.get(
  "/monthly-report",
  authorize(["admin", "super_admin", "finance"]),
  getMonthlyReport
);

router.get(
  "/yearly-report",
  authorize(["admin", "super_admin", "finance"]),
  getYearlyReport
);

export default router;