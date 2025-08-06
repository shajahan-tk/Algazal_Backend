import express from "express";
import {
  createShop,
  getShops,
  getShop,
  updateShop,
  deleteShop,
  getShopByVat,
  getShopsByPincode,
} from "../controllers/shopController";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { upload } from "../config/multer";

const router = express.Router();

router.use(authenticate);

// Shop CRUD routes
router.post(
  "/",
  authorize(["admin", "super_admin"]),
  upload.array("shopAttachments", 10), // Allow up to 10 files
  createShop
);

router.get("/", getShops);
router.get("/:id", getShop);
router.put(
  "/:id",
  authorize(["admin", "super_admin"]),
  upload.array("shopAttachments", 10),
  updateShop
);
router.delete("/:id", authorize(["admin", "super_admin"]), deleteShop);

// Special shop routes
router.get("/vat/:vatNumber", getShopByVat);

export default router;
