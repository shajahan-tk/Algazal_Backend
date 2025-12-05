import express from "express";
import {
    getInvoiceReport,
    getClientsForFilter
} from "../controllers/invoiceReportController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get invoice report with pagination, filtering, and export
router.get(
    "/",
    authorize(["admin", "super_admin", "finance"]),
    getInvoiceReport
);

// Get clients for filter dropdown
router.get(
    "/clients",
    authorize(["admin", "super_admin", "finance"]),
    getClientsForFilter
);

export default router;