import express from "express";
import {
  createBill,
  getBills,
  getBill,
  updateBill,
  deleteBill,
  getFinancialSummary,
  getBillStatistics,
  exportBillsToExcel,
} from "../controllers/billController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";

const router = express.Router();

router.use(authenticate);

// Bill CRUD routes
router.post(
  "/",
  authorize(["admin", "super_admin", "accountant"]),
  upload.array("attachments", 10),
  createBill
);

router.get("/", getBills); // Supports year, month, type, shop, vehicle, amount range, search filters
router.get("/summary", getFinancialSummary); // Financial aggregation data
router.get("/statistics", getBillStatistics); // Detailed statistics
router.get("/export/excel", exportBillsToExcel);
router.get("/:id", getBill); // Get single bill by ID

router.put(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  upload.array("attachments", 10),
  updateBill
);

router.delete(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  deleteBill
);

export default router;
