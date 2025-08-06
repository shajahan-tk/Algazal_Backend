import express from "express";
import {
  createCategory,
  getCategories,
  getCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticate);

// Category CRUD routes
router.post("/", authorize(["admin", "super_admin"]), createCategory);
router.get("/", getCategories);
router.get("/:id", getCategory);
router.put("/:id", authorize(["admin", "super_admin"]), updateCategory);
router.delete("/:id", authorize(["admin", "super_admin"]), deleteCategory);

export default router;
