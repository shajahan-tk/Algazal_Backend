import express from "express";
import {
  createExpense,
  getProjectExpenses,
  getExpenseSummary,
  updateExpense,
  deleteExpense,
  getExpenseById,
  getProjectLaborData,
  generateExpensePdf,
} from "../controllers/expenseController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";

const router = express.Router();

router.use(authenticate);

// Labor data endpoint
router.get(
  "/project/:projectId/labor-data",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getProjectLaborData
);

router.post(
  "/project/:projectId",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  upload.fields([
    { name: "files", maxCount: 100 }, // Changed from "materials" to "files"
  ]),
  createExpense
);

router.get(
  "/project/:projectId",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getProjectExpenses
);

router.get(
  "/project/:projectId/summary",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getExpenseSummary
);

router.get(
  "/:expenseId",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getExpenseById
);

router.put(
  "/:expenseId",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  upload.fields([
    { name: "files", maxCount: 100 }, // Changed from "materialFiles" to "files"
  ]),
  updateExpense
);

router.delete(
  "/:expenseId",
  authorize(["admin", "super_admin", "finance"]),
  deleteExpense
);

router.get(
  "/:id/pdf",
  authenticate,
  authorize(["admin", "super_admin", "engineer", "finance"]),
  generateExpensePdf
);

export default router;
