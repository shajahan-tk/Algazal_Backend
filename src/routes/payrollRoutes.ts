import express from "express";
import {
  createPayroll,
  getPayrolls,
  getPayroll,
  updatePayroll,
  deletePayroll,
  exportPayrollsToExcel,
  generatePayslipPDF,
  getPayslipData
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

// Generate payslip PDF (must come before /:id routes)
router.get(
  "/:id/pdf",
  authorize(["super_admin", "admin", "accountant", "finance"]),
  generatePayslipPDF
);

// Get payslip data (preview) (must come before /:id routes)
router.get(
  "/:id/data",
  authorize(["super_admin", "admin", "accountant", "finance"]),
  getPayslipData
);

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