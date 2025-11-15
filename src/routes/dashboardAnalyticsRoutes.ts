// routes/analyticalRoute.ts
import express from "express";
import {
  getDashboardStats,
  getProjectAnalytics,
  getFinancialAnalytics,
} from "../controllers/dashboardAnalyticsController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Dashboard stats
router.get("/dashboard", getDashboardStats);

// Project analytics
router.get("/projects", getProjectAnalytics);

// Financial analytics
router.get("/financial", getFinancialAnalytics);

export default router;