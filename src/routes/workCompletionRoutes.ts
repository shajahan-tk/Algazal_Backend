import express from "express";
import {
  createWorkCompletion,
  uploadWorkCompletionImages,
  getWorkCompletion,
  deleteWorkCompletionImage,
  getProjectWorkCompletionImages,
  getCompletionData,
  generateCompletionCertificatePdf,
  updateCompletionDate,
  updateHandoverDate,
  updateAcceptanceDate,
} from "../controllers/workCompletionController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";
import { sendWorkCompletionEmail } from "@/controllers/sendMailPdfController";

const router = express.Router();

router.use(authenticate);

router.post(
  "/",
  authorize(["engineer", "admin", "super_admin"]),
  createWorkCompletion
);

router.post(
  "/project/:projectId/images",
  authorize(["engineer", "admin", "super_admin"]),
  upload.array("images", 10),
  uploadWorkCompletionImages
);

router.get("/project/:projectId", getWorkCompletion);
router.get("/project/:projectId/images", getProjectWorkCompletionImages);
router.get("/project/:projectId/work-comp", getCompletionData);
router.get(
  "/project/:projectId/certificate",
  authorize(["engineer", "admin", "super_admin"]),
  generateCompletionCertificatePdf
);

router.post(
  "/project/:projectId/send-email",
  authorize(["engineer", "admin", "super_admin"]),
  sendWorkCompletionEmail
);


// New routes for date updates
router.put(
  "/project/:projectId/completion-date",
  authorize(["engineer", "admin", "super_admin"]),
  updateCompletionDate
);

router.put(
  "/project/:projectId/handover-date",
  authorize(["engineer", "admin", "super_admin"]),
  updateHandoverDate
);

router.put(
  "/project/:projectId/acceptance-date",
  authorize(["engineer", "admin", "super_admin"]),
  updateAcceptanceDate
);

router.delete(
  "/:workCompletionId/images/:imageId",
  authorize(["engineer", "admin", "super_admin"]),
  deleteWorkCompletionImage
);

export default router;
