"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserProjects = exports.getUserDateAttendance = exports.deleteAttendanceRecord = exports.createOrUpdateAttendance = void 0;
// controllers/attendanceManagementController.js
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const attendanceModel_1 = require("../models/attendanceModel");
const projectModel_1 = require("../models/projectModel");
const userModel_1 = require("../models/userModel");
const mongoose_1 = require("mongoose");
// Create or Update attendance record
exports.createOrUpdateAttendance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { userId, date, type = "normal" } = req.body;
    let { present, workingHours = 0, overtimeHours = 0, projectId } = req.body;
    console.log('Create/Update Attendance Request:', req.body);
    // Validate required fields
    if (!userId || !date) {
        throw new apiHandlerHelpers_2.ApiError(400, "User ID and date are required");
    }
    if (!["project", "normal"].includes(type)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid attendance type");
    }
    // For project attendance, validate project
    if (type === "project") {
        if (!projectId) {
            throw new apiHandlerHelpers_2.ApiError(400, "Project ID is required for project attendance");
        }
        // Validate project exists
        const project = await projectModel_1.Project.findById(projectId);
        if (!project) {
            throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
        }
        // Check if user is assigned to project
        const isAssigned = (project.assignedWorkers?.some((w) => w.equals(userId)) ?? false) ||
            (project.assignedDriver?.equals(userId) ?? false);
        if (!isAssigned) {
            throw new apiHandlerHelpers_2.ApiError(400, "User is not assigned to this project");
        }
    }
    // Ensure markedBy exists
    if (!req.user?.userId) {
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized - User not authenticated");
    }
    const markedBy = new mongoose_1.Types.ObjectId(req.user.userId);
    // Parse and validate date
    const attendanceDate = new Date(date);
    if (isNaN(attendanceDate.getTime())) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid date format");
    }
    attendanceDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(attendanceDate);
    nextDay.setDate(attendanceDate.getDate() + 1);
    // Validate user exists
    const user = await userModel_1.User.findById(userId);
    if (!user) {
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    }
    // Convert working hours - FIXED: Handle both string and number properly
    let workingHoursValue = 0;
    let overtimeHoursValue = 0;
    if (present) {
        // Handle working hours
        if (typeof workingHours === 'string') {
            if (workingHours.includes(':')) {
                // Convert time string like "8:30" to hours
                const [hours, minutes] = workingHours.split(':').map(Number);
                workingHoursValue = hours + (minutes / 60);
            }
            else {
                // Convert string number to float
                workingHoursValue = parseFloat(workingHours);
            }
        }
        else if (typeof workingHours === 'number') {
            workingHoursValue = workingHours;
        }
        // Validate working hours
        if (isNaN(workingHoursValue) || workingHoursValue < 0 || workingHoursValue > 24) {
            throw new apiHandlerHelpers_2.ApiError(400, "Working hours must be between 0 and 24");
        }
        // Round to 2 decimal places
        workingHoursValue = Math.round(workingHoursValue * 100) / 100;
        // Handle overtime hours
        if (typeof overtimeHours === 'string') {
            if (overtimeHours.includes(':')) {
                const [hours, minutes] = overtimeHours.split(':').map(Number);
                overtimeHoursValue = hours + (minutes / 60);
            }
            else {
                overtimeHoursValue = parseFloat(overtimeHours);
            }
        }
        else if (typeof overtimeHours === 'number') {
            overtimeHoursValue = overtimeHours;
        }
        // Validate overtime hours
        if (isNaN(overtimeHoursValue) || overtimeHoursValue < 0) {
            throw new apiHandlerHelpers_2.ApiError(400, "Overtime hours cannot be negative");
        }
        // Round to 2 decimal places
        overtimeHoursValue = Math.round(overtimeHoursValue * 100) / 100;
    }
    else {
        // If absent, set both to 0
        workingHoursValue = 0;
        overtimeHoursValue = 0;
    }
    console.log('Processed hours - Working:', workingHoursValue, 'Overtime:', overtimeHoursValue);
    // Find existing attendance record
    const query = {
        user: userId,
        date: { $gte: attendanceDate, $lt: nextDay },
        type,
    };
    if (type === "project") {
        query.project = projectId;
    }
    let attendance = await attendanceModel_1.Attendance.findOne(query);
    if (attendance) {
        // Update existing record
        attendance.present = present;
        attendance.workingHours = workingHoursValue;
        attendance.overtimeHours = overtimeHoursValue;
        attendance.markedBy = markedBy;
        await attendance.save();
        console.log('Updated existing attendance record');
    }
    else {
        // Create new record
        attendance = await attendanceModel_1.Attendance.create({
            project: type === "project" ? projectId : undefined,
            user: userId,
            present,
            workingHours: workingHoursValue,
            overtimeHours: overtimeHoursValue,
            markedBy,
            date: attendanceDate,
            type,
        });
        console.log('Created new attendance record');
    }
    // Populate the response
    const populatedAttendance = await attendanceModel_1.Attendance.findById(attendance._id)
        .populate("markedBy", "firstName lastName")
        .populate("project", "projectName")
        .populate("user", "firstName lastName");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, populatedAttendance, "Attendance saved successfully"));
});
// Delete attendance record
exports.deleteAttendanceRecord = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { attendanceId } = req.params;
    if (!attendanceId) {
        throw new apiHandlerHelpers_2.ApiError(400, "Attendance ID is required");
    }
    const attendance = await attendanceModel_1.Attendance.findById(attendanceId);
    if (!attendance) {
        throw new apiHandlerHelpers_2.ApiError(404, "Attendance record not found");
    }
    await attendanceModel_1.Attendance.findByIdAndDelete(attendanceId);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Attendance record deleted successfully"));
});
// Get user attendance for specific date
exports.getUserDateAttendance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { userId } = req.params;
    const { date } = req.query;
    if (!userId || !date) {
        throw new apiHandlerHelpers_2.ApiError(400, "User ID and date are required");
    }
    // safely cast date to string
    const dateStr = Array.isArray(date) ? date[0] : String(date);
    const attendanceDate = new Date(Array.isArray(date) ? String(date[0]) : String(date));
    if (isNaN(attendanceDate.getTime())) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid date format");
    }
    attendanceDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(attendanceDate);
    nextDay.setDate(attendanceDate.getDate() + 1);
    const attendance = await attendanceModel_1.Attendance.find({
        user: userId,
        date: { $gte: attendanceDate, $lt: nextDay },
    })
        .populate("markedBy", "firstName lastName")
        .populate("project", "projectName")
        .sort({ type: 1 });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, attendance, "Attendance records retrieved successfully"));
});
exports.getUserProjects = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { userId } = req.params;
    if (!userId) {
        throw new apiHandlerHelpers_2.ApiError(400, "User ID is required");
    }
    // Validate user exists
    const user = await userModel_1.User.findById(userId);
    if (!user) {
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    }
    // Find projects where user is assigned as worker or driver
    const projects = await projectModel_1.Project.find({
        $or: [
            { assignedWorkers: userId },
            { assignedDriver: userId }
        ],
        status: {
            $in: [
                'team_assigned',
                'work_started',
                'in_progress',
                'work_completed',
                'quality_check'
            ]
        } // Only active projects
    })
        .select("_id projectName projectNumber location building apartmentNumber client assignedWorkers assignedDriver")
        .populate("client", "clientName")
        .sort({ projectName: 1 });
    // Format the response with assignment type
    const formattedProjects = projects.map((project) => {
        const isWorker = project.assignedWorkers?.some((worker) => worker.equals(userId));
        const isDriver = project.assignedDriver?.equals(userId);
        let assignmentType = '';
        if (isWorker && isDriver) {
            assignmentType = 'Worker & Driver';
        }
        else if (isWorker) {
            assignmentType = 'Worker';
        }
        else if (isDriver) {
            assignmentType = 'Driver';
        }
        return {
            _id: project._id,
            projectName: project.projectName,
            projectNumber: project.projectNumber,
            location: project.location,
            building: project.building,
            apartmentNumber: project.apartmentNumber,
            clientName: project.client?.clientName || 'N/A',
            assignmentType: assignmentType
        };
    });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, formattedProjects, "User projects retrieved successfully"));
});
//# sourceMappingURL=attendanceManagementController.js.map