"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const shopController_1 = require("../controllers/shopController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Shop CRUD routes
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), multer_1.upload.array("shopAttachments", 10), // Allow up to 10 files
shopController_1.createShop);
router.get("/", shopController_1.getShops);
router.get("/:id", shopController_1.getShop);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), multer_1.upload.array("shopAttachments", 10), shopController_1.updateShop);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), shopController_1.deleteShop);
// Special shop routes
router.get("/vat/:vatNumber", shopController_1.getShopByVat);
exports.default = router;
//# sourceMappingURL=shopRoutes.js.map