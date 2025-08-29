"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const workCompletionController_1 = require("../controllers/workCompletionController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
router.post("/", (0, authMiddleware_1.authorize)(["engineer", "admin", "super_admin"]), workCompletionController_1.createWorkCompletion);
router.post("/project/:projectId/images", (0, authMiddleware_1.authorize)(["engineer", "admin", "super_admin"]), multer_1.upload.array("images", 10), workCompletionController_1.uploadWorkCompletionImages);
router.get("/project/:projectId", workCompletionController_1.getWorkCompletion);
router.get("/project/:projectId/images", workCompletionController_1.getProjectWorkCompletionImages);
router.get("/project/:projectId/work-comp", workCompletionController_1.getCompletionData);
router.get("/project/:projectId/certificate", (0, authMiddleware_1.authorize)(["engineer", "admin", "super_admin"]), workCompletionController_1.generateCompletionCertificatePdf);
// New routes for date updates
router.put("/project/:projectId/completion-date", (0, authMiddleware_1.authorize)(["engineer", "admin", "super_admin"]), workCompletionController_1.updateCompletionDate);
router.put("/project/:projectId/handover-date", (0, authMiddleware_1.authorize)(["engineer", "admin", "super_admin"]), workCompletionController_1.updateHandoverDate);
router.put("/project/:projectId/acceptance-date", (0, authMiddleware_1.authorize)(["engineer", "admin", "super_admin"]), workCompletionController_1.updateAcceptanceDate);
router.delete("/:workCompletionId/images/:imageId", (0, authMiddleware_1.authorize)(["engineer", "admin", "super_admin"]), workCompletionController_1.deleteWorkCompletionImage);
exports.default = router;
//# sourceMappingURL=workCompletionRoutes.js.map