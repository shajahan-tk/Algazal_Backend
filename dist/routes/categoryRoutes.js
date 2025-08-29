"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const categoryController_1 = require("../controllers/categoryController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Category CRUD routes
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), categoryController_1.createCategory);
router.get("/", categoryController_1.getCategories);
router.get("/:id", categoryController_1.getCategory);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), categoryController_1.updateCategory);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), categoryController_1.deleteCategory);
exports.default = router;
//# sourceMappingURL=categoryRoutes.js.map