import express from "express";
import {
  createBank,
  getBanks,
  getBank,
  updateBank,
  deleteBank,
} from "../controllers/bankDetailsController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// For now no need to link banks to createdBy, but keep admin protection if required
router.use(authenticate);

router.post("/", authorize(["admin", "super_admin"]), createBank);
router.get("/", getBanks);
router.get("/:id", getBank);
router.put("/:id", authorize(["admin", "super_admin"]), updateBank);
router.delete("/:id", authorize(["admin", "super_admin"]), deleteBank);

export default router;
