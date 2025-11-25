// controllers/attendanceManagementController.js
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Attendance } from "../models/attendanceModel";
import { Project } from "../models/projectModel";
import { User } from "../models/userModel";
import dayjs from "dayjs";
import { Types } from "mongoose";
import { Request, Response } from "express";

// Create or Update attendance record
export const createOrUpdateAttendance = asyncHandler(async (req: Request, res: Response) => {
  const { userId, date, type = "normal" } = req.body;
  let { present, workingHours = 0, overtimeHours = 0, projectId, isPaidLeave = false } = req.body;

  console.log('Create/Update Attendance Request:', req.body);

  // Validate required fields
  if (!userId || !date) {
    throw new ApiError(400, "User ID and date are required");
  }

  if (!["project", "normal"].includes(type)) {
    throw new ApiError(400, "Invalid attendance type");
  }

  // Validate paid leave cannot have project
  if (isPaidLeave && projectId) {
    throw new ApiError(400, "Paid leave cannot be associated with a project");
  }

  // For project attendance, validate project (unless it's paid leave)
  if (type === "project" && !isPaidLeave) {
    if (!projectId) {
      throw new ApiError(400, "Project ID is required for project attendance");
    }

    const project = await Project.findById(projectId);
    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    const isAssigned =
      (project.assignedWorkers?.some((w) => w.equals(userId)) ?? false) ||
      (project.assignedDrivers?.some((d) => d.equals(userId)) ?? false);

    if (!isAssigned) {
      throw new ApiError(400, "User is not assigned to this project");
    }
  }

  if (!req.user?.userId) {
    throw new ApiError(401, "Unauthorized - User not authenticated");
  }
  const markedBy = new Types.ObjectId(req.user.userId);

  const attendanceDate = new Date(date);
  if (isNaN(attendanceDate.getTime())) {
    throw new ApiError(400, "Invalid date format");
  }
  attendanceDate.setHours(0, 0, 0, 0);

  const nextDay = new Date(attendanceDate);
  nextDay.setDate(attendanceDate.getDate() + 1);

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Convert working hours
  let workingHoursValue = 0;
  let overtimeHoursValue = 0;

  // For paid leave (day off), force hours to 0
  if (isPaidLeave) {
    workingHoursValue = 0;
    overtimeHoursValue = 0;
    present = false; // Paid leave is technically absent but paid
  } else if (present) {
    // Handle working hours (existing code)
    if (typeof workingHours === 'string') {
      if (workingHours.includes(':')) {
        const [hours, minutes] = workingHours.split(':').map(Number);
        workingHoursValue = hours + (minutes / 60);
      } else {
        workingHoursValue = parseFloat(workingHours);
      }
    } else if (typeof workingHours === 'number') {
      workingHoursValue = workingHours;
    }

    if (isNaN(workingHoursValue) || workingHoursValue < 0 || workingHoursValue > 24) {
      throw new ApiError(400, "Working hours must be between 0 and 24");
    }

    workingHoursValue = Math.round(workingHoursValue * 100) / 100;

    // Handle overtime hours
    if (typeof overtimeHours === 'string') {
      if (overtimeHours.includes(':')) {
        const [hours, minutes] = overtimeHours.split(':').map(Number);
        overtimeHoursValue = hours + (minutes / 60);
      } else {
        overtimeHoursValue = parseFloat(overtimeHours);
      }
    } else if (typeof overtimeHours === 'number') {
      overtimeHoursValue = overtimeHours;
    }

    if (isNaN(overtimeHoursValue) || overtimeHoursValue < 0) {
      throw new ApiError(400, "Overtime hours cannot be negative");
    }

    overtimeHoursValue = Math.round(overtimeHoursValue * 100) / 100;
  } else {
    // If absent (and not paid leave), set both to 0
    workingHoursValue = 0;
    overtimeHoursValue = 0;
  }

  console.log('Processed hours - Working:', workingHoursValue, 'Overtime:', overtimeHoursValue, 'PaidLeave:', isPaidLeave);

  // Find existing attendance record
  const query: any = {
    user: userId,
    date: { $gte: attendanceDate, $lt: nextDay },
    type,
  };

  let attendance = await Attendance.findOne(query);

  if (attendance) {
    // Update existing record
    attendance.present = present;
    attendance.markedBy = markedBy;
    attendance.isPaidLeave = isPaidLeave;

    if (isPaidLeave) {
      attendance.projects = [];
      attendance.workingHours = 0;
      attendance.overtimeHours = 0;
      attendance.project = undefined;
    } else if (type === "project") {
      // Handle project array
      if (!attendance.projects) attendance.projects = [];

      const projectIndex = attendance.projects.findIndex(p => p.project.toString() === projectId);

      if (projectIndex > -1) {
        // Update existing project entry
        attendance.projects[projectIndex].workingHours = workingHoursValue;
        attendance.projects[projectIndex].markedBy = markedBy;
        attendance.projects[projectIndex].present = present;
      } else {
        // Add new project entry
        attendance.projects.push({
          project: new Types.ObjectId(projectId),
          workingHours: workingHoursValue,
          markedBy: markedBy,
          present: present
        });
      }
    } else {
      // Normal attendance
      attendance.workingHours = workingHoursValue;
      attendance.overtimeHours = overtimeHoursValue;
    }

    await attendance.save();
    console.log('Updated existing attendance record');
  } else {
    // Create new record
    const initialProjects = (type === "project" && !isPaidLeave) ? [{
      project: new Types.ObjectId(projectId),
      workingHours: workingHoursValue,
      markedBy: markedBy,
      present: present
    }] : [];

    attendance = await Attendance.create({
      projects: initialProjects,
      project: (type === "project" && !isPaidLeave) ? projectId : undefined,
      user: userId,
      present,
      workingHours: workingHoursValue, // Will be overwritten by hook for projects
      overtimeHours: overtimeHoursValue, // Will be overwritten by hook for projects
      markedBy,
      date: attendanceDate,
      type,
      isPaidLeave,
    });
    console.log('Created new attendance record');
  }

  // Populate the response
  const populatedAttendance = await Attendance.findById(attendance._id)
    .populate("markedBy", "firstName lastName")
    .populate("projects.project", "projectName")
    .populate("project", "projectName")
    .populate("user", "firstName lastName");

  res
    .status(200)
    .json(new ApiResponse(200, populatedAttendance, "Attendance saved successfully"));
});

