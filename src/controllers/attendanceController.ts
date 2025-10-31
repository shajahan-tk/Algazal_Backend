import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Attendance } from "../models/attendanceModel";
import { IProject, Project } from "../models/projectModel";
import dayjs from "dayjs";
import { IUser, User } from "../models/userModel";
import { Types } from "mongoose";

// Mark attendance (supports both project and normal types)
export const markAttendance = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId, userId } = req.params;
    let { present, type = "project", workingHours = 0, isPaidLeave = false } = req.body;

    console.log('Request body:', req.body);

    // NEW: Validate paid leave cannot have project type
    if (isPaidLeave && type === "project") {
      throw new ApiError(400, "Paid leave cannot be associated with a project");
    }

    if (!req.user?.userId) {
      throw new ApiError(401, "Unauthorized - User not authenticated");
    }
    const markedBy = new Types.ObjectId(req.user.userId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (typeof present !== "boolean") {
      throw new ApiError(400, "Present must be a boolean");
    }
    if (!["project", "normal"].includes(type)) {
      throw new ApiError(400, "Invalid attendance type");
    }
    
    let workingHoursValue = 0;
    
    // NEW: For paid leave, force hours to 0
    if (isPaidLeave) {
      workingHoursValue = 0;
      present = false;
    } else if (present) {
      // Existing working hours conversion logic
      if (typeof workingHours === 'string' && workingHours.includes(':')) {
        const [hours, minutes] = workingHours.split(':').map(Number);
        workingHoursValue = hours + (minutes / 60);
        workingHoursValue = Math.round(workingHoursValue * 100) / 100;
      } else if (typeof workingHours === 'number') {
        workingHoursValue = workingHours;
      } else if (typeof workingHours === 'string') {
        workingHoursValue = parseFloat(workingHours);
        if (isNaN(workingHoursValue)) {
          throw new ApiError(400, "Working hours must be a valid number or time string (HH:MM)");
        }
      } else {
        throw new ApiError(400, "Working hours must be a number or time string (HH:MM)");
      }

      if (workingHoursValue < 0 || workingHoursValue > 24) {
        throw new ApiError(400, "Working hours must be between 0 and 24");
      }
    } else {
      workingHoursValue = 0;
    }

    workingHours = workingHoursValue;

    // Project validation only if not paid leave
    let project;
    if (type === "project" && !isPaidLeave) {
      if (!projectId) {
        throw new ApiError(400, "Project ID is required for project attendance");
      }

      project = await Project.findById(projectId);
      if (!project) throw new ApiError(404, "Project not found");

      const isAssigned =
        (project.assignedWorkers?.some((w) => w.equals(userId)) ?? false) ||
        (project.assignedDriver?.equals(userId) ?? false);

      if (!isAssigned) {
        throw new ApiError(400, "User is not assigned to this project");
      }

      if (!project.assignedDriver?.equals(markedBy)) {
        throw new ApiError(403, "Only assigned driver can mark project attendance");
      }
    }

    const nextDay = new Date(today);
    nextDay.setDate(today.getDate() + 1);

    const query: any = {
      user: userId,
      date: { $gte: today, $lt: nextDay },
      type,
    };

    if (type === "project" && !isPaidLeave) {
      query.project = projectId;
    }

    let attendance = await Attendance.findOne(query);

    if (attendance) {
      attendance.present = present;
      attendance.workingHours = workingHours;
      attendance.markedBy = markedBy;
      attendance.isPaidLeave = isPaidLeave;
      if (isPaidLeave) {
        attendance.project = undefined;
      }
      await attendance.save();
    } else {
      attendance = await Attendance.create({
        project: (type === "project" && !isPaidLeave) ? projectId : undefined,
        user: userId,
        present,
        workingHours,
        markedBy,
        date: today,
        type,
        isPaidLeave,
      });
    }

    res
      .status(200)
      .json(new ApiResponse(200, attendance, "Attendance marked successfully"));
  }
);

// Get attendance records (supports both types)
export const getAttendance = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { startDate, endDate, type = "project", projectId } = req.query;

    const filter: any = {
      user: userId,
      type,
    };

    // Add project filter if type is project
    if (type === "project" && projectId) {
      filter.project = projectId;
    }

    // Add date range if provided
    if (startDate && endDate) {
      filter.date = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    const attendance = await Attendance.find(filter)
      .sort({ date: 1 })
      .populate("markedBy", "firstName lastName")
      .populate("project", "projectName");

    res
      .status(200)
      .json(new ApiResponse(200, attendance, "Attendance records retrieved"));
  }
);

