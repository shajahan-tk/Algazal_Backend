// src/routes/projectRoutes.ts

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
  exportProjectsToExcel,
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

// Get projects for the logged-in engineer
// The controller logic for this has been updated to filter projects where the user's ID is in the `assignedEngineers` array.
router.get("/engineer", getEngineerProjects);
router.get(
  "/export",
  authenticate,
  authorize(["admin", "super_admin", "finance"]),
  exportProjectsToExcel
);

// Get projects assigned to the logged-in driver
router.get(
  "/driver/assigned",
  authorize(["driver", "admin", "super_admin"]),
  getDriverProjects
);

// Get a single project by ID
// The controller logic for this has been updated to populate the `assignedEngineers` array instead of the single `assignedTo` field.
router.get("/:id", getProject);

// Get data needed to generate an invoice for a project
// The controller logic has been updated to handle multiple engineers in the vendee information.
router.get(
  "/:projectId/invoice",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  generateInvoiceData
);

// Generate and download the invoice PDF for a project
router.get(
  "/:projectId/invoice/pdf/:selectedBankId",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  generateInvoicePdf
);

// Add or update a GRN number for a project
router.put(
  "/:projectId/grn-number",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  addGrnNumber
);

// Update a project - Admin/Engineer only
router.put(
  "/:id",
  authorize(["admin", "super_admin", "engineer"]),
  updateProject
);

// Assign one or more engineers to a project
// The controller logic has been updated to accept an array of `engineerIds` in the request body
// and to handle both initial assignments and edits.
router.post(
  "/:id/assign",
  authorize(["admin", "super_admin", "finance"]),
  assignProject
);

// Get the team (engineers, workers, drivers) assigned to a project
// The controller logic has been updated to return the `assignedEngineers` array.
router.get(
  "/:projectId/team",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  getAssignedTeam
);

// Update the workers and drivers assigned to a project
router.put(
  "/:id/assign-workers-driver",
  authorize(["admin", "super_admin", "finance"]),
  updateWorkersAndDriver
);

// Get progress updates for a project
router.get(
  "/:projectId/progress",
  authorize(["admin", "super_admin", "finance", "engineer"]),
  getProjectProgressUpdates
);

// Update the status of a project
router.patch(
  "/:id/status",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  updateProjectStatus
);

// Update the progress percentage of a project
// The controller logic has been updated to send email notifications to all assigned engineers.
router.patch(
  "/:id/progress",
  authorize(["admin", "super_admin", "engineer"]),
  updateProjectProgress
);

// Delete a project - Admin only
router.delete(
  "/:id",
  authorize(["admin", "super_admin"]),
  deleteProject
);

// Assign a team (workers and drivers) to a project
router.post(
  "/:projectId/assign-team",
  authorize(["admin", "super_admin", "engineer"]),
  assignTeamAndDriver
);

// Set the work start date for a project
router.patch(
  "/:id/work-start-date",
  authorize(["admin", "super_admin", "engineer"]),
  setWorkStartDate
);

// Set the work end date for a project
router.patch(
  "/:id/work-end-date",
  authorize(["admin", "super_admin", "engineer"]),
  setWorkEndDate
);

// Get the work duration information for a project
router.get(
  "/:id/work-duration",
  authorize(["admin", "super_admin", "engineer", "finance"]),
  getWorkDuration
);

export default router;