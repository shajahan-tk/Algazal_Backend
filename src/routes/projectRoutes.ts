import express from "express";
import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  updateProjectStatus,
  updateProjectProgress,
  deleteProject,
  assignProject,
  getEngineerProjects,
  getProjectProgressUpdates,
  generateInvoiceData,
  assignTeamAndDriver,
  getAssignedTeam,
  getDriverProjects,
  generateInvoicePdf,
  updateWorkersAndDriver,
  addGrnNumber,
  setWorkStartDate,
  setWorkEndDate,
  getWorkDuration,
} from "../controllers/projectController";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Create project - Admin/Engineer only
router.post(
  "/",
  authorize(["admin", "super_admin", "engineer"]),
  createProject
);

// Get all projects
router.get("/", getProjects);
router.get("/engineer", getEngineerProjects);
router.get(
  "/driver/assigned",
  authorize(["driver", "admin", "super_admin"]), // Only drivers can access this
  getDriverProjects
);
// Get single project
router.get("/:id", getProject);
router.get(
  "/:projectId/invoice",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  generateInvoiceData
);
router.get(
  "/:projectId/invoice/pdf",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  generateInvoicePdf
);
router.put(
  "/:projectId/grn-number",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  addGrnNumber
);
// Update project - Admin/Engineer only
router.put(
  "/:id",
  authorize(["admin", "super_admin", "engineer"]),
  updateProject
);
router.post(
  "/:id/assign",
  authorize(["admin", "super_admin", "finance"]),
  assignProject
);
router.get(
  "/:projectId/team",
  authorize(["admin", "super_admin", "finance","engineer"]),
  getAssignedTeam
);
router.put(
  "/:id/assign-workers-driver",
  authorize(["admin", "super_admin", "finance"]),
  updateWorkersAndDriver
);

router.get(
  "/:projectId/progress",
  authorize(["admin", "super_admin", "finance","engineer"]),
  getProjectProgressUpdates
);
// Update project status
router.patch(
  "/:id/status",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  updateProjectStatus
);

// Update project progress
router.patch(
  "/:id/progress",
  authorize(["admin", "super_admin", "engineer"]),
  updateProjectProgress
);

// Delete project - Admin only
router.delete("/:id", authorize(["admin", "super_admin"]), deleteProject);

router.post(
  "/:projectId/assign-team",
  authorize(["admin", "super_admin","engineer"]), // Only admins can assign teams
  assignTeamAndDriver
);
router.patch(
  "/:id/work-start-date",
  authorize(["admin", "super_admin", "engineer"]),
  setWorkStartDate
);

router.patch(
  "/:id/work-end-date",
  authorize(["admin", "super_admin", "engineer"]),
  setWorkEndDate
);

router.get(
  "/:id/work-duration",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getWorkDuration
);
export default router;
