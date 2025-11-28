import express from "express";
import {
    createBudget,
    getProjectBudget,
    updateMonthlyBudgets,
    deleteMonthlyBudget,
} from "../controllers/budgetController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticate);

// Create budget for a project
router.post(
    "/project/:projectId",
    authorize(["admin", "super_admin", "finance"]),
    createBudget
);

// Get budget for a project
router.get(
    "/project/:projectId",
    authorize(["admin", "super_admin", "engineer", "finance"]),
    getProjectBudget
);

// Update monthly budget allocations
router.put(
    "/project/:projectId/monthly",
    authorize(["admin", "super_admin", "finance"]),
    updateMonthlyBudgets
);

// Delete a monthly budget allocation
router.delete(
    "/project/:projectId/monthly",
    authorize(["admin", "super_admin", "finance"]),
    deleteMonthlyBudget
);

export default router;