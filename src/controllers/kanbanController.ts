// src/controllers/kanbanController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { KanbanTask, IKanbanTask } from "../models/kanbanModel";
import { User } from "../models/userModel";

// Helper function to check if user is an engineer
const isEngineer = (user: any) => {
    const engineerRoles = [
        'engineer',
        'civil_engineer',
        'mep_engineer',
        'electrical_supervisor',
        'mep_supervisor',
        'supervisor',
        'senior_plumber',
        'plumber',
        'electrician',
        'ac_technician',
        'aluminium_fabricator',
        'carpenter',
        'painter',
        'mason',
        'plasterer',
        'ac_assistant',
        'building_labourer',
        'helper',
        'cleaner',
        'worker'
    ];
    return engineerRoles.includes(user.role);
};

// Helper function to convert empty strings to undefined
const sanitizeObjectIdFields = (body: any) => {
    const sanitized = { ...body };

    // Convert empty strings to undefined for ObjectId fields
    if (sanitized.assignedTo === "" || sanitized.assignedTo === null || sanitized.assignedTo === undefined) {
        sanitized.assignedTo = undefined;
    }

    // Handle dueDate - convert empty string to undefined
    if (sanitized.dueDate === "" || sanitized.dueDate === null || sanitized.dueDate === undefined) {
        sanitized.dueDate = undefined;
    }

    return sanitized;
};

// Get all kanban tasks with optional filters
export const getKanbanTasks = asyncHandler(async (req: Request, res: Response) => {
    const { stage, priority, assignedTo } = req.query;
    const userId = req.user?.userId;

    // Build filter
    const filter: any = {};

    if (stage) filter.stage = stage;
    if (priority) filter.priority = priority;

    // Only add assignedTo to filter if it's not empty
    if (assignedTo && assignedTo !== "") {
        filter.assignedTo = assignedTo;
    }

    // If user is not admin, only show tasks they created or are assigned to
    const user = await User.findById(userId);
    if (user && !['admin', 'super_admin'].includes(user.role)) {
        filter.$or = [
            { createdBy: userId },
            { assignedTo: userId }
        ];
    }

    const tasks = await KanbanTask.find(filter)
        .populate("createdBy", "firstName lastName email profileImage")
        .populate("assignedTo", "firstName lastName email profileImage")
        .sort({ createdAt: -1 });

    res.status(200).json(
        new ApiResponse(200, tasks, "Kanban tasks retrieved successfully")
    );
});

// Get a specific kanban task
export const getKanbanTask = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user?.userId;

    const task = await KanbanTask.findById(id)
        .populate("createdBy", "firstName lastName email profileImage")
        .populate("assignedTo", "firstName lastName email profileImage");

    if (!task) {
        throw new ApiError(404, "Kanban task not found");
    }

    // Check if user has permission to view this task
    const user = await User.findById(userId);
    if (user && !['admin', 'super_admin'].includes(user.role) &&
        task.createdBy.toString() !== userId &&
        task.assignedTo?.toString() !== userId) {
        throw new ApiError(403, "You don't have permission to view this task");
    }

    res.status(200).json(
        new ApiResponse(200, task, "Kanban task retrieved successfully")
    );
});

// Create a new kanban task
export const createKanbanTask = asyncHandler(async (req: Request, res: Response) => {
    const { title, description, stage, priority, assignedTo, dueDate } = req.body;
    const userId = req.user?.userId;

    if (!title) {
        throw new ApiError(400, "Task title is required");
    }

    // Sanitize the request body
    const sanitizedData = sanitizeObjectIdFields({
        title,
        description,
        stage,
        priority,
        assignedTo,
        dueDate,
    });

    // Validate assigned user if provided
    if (sanitizedData.assignedTo) {
        const assignedUser = await User.findById(sanitizedData.assignedTo);
        if (!assignedUser) {
            throw new ApiError(404, "Assigned user not found");
        }

        // Check if the assigned user is an engineer
        if (!isEngineer(assignedUser)) {
            throw new ApiError(400, "Task can only be assigned to engineers");
        }
    }

    const task = await KanbanTask.create({
        title: sanitizedData.title,
        description: sanitizedData.description,
        stage: sanitizedData.stage || 'todo',
        priority: sanitizedData.priority || 'medium',
        assignedTo: sanitizedData.assignedTo,
        createdBy: userId,
        dueDate: sanitizedData.dueDate,
    });

    const populatedTask = await KanbanTask.findById(task._id)
        .populate("createdBy", "firstName lastName email profileImage")
        .populate("assignedTo", "firstName lastName email profileImage");

    res.status(201).json(
        new ApiResponse(201, populatedTask, "Kanban task created successfully")
    );
});

