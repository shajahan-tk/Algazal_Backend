import express from "express";
import {
  createQuotation,
  getQuotationByProject,
  updateQuotation,
  approveQuotation,
  deleteQuotation,
  generateQuotationPdf,
  uploadQuotationImages,
  deleteQuotationImage,
  getQuotationImages,
  updateQuotationImage, // Add this import
  replaceQuotationImage, // Add this import
} from "../controllers/quotationController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";
import { sendQuotationEmail } from "../controllers/sendMailPdfController";

const router = express.Router();

router.use(authenticate);

// Create quotation (without images)
router.post(
  "/",
  authorize(["admin", "super_admin", "engineer"]),
  createQuotation
);

// Upload images separately
router.post(
  "/:id/images",
  authorize(["admin", "super_admin", "engineer"]),
  upload.array("images", 10),
  uploadQuotationImages
);

// Get quotation images
router.get(
  "/:id/images",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getQuotationImages
);

// Update image metadata (title, description, relatedItemIndex)
router.patch(
  "/:id/images/:imageId",
  authorize(["admin", "super_admin", "engineer"]),
  updateQuotationImage
);

// Replace image file
router.put(
  "/:id/images/:imageId/replace",
  authorize(["admin", "super_admin", "engineer"]),
  upload.single("image"),
  replaceQuotationImage
);

// Delete quotation image
router.delete(
  "/:id/images/:imageId",
  authorize(["admin", "super_admin", "engineer"]),
  deleteQuotationImage
);

// ... other existing routes
router.get(
  "/project/:projectId",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getQuotationByProject
);

router.put(
  "/:id",
  authorize(["admin", "super_admin", "engineer"]),
  updateQuotation
);

router.patch(
  "/:id/approval",
  authorize(["admin", "super_admin"]),
  approveQuotation
);

router.delete("/:id", authorize(["admin", "super_admin"]), deleteQuotation);

router.post(
  "/:id/send-email",
  authorize(["admin", "super_admin", "engineer"]),
  sendQuotationEmail
);

router.get(
  "/:id/generate-pdf",
  authorize(["admin", "super_admin", "engineer"]),
  generateQuotationPdf
);

export default router;