// Get project attendance summary (only for project type)
export const getProjectAttendance = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { date } = req.query;

    const filter: any = {
      project: projectId,
      type: "project",
    };
    if (date) filter.date = new Date(date as string);

    const attendance = await Attendance.find(filter)
      .populate("user", "firstName lastName")
      .populate("markedBy", "firstName lastName");

    res
      .status(200)
      .json(new ApiResponse(200, attendance, "Project attendance retrieved"));
  }
);

// Get today's project attendance (only for project type)

export const getTodayProjectAttendance = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get project with assigned workers
    const project = await Project.findById(projectId)
      .populate<{
        assignedWorkers: (Pick<
          IUser,
          "_id" | "firstName" | "lastName" | "profileImage" | "phoneNumbers"
        > & { _id: Types.ObjectId })[];
      }>("assignedWorkers", "_id firstName lastName profileImage phoneNumbers")
      .populate<{
        assignedDriver: Pick<IUser, "_id" | "firstName" | "lastName"> & {
          _id: Types.ObjectId;
        };
      }>("assignedDriver", "_id firstName lastName");

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Get today's attendance records
    const attendance = await Attendance.find({
      project: projectId,
      type: "project",
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    // Merge worker data with attendance status
    const workersWithAttendance =
      project.assignedWorkers?.map((worker) => {
        const attendanceRecord = attendance.find((record) =>
          record.user.equals(worker._id)
        );
        return {
          _id: worker._id,
          firstName: worker.firstName,
          lastName: worker.lastName,
          profileImage: worker.profileImage,
          phoneNumbers: worker.phoneNumbers,
          present: attendanceRecord?.present || false,
          isPaidLeave: attendanceRecord?.isPaidLeave || false, // ADDED THIS LINE
          workingHours: attendanceRecord?.workingHours || 0,
          overtimeHours: attendanceRecord?.overtimeHours || 0,
          markedBy: attendanceRecord?.markedBy || null,
          markedAt: attendanceRecord?.createdAt || null,
        };
      }) || [];

    res.status(200).json(
      new ApiResponse(
        200,
        {
          project: {
            _id: project._id,
            projectName: project.projectName,
            assignedDriver: project.assignedDriver,
          },
          workers: workersWithAttendance,
          date: today,
        },
        "Today's attendance retrieved successfully"
      )
    );
  }
);

// Get attendance summary (supports both types)
export const getAttendanceSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { type = "project" } = req.query;
    const { projectId } = req.params;
    const { startDate, endDate } = req.query;

    const dateFilter: any = { type };

    // For project type, require projectId
    if (type === "project") {
      if (!projectId) {
        throw new ApiError(
          400,
          "Project ID is required for project attendance summary"
        );
      }
      dateFilter.project = projectId;
    }

    // Date range handling
    if (startDate && endDate) {
      dateFilter.date = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    // Get all attendance records
    const attendanceRecords = await Attendance.find(dateFilter)
      .populate("user", "firstName lastName profileImage")
      .populate("project", "projectName")
      .sort({ date: 1 });

    // Get unique dates
    const uniqueDates = [
      ...new Set(
        attendanceRecords.map((record) =>
          dayjs(record.date).format("YYYY-MM-DD")
        )
      ),
    ].sort();

    // Get all users who have attendance records
    const users = Array.from(
      new Set(attendanceRecords.map((record) => record.user))
    );

    // Create summary data structure
    const summary = uniqueDates.map((date) => {
      const dateObj: any = { date };

      users.forEach((user: any) => {
        const attendance = attendanceRecords.find(
          (record) =>
            dayjs(record.date).format("YYYY-MM-DD") === date &&
            record.user._id.toString() === user._id.toString()
        );

        dateObj[user._id.toString()] = attendance
          ? {
              present: attendance.present,
              workingHours: attendance.workingHours,
              overtimeHours: attendance.overtimeHours,
            }
          : null;
      });

      return dateObj;
    });

    // Calculate totals
    const totals: any = { date: "Total" };
    users.forEach((user: any) => {
      const userRecords = attendanceRecords.filter(
        (record) => record.user._id.toString() === user._id.toString()
      );

      totals[user._id.toString()] = {
        presentDays: userRecords.filter((record) => record.present).length,
        totalWorkingHours: userRecords.reduce(
          (sum, record) => sum + record.workingHours,
          0
        ),
        totalOvertimeHours: userRecords.reduce(
          (sum, record) => sum + record.overtimeHours,
          0
        ),
      };
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          type,
          dates: uniqueDates,
          users: users.map((user: any) => ({
            _id: user._id,
            name: `${user.firstName} ${user.lastName}`,
            profileImage: user.profileImage,
          })),
          summary,
          totals,
          ...(type === "project" && { projectId }),
        },
        "Attendance summary retrieved successfully"
      )
    );
  }
);

