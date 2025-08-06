import express from "express";
import { 
    generateMonthlyReport,
    generateYearlyReport
} from "../controllers/monthlyReportController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticate);

// Report routes
router.get("/monthly", authorize(["admin", "super_admin", "accountant"]), generateMonthlyReport);
router.get("/yearly", authorize(["admin", "super_admin", "accountant"]), generateYearlyReport);

export default router;