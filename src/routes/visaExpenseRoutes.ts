import express from "express";
import {
  createVisaExpense,
  getVisaExpenses,
  getVisaExpense,
  updateVisaExpense,
  deleteVisaExpense,
  exportVisaExpensesToExcel,
} from "../controllers/visaExpenseController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticate);

// Visa Expense CRUD routes
router.post("/", authorize(["admin", "super_admin", "accountant"]), createVisaExpense);
router.get("/", getVisaExpenses);
router.get("/export/excel", exportVisaExpensesToExcel);
router.get("/:id", getVisaExpense);
router.put("/:id", authorize(["admin", "super_admin", "accountant"]), updateVisaExpense);
router.delete("/:id", authorize(["admin", "super_admin", "accountant"]), deleteVisaExpense);

export default router;