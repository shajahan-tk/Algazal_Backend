import express from "express";
import {
    setInvoiceDetails,
    getInvoiceDetails,
    clearInvoiceDetails,
} from "../controllers/invoiceController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get invoice details for a project
router.get(
    "/:id",
    authorize(["admin", "super_admin", "finance", "engineer"]),
    getInvoiceDetails
);

// Set invoice date and remarks
router.put(
    "/:id",
    authorize(["admin", "super_admin", "finance"]),
    setInvoiceDetails
);

// Clear invoice details
router.delete(
    "/:id",
    authorize(["admin", "super_admin"]),
    clearInvoiceDetails
);

export default router;