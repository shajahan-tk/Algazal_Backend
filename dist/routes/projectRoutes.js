"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const projectController_1 = require("../controllers/projectController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(authMiddleware_1.authenticate);
// Create project - Admin/Engineer only
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), projectController_1.createProject);
// Get all projects
router.get("/", projectController_1.getProjects);
router.get("/engineer", projectController_1.getEngineerProjects);
router.get("/driver/assigned", (0, authMiddleware_1.authorize)(["driver", "admin", "super_admin"]), // Only drivers can access this
projectController_1.getDriverProjects);
// Get single project
router.get("/:id", projectController_1.getProject);
router.get("/:projectId/invoice", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), projectController_1.generateInvoiceData);
router.get("/:projectId/invoice/pdf", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), projectController_1.generateInvoicePdf);
router.put("/:projectId/grn-number", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), projectController_1.addGrnNumber);
// Update project - Admin/Engineer only
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), projectController_1.updateProject);
router.post("/:id/assign", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), projectController_1.assignProject);
router.get("/:projectId/team", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), projectController_1.getAssignedTeam);
router.put("/:id/assign-workers-driver", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), projectController_1.updateWorkersAndDriver);
router.get("/:projectId/progress", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), projectController_1.getProjectProgressUpdates);
// Update project status
router.patch("/:id/status", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), projectController_1.updateProjectStatus);
// Update project progress
router.patch("/:id/progress", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), projectController_1.updateProjectProgress);
// Delete project - Admin only
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), projectController_1.deleteProject);
router.post("/:projectId/assign-team", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), // Only admins can assign teams
projectController_1.assignTeamAndDriver);
router.patch("/:id/work-start-date", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), projectController_1.setWorkStartDate);
router.patch("/:id/work-end-date", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer"]), projectController_1.setWorkEndDate);
router.get("/:id/work-duration", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), projectController_1.getWorkDuration);
exports.default = router;
//# sourceMappingURL=projectRoutes.js.map