export const dailyNormalAttendance = asyncHandler(
  async (req: Request, res: Response) => {
    const { date } = req.query;

    if (!date) {
      throw new ApiError(400, "Date is required");
    }

    const startDate = new Date(date as string);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 1);

    // Get all users except drivers and workers
    const users = await User.find({
      role: { $nin: ["driver", "worker"] },
    }).select("_id firstName lastName email profileImage role");

    // Get attendance records for the date
    const attendanceRecords = await Attendance.find({
      type: "normal",
      date: {
        $gte: startDate,
        $lt: endDate,
      },
    }).populate("markedBy", "firstName lastName");

    // Merge user data with attendance status
    const result = users.map((user) => {
      const attendance = attendanceRecords.find(
        (record) => record.user.toString() === user._id.toString()
      );

      return {
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          profileImage: user.profileImage,
          role: user.role,
        },
        present: attendance?.present || false,
        isPaidLeave: attendance?.isPaidLeave || false, // ADDED THIS LINE
        workingHours: attendance?.workingHours || 0,
        overtimeHours: attendance?.overtimeHours || 0,
        markedBy: attendance?.markedBy || null,
        markedAt: attendance?.createdAt || null,
      };
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          date: startDate,
          users: result,
        },
        "Daily normal attendance retrieved successfully"
      )
    );
  }
);
// FIXED: Get user's monthly attendance (both project and normal types)
export const getNormalMonthlyAttendance = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      throw new ApiError(400, "Month and year are required");
    }

    const monthNum = parseInt(month as string);
    const yearNum = parseInt(year as string);

    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new ApiError(400, "Invalid month (must be 1-12)");
    }

    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      throw new ApiError(400, "Invalid year");
    }

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0);
    endDate.setHours(23, 59, 59, 999);

    // Get ALL attendance records for the user (both project and normal)
    const attendance = await Attendance.find({
      user: userId,
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    })
      .sort({ date: 1, type: 1 }) // Sort by date, then type for consistent ordering
      .populate("markedBy", "firstName lastName")
      .populate("project", "projectName");

    // Separate attendance by type
    const normalAttendance = attendance.filter(a => a.type === 'normal');
    const projectAttendance = attendance.filter(a => a.type === 'project');

    // Calculate totals for each type
    const normalTotals = {
      presentDays: normalAttendance.filter((a) => a.present).length,
      totalWorkingHours: normalAttendance.reduce((sum, a) => sum + a.workingHours, 0),
      totalOvertimeHours: normalAttendance.reduce((sum, a) => sum + a.overtimeHours, 0),
    };

    const projectTotals = {
      presentDays: projectAttendance.filter((a) => a.present).length,
      totalWorkingHours: projectAttendance.reduce((sum, a) => sum + a.workingHours, 0),
      totalOvertimeHours: projectAttendance.reduce((sum, a) => sum + a.overtimeHours, 0),
    };

    const overallTotals = {
      presentDays: attendance.filter((a) => a.present).length,
      totalWorkingHours: attendance.reduce((sum, a) => sum + a.workingHours, 0),
      totalOvertimeHours: attendance.reduce((sum, a) => sum + a.overtimeHours, 0),
    };

    res.status(200).json(
      new ApiResponse(
        200,
        {
          attendance: attendance, // All attendance records
          normalAttendance,
          projectAttendance,
          totals: {
            normal: normalTotals,
            project: projectTotals,
            overall: overallTotals,
          },
          month: monthNum,
          year: yearNum,
        },
        "Monthly attendance retrieved successfully"
      )
    );
  }
);

// NEW: Get user's monthly attendance by type
export const getUserMonthlyAttendanceByType = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { month, year, type = 'all' } = req.query;

    if (!month || !year) {
      throw new ApiError(400, "Month and year are required");
    }

    const monthNum = parseInt(month as string);
    const yearNum = parseInt(year as string);

    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new ApiError(400, "Invalid month (must be 1-12)");
    }

    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      throw new ApiError(400, "Invalid year");
    }

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0);
    endDate.setHours(23, 59, 59, 999);

    const filter: any = {
      user: userId,
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Add type filter if specified
    if (type !== 'all' && ['project', 'normal'].includes(type as string)) {
      filter.type = type;
    }

    const attendance = await Attendance.find(filter)
      .sort({ date: 1, type: 1 })
      .populate("markedBy", "firstName lastName")
      .populate("project", "projectName");

    // Calculate totals
    const totals = {
      presentDays: attendance.filter((a) => a.present).length,
      totalWorkingHours: attendance.reduce((sum, a) => sum + a.workingHours, 0),
      totalOvertimeHours: attendance.reduce((sum, a) => sum + a.overtimeHours, 0),
    };

    res.status(200).json(
      new ApiResponse(
        200,
        {
          attendance,
          totals,
          type: type as string,
          month: monthNum,
          year: yearNum,
        },
        `Monthly ${type === 'all' ? '' : type + ' '}attendance retrieved successfully`
      )
    );
  }
);