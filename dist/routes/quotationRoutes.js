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
// Add debugging middleware before upload
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), (req, res, next) => {
    console.log("Content-Type header:", req.headers["content-type"]);
    next();
}, multer_1.upload.any(), (req, res, next) => {
    console.log("Multer processed files:", req.files);
    next();
}, quotationController_1.createQuotation);
// ... other routes
router.get("/project/:projectId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), quotationController_1.getQuotationByProject);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), multer_1.upload.any(), quotationController_1.updateQuotation);
router.patch("/:id/approval", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), quotationController_1.approveQuotation);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), quotationController_1.deleteQuotation);
router.post("/:id/send-email", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), sendMailPdfController_1.sendQuotationEmail);
router.get("/:id/generate-pdf", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), quotationController_1.generateQuotationPdf);
exports.default = router;
//# sourceMappingURL=quotationRoutes.js.map