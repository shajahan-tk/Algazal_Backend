import express from "express";
import { getEmployeeSummary } from "../controllers/payrollController";
import { authenticate } from "../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticate);

router.get("/:id", getEmployeeSummary);

export default router;