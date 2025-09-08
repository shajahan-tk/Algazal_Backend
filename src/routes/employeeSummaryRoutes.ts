import express from "express";
import { getEmployeeSummary } from "../controllers/employeeSummaryController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get employee summary
router.get(
  "/:id",
  authorize(["admin", "super_admin", "finance", "engineer", "supervisor"]),
  getEmployeeSummary
);

export default router;