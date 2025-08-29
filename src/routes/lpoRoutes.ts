import express from "express";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import {
  createLPO,
  getLPOsByProject,
  getLPODetails,
  deleteLPO,
  updateLPO,
} from "../controllers/lpoController";
import { upload } from "../config/multer";

const router = express.Router();

router.use(authenticate);

// Create LPO with document uploads
router.post(
  "/",
  authorize(["admin", "super_admin", "finance"]),
  upload.array("documents", 5), // Max 5 files
  createLPO
);

// Get all LPOs for a project
router.get(
  "/project/:projectId",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  getLPOsByProject
);
router.put('/:id', upload.array('documents', 5 ), updateLPO);
// Get LPO details
router.get(
  "/:id",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  getLPODetails
);

// Delete LPO
router.delete("/:id", authorize(["admin", "super_admin"]), deleteLPO);

export default router;