// Remove a specific project from attendance
export const removeProjectAttendance = asyncHandler(async (req: Request, res: Response) => {
  const { userId, date, projectId } = req.body;

  if (!userId || !date || !projectId) {
    throw new ApiError(400, "User ID, date, and Project ID are required");
  }

  const attendanceDate = new Date(date);
  if (isNaN(attendanceDate.getTime())) {
    throw new ApiError(400, "Invalid date format");
  }
  attendanceDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(attendanceDate);
  nextDay.setDate(attendanceDate.getDate() + 1);

  const attendance = await Attendance.findOne({
    user: userId,
    date: { $gte: attendanceDate, $lt: nextDay },
    type: "project"
  });

  if (!attendance) {
    throw new ApiError(404, "Attendance record not found");
  }

  // Remove the project from the projects array
  attendance.projects = attendance.projects.filter(p => p.project.toString() !== projectId);

  // If no projects left, what should we do?
  // Maybe mark as absent? Or just leave it with 0 hours?
  // Let's leave it as is, the pre-save hook will set workingHours to 0 if projects is empty.
  // If projects is empty, we might want to set present to false?
  if (attendance.projects.length === 0) {
    attendance.present = false;
    attendance.workingHours = 0;
    attendance.overtimeHours = 0;
    attendance.project = undefined; // Clear legacy field
  }

  await attendance.save();

  res.status(200).json(new ApiResponse(200, attendance, "Project attendance removed successfully"));
});

// Delete attendance record (entire day)
export const deleteAttendanceRecord = asyncHandler(async (req: Request, res: Response) => {
  const { attendanceId } = req.params;

  if (!attendanceId) {
    throw new ApiError(400, "Attendance ID is required");
  }

  const attendance = await Attendance.findById(attendanceId);

  if (!attendance) {
    throw new ApiError(404, "Attendance record not found");
  }

  await Attendance.findByIdAndDelete(attendanceId);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Attendance record deleted successfully"));
});


// Get user attendance for specific date
export const getUserDateAttendance = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { date } = req.query;

  if (!userId || !date) {
    throw new ApiError(400, "User ID and date are required");
  }

  // safely cast date to string
  const dateStr = Array.isArray(date) ? date[0] : String(date);

  const attendanceDate = new Date(Array.isArray(date) ? String(date[0]) : String(date));


  if (isNaN(attendanceDate.getTime())) {
    throw new ApiError(400, "Invalid date format");
  }

  attendanceDate.setHours(0, 0, 0, 0);

  const nextDay = new Date(attendanceDate);
  nextDay.setDate(attendanceDate.getDate() + 1);

  const attendance = await Attendance.find({
    user: userId,
    date: { $gte: attendanceDate, $lt: nextDay },
  })
    .populate("markedBy", "firstName lastName")
    .populate("projects.project", "projectName")
    .populate("project", "projectName")
    .sort({ type: 1 });

  res
    .status(200)
    .json(new ApiResponse(200, attendance, "Attendance records retrieved successfully"));
});


export const getUserProjects = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, "User ID is required");
  }

  // Validate user exists
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Find projects where user is assigned as worker or driver
  const projects = await Project.find({
    $or: [
      { assignedWorkers: userId },
      { assignedDrivers: userId }
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
    .select("_id projectName projectNumber location building apartmentNumber client assignedWorkers assignedDrivers")
    .populate("client", "clientName")
    .sort({ projectName: 1 });

  // Format the response with assignment type
  const formattedProjects = projects.map((project: any) => {
    const isWorker = project.assignedWorkers?.some((worker: any) => worker.equals(userId));
    const isDriver = project.assignedDrivers?.some((driver: any) => driver.equals(userId));

    let assignmentType = '';
    if (isWorker && isDriver) {
      assignmentType = 'Worker & Driver';
    } else if (isWorker) {
      assignmentType = 'Worker';
    } else if (isDriver) {
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
    .json(new ApiResponse(200, formattedProjects, "User projects retrieved successfully"));
});