// Update a kanban task
export const updateKanbanTask = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, description, stage, priority, assignedTo, dueDate } = req.body;
    const userId = req.user?.userId;

    const task = await KanbanTask.findById(id);
    if (!task) {
        throw new ApiError(404, "Kanban task not found");
    }

    // Check if user has permission to update this task
    const user = await User.findById(userId);
    if (user && !['admin', 'super_admin'].includes(user.role) &&
        task.createdBy.toString() !== userId &&
        task.assignedTo?.toString() !== userId) {
        throw new ApiError(403, "You don't have permission to update this task");
    }

    // Sanitize the request body
    const sanitizedData = sanitizeObjectIdFields({
        title,
        description,
        stage,
        priority,
        assignedTo,
        dueDate,
    });

    // Validate assigned user if provided
    if (sanitizedData.assignedTo) {
        const assignedUser = await User.findById(sanitizedData.assignedTo);
        if (!assignedUser) {
            throw new ApiError(404, "Assigned user not found");
        }

        // Check if the assigned user is an engineer
        if (!isEngineer(assignedUser)) {
            throw new ApiError(400, "Task can only be assigned to engineers");
        }
    }

    const updateData: any = {};
    if (sanitizedData.title !== undefined) updateData.title = sanitizedData.title;
    if (sanitizedData.description !== undefined) updateData.description = sanitizedData.description;
    if (sanitizedData.stage !== undefined) updateData.stage = sanitizedData.stage;
    if (sanitizedData.priority !== undefined) updateData.priority = sanitizedData.priority;
    if (sanitizedData.assignedTo !== undefined) updateData.assignedTo = sanitizedData.assignedTo;
    if (sanitizedData.dueDate !== undefined) updateData.dueDate = sanitizedData.dueDate;

    const updatedTask = await KanbanTask.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
    )
        .populate("createdBy", "firstName lastName email profileImage")
        .populate("assignedTo", "firstName lastName email profileImage");

    res.status(200).json(
        new ApiResponse(200, updatedTask, "Kanban task updated successfully")
    );
});

// Move a kanban task to a different stage
export const moveKanbanTask = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { stage } = req.body;
    const userId = req.user?.userId;

    if (!stage) {
        throw new ApiError(400, "Stage is required");
    }

    if (!['todo', 'in-progress', 'review', 'done'].includes(stage)) {
        throw new ApiError(400, "Invalid stage");
    }

    const task = await KanbanTask.findById(id);
    if (!task) {
        throw new ApiError(404, "Kanban task not found");
    }

    // Check if user has permission to move this task
    const user = await User.findById(userId);
    if (user && !['admin', 'super_admin'].includes(user.role) &&
        task.createdBy.toString() !== userId &&
        task.assignedTo?.toString() !== userId) {
        throw new ApiError(403, "You don't have permission to move this task");
    }

    const updatedTask = await KanbanTask.findByIdAndUpdate(
        id,
        { stage },
        { new: true, runValidators: true }
    )
        .populate("createdBy", "firstName lastName email profileImage")
        .populate("assignedTo", "firstName lastName email profileImage");

    res.status(200).json(
        new ApiResponse(200, updatedTask, "Kanban task moved successfully")
    );
});

// Delete a kanban task
export const deleteKanbanTask = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user?.userId;

    const task = await KanbanTask.findById(id);
    if (!task) {
        throw new ApiError(404, "Kanban task not found");
    }

    // Check if user has permission to delete this task
    const user = await User.findById(userId);
    if (user && !['admin', 'super_admin'].includes(user.role) &&
        task.createdBy.toString() !== userId) {
        throw new ApiError(403, "You don't have permission to delete this task");
    }

    await KanbanTask.findByIdAndDelete(id);

    res.status(200).json(
        new ApiResponse(200, null, "Kanban task deleted successfully")
    );
});

// Get all engineers for assignment dropdown
export const getEngineers = asyncHandler(async (req: Request, res: Response) => {
    const engineers = await User.find({
        role: {
            $in: [
                'engineer',
                'civil_engineer',
                'mep_engineer',
                'electrical_supervisor',
                'mep_supervisor',
                'supervisor',
                'senior_plumber',
                'plumber',
                'electrician',
                'ac_technician',
                'aluminium_fabricator',
                'carpenter',
                'painter',
                'mason',
                'plasterer',
                'ac_assistant',
                'building_labourer',
                'helper',
                'cleaner',
                'worker'
            ]
        },
        isActive: true
    }).select("firstName lastName email profileImage role");

    res.status(200).json(
        new ApiResponse(200, engineers, "Engineers retrieved successfully")
    );
});