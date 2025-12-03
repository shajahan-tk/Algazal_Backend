// src/routes/dashboardAnalyticsRoutes.ts
import express from "express";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import {
  getOverviewStats,
  getAttendanceData,
  getFinancialSummary,
  getProjectStatus,
  getHRAlerts,
  getTopClients,
  getPayrollData,
  getInvoiceReports,
  getProjectProfitAnalytics,
  getEstimationAnalytics,
  getDashboardSummary
} from "../controllers/dashboard/dashboardAnalyticsController";

const router = express.Router();

router.use(authenticate);

// Overview statistics
router.get("/overview", authorize(["admin", "super_admin", "finance", "engineer"]), getOverviewStats);

// Attendance data
router.get("/attendance", authorize(["admin", "super_admin", "finance", "engineer"]), getAttendanceData);

// Financial summary
router.get("/financial-summary", authorize(["admin", "super_admin", "finance"]), getFinancialSummary);

// Project status
router.get("/project-status", authorize(["admin", "super_admin", "finance", "engineer"]), getProjectStatus);

// HR alerts
router.get("/hr-alerts", authorize(["admin", "super_admin", "hr"]), getHRAlerts);

// Top clients
router.get("/top-clients", authorize(["admin", "super_admin", "sales"]), getTopClients);

// Payroll data
router.get("/payroll", authorize(["admin", "super_admin", "finance", "hr"]), getPayrollData);

// Invoice reports
router.get("/invoices", authorize(["admin", "super_admin", "finance"]), getInvoiceReports);

// Project profit analytics
router.get("/profit-analytics", authorize(["admin", "super_admin", "finance"]), getProjectProfitAnalytics);

// Estimation analytics
router.get("/estimation-analytics", authorize(["admin", "super_admin", "sales", "engineer"]), getEstimationAnalytics);

// Dashboard summary (combined endpoint for faster loading)
router.get("/summary", authorize(["admin", "super_admin", "finance", "engineer"]), getDashboardSummary);

export default router;