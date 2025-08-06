import express from "express";
import {
  createProjectProfit,
  getProjectProfits,
  getProjectProfit,
  updateProjectProfit,
  deleteProjectProfit,
  getProfitSummary,
  exportProjectProfitsToExcel,
} from "../controllers/projectProfitController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";

const router = express.Router();

router.use(authenticate);

router.post(
  "/",
  authorize(["admin", "super_admin", "accountant"]),
  upload.array("attachments", 10),
  createProjectProfit
);
router.get("/", getProjectProfits);
router.get("/export/excel", exportProjectProfitsToExcel);
router.get("/summary", getProfitSummary);
router.get("/:id", getProjectProfit);
router.put(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  upload.array("attachments", 10),
  updateProjectProfit
);
router.delete(
  "/:id",
  authorize(["admin", "super_admin", "accountant"]),
  deleteProjectProfit
);

export default router;