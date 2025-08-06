import express from "express";
import {
  createVehicle,
  getVehicles,
  getVehicle,
  updateVehicle,
  deleteVehicle,
  getVehicleByNumber,
} from "../controllers/vehicleController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";

const router = express.Router();

router.use(authenticate);

// Vehicle CRUD routes
router.post(
  "/",
  authorize(["admin", "super_admin"]),
  upload.array("attachments", 10),
  createVehicle
);

router.get("/", getVehicles);
router.get("/:id", getVehicle);
router.put(
  "/:id",
  authorize(["admin", "super_admin"]),
  upload.array("attachments", 10),
  updateVehicle
);
router.delete("/:id", authorize(["admin", "super_admin"]), deleteVehicle);

// Special vehicle routes
router.get("/number/:vehicleNumber", getVehicleByNumber);

export default router;
