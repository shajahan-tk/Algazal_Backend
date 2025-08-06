import express from "express";
import {
  createEmployeeExpense,
  getEmployeeExpenses,
  getEmployeeExpense,
  updateEmployeeExpense,
  deleteEmployeeExpense,
  exportEmployeeExpensesToExcel,
} from "../controllers/employeeExpenseController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticate);

router.post(
  "/",
  authorize(["admin", "super_admin", "finance"]),
  createEmployeeExpense
);
router.get("/", getEmployeeExpenses);
router.get("/export/excel", exportEmployeeExpensesToExcel);
router.get("/:id", getEmployeeExpense);
router.put(
  "/:id",
  authorize(["admin", "super_admin", "finance"]),
  updateEmployeeExpense
);
router.delete(
  "/:id",
  authorize(["admin", "super_admin", "finance"]),
  deleteEmployeeExpense
);

export default router;