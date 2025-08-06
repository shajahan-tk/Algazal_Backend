import express from "express";
import {
  createBankReport,
  getBankReports,
  getBankReport,
  updateBankReport,
  deleteBankReport,
  getBankFinancialSummary,
  getBankReportStatistics,
  exportBankReportsToExcel,
} from "../controllers/bankController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";

const router = express.Router();

router.use(authenticate);

// Bank Report CRUD routes
router.post(
  "/",
  authorize(["admin", "super_admin", "accountant"]),
  upload.array("attachments", 10),
  createBankReport
);

router.get("/", getBankReports); // Supports year, month, type, shop, category, amount range, search filters
router.get("/summary", getBankFinancialSummary); // Financial aggregation data
router.get("/statistics", getBankReportStatistics); // Detailed statistics
router.get("/export/excel", exportBankReportsToExcel);
router.get("/:id", getBankReport); // Get single report by ID

router.put(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  upload.array("attachments", 10),
  updateBankReport
);

router.delete(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  deleteBankReport
);

export default router;
