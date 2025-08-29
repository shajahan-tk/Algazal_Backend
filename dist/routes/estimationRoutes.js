"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const estimationController_1 = require("../controllers/estimationController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Create estimation - Engineer/Estimator only
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "estimator"]), estimationController_1.createEstimation);
// Get estimations by project
router.get("/project/:projectId", (0, authMiddleware_1.authorize)([
    "admin",
    "super_admin",
    "engineer",
    "estimator",
    "project_manager",
    "client",
]), estimationController_1.getEstimationsByProject);
// Get estimation details
router.get("/:id", (0, authMiddleware_1.authorize)([
    "admin",
    "super_admin",
    "engineer",
    "estimator",
    "project_manager",
    "client",
]), estimationController_1.getEstimationDetails);
// Mark as checked - Project Manager/Engineer
router.patch("/:id/check", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "project_manager"]), estimationController_1.markAsChecked);
// Approve/reject estimation - Admin/Project Manager
router.patch("/:id/approve", (0, authMiddleware_1.authorize)(["admin", "super_admin", "project_manager"]), estimationController_1.approveEstimation);
// Update estimation - Only before approval
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "estimator"]), estimationController_1.updateEstimation);
// Delete estimation - Only before approval
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "estimator"]), estimationController_1.deleteEstimation);
router.get("/:id/estimation-pdf", estimationController_1.generateEstimationPdf);
exports.default = router;
//# sourceMappingURL=estimationRoutes.js.map