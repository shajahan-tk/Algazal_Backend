import express from "express";
import { getProjectProfitReport } from "../controllers/projectProfitController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get project profit report with pagination, filtering, and export
router.get(
  "/monthly-report",
  authorize(["admin", "super_admin", "finance"]),
  getProjectProfitReport
);

export default router;