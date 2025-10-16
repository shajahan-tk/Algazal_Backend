"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const quotationController_1 = require("../controllers/quotationController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const sendMailPdfController_1 = require("../controllers/sendMailPdfController");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Create quotation (without images)
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), quotationController_1.createQuotation);
// Upload images separately
router.post("/:id/images", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), multer_1.upload.array("images", 10), quotationController_1.uploadQuotationImages);
// Get quotation images
router.get("/:id/images", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), quotationController_1.getQuotationImages);
// Update image metadata (title, description, relatedItemIndex)
router.patch("/:id/images/:imageId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), quotationController_1.updateQuotationImage);
// Replace image file
router.put("/:id/images/:imageId/replace", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), multer_1.upload.single("image"), quotationController_1.replaceQuotationImage);
// Delete quotation image
router.delete("/:id/images/:imageId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), quotationController_1.deleteQuotationImage);
// ... other existing routes
router.get("/project/:projectId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), quotationController_1.getQuotationByProject);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), quotationController_1.updateQuotation);
router.patch("/:id/approval", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), quotationController_1.approveQuotation);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), quotationController_1.deleteQuotation);
router.post("/:id/send-email", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), sendMailPdfController_1.sendQuotationEmail);
router.get("/:id/generate-pdf", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), quotationController_1.generateQuotationPdf);
exports.default = router;
//# sourceMappingURL=quotationRoutes.js.map