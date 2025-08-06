import express from "express";
import {
  createPayroll,
  getPayrolls,
  getPayroll,
  updatePayroll,
  deletePayroll,
  exportPayrollsToExcel
} from "../controllers/payrollController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Create payroll record
router.post(
  "/",
  authorize(["admin", "super_admin", "accountant"]),
  createPayroll
);

// Get all payroll records with filters
router.get("/", getPayrolls);

// Export payrolls to Excel
router.get("/export/excel", exportPayrollsToExcel);

// Get single payroll record
router.get("/:id", getPayroll);

// Update payroll record
router.put(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  updatePayroll
);

// Delete payroll record
router.delete(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  deletePayroll
);

export default router;