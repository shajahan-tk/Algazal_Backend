import express from "express";
import { getProjectProfitReport } from "../controllers/projectProfitController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticate);

router.get(
  "/monthly-report",
  authorize(["admin", "super_admin", "finance"]),
  getProjectProfitReport
);

export default router;