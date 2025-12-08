// src/routes/kanbanRoutes.ts
import express from "express";
import {
    getKanbanTasks,
    getKanbanTask,
    createKanbanTask,
    updateKanbanTask,
    moveKanbanTask,
    deleteKanbanTask,
    getEngineers,
} from "../controllers/kanbanController";
import { authenticate } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get all engineers for assignment
router.get("/engineers", getEngineers);

// Get all kanban tasks with optional filters
router.get("/", getKanbanTasks);

// Get a specific kanban task
router.get("/:id", getKanbanTask);

// Create a new kanban task
router.post("/", createKanbanTask);

// Update a kanban task
router.put("/:id", updateKanbanTask);

// Move a kanban task to a different stage
router.patch("/:id/move", moveKanbanTask);

// Delete a kanban task
router.delete("/:id", deleteKanbanTask);

export default router;