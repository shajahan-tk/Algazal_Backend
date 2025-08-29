"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectAnalytics = exports.getProjectAnalyticsAll = exports.getEmployeeTrend = exports.getOverviewStats = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const attendanceModel_1 = require("../models/attendanceModel");
const userModel_1 = require("../models/userModel");
const projectModel_1 = require("../models/projectModel");
const dayjs_1 = __importDefault(require("dayjs"));
const mongoose_1 = require("mongoose");
// 1. Dashboard Overview Stats
exports.getOverviewStats = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { period = "monthly", year = (0, dayjs_1.default)().year().toString() } = req.query;
    // Calculate date range
    const startDate = (0, dayjs_1.default)(`${year}-01-01`).startOf("year").toDate();
    const endDate = (0, dayjs_1.default)(`${year}-12-31`).endOf("year").toDate();
    // Get basic counts
    const [totalPresent, totalAbsent, totalEmployees] = await Promise.all([
        attendanceModel_1.Attendance.countDocuments({
            present: true,
            date: { $gte: startDate, $lte: endDate },
        }),
        attendanceModel_1.Attendance.countDocuments({
            present: false,
            date: { $gte: startDate, $lte: endDate },
        }),
        userModel_1.User.countDocuments({}),
    ]);
    // Monthly trend data
    const monthlyTrend = await attendanceModel_1.Attendance.aggregate([
        {
            $match: {
                date: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: { $month: "$date" },
                present: { $sum: { $cond: [{ $eq: ["$present", true] }, 1, 0] } },
                total: { $sum: 1 },
            },
        },
        {
            $project: {
                month: "$_id",
                attendanceRate: {
                    $round: [
                        { $multiply: [{ $divide: ["$present", "$total"] }, 100] },
                        1,
                    ],
                },
                _id: 0,
            },
        },
        { $sort: { month: 1 } },
    ]);
    // Top/Bottom performers
    const performers = await attendanceModel_1.Attendance.aggregate([
        {
            $match: {
                date: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "user",
                foreignField: "_id",
                as: "user",
            },
        },
        { $unwind: "$user" },
        {
            $group: {
                _id: "$user._id",
                name: {
                    $first: { $concat: ["$user.firstName", " ", "$user.lastName"] },
                },
                present: { $sum: { $cond: [{ $eq: ["$present", true] }, 1, 0] } },
                total: { $sum: 1 },
            },
        },
        {
            $project: {
                employeeId: "$_id",
                name: 1,
                attendanceRate: {
                    $round: [
                        { $multiply: [{ $divide: ["$present", "$total"] }, 100] },
                        1,
                    ],
                },
                _id: 0,
            },
        },
        { $sort: { attendanceRate: -1 } },
        { $limit: 10 },
    ]);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        period,
        year,
        totalEmployees,
        totalPresent,
        totalAbsent,
        overallAttendance: (totalPresent / (totalPresent + totalAbsent)) * 100,
        monthlyTrend,
        topPerformers: performers.slice(0, 5),
        bottomPerformers: performers.slice(-5).reverse(),
    }, "Overview stats retrieved successfully"));
});
// 2. Employee Trend Analysis
exports.getEmployeeTrend = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { employeeId } = req.params;
    const { months = "6" } = req.query;
    // Validate employee exists
    const employee = await userModel_1.User.findById(employeeId);
    if (!employee) {
        throw new apiHandlerHelpers_2.ApiError(404, "Employee not found");
    }
    const endDate = (0, dayjs_1.default)().endOf("day").toDate();
    const startDate = (0, dayjs_1.default)()
        .subtract(Number(months), "months")
        .startOf("day")
        .toDate();
    const trendData = await attendanceModel_1.Attendance.aggregate([
        {
            $match: {
                user: new mongoose_1.Types.ObjectId(employeeId),
                date: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m", date: "$date" } },
                present: { $sum: { $cond: [{ $eq: ["$present", true] }, 1, 0] } },
                total: { $sum: 1 },
            },
        },
        {
            $project: {
                month: "$_id",
                attendanceRate: {
                    $round: [
                        { $multiply: [{ $divide: ["$present", "$total"] }, 100] },
                        1,
                    ],
                },
                presentDays: "$present",
                workingDays: "$total",
                _id: 0,
            },
        },
        { $sort: { month: 1 } },
    ]);
    // Calculate totals
    const totals = trendData.reduce((acc, curr) => {
        acc.present += curr.presentDays;
        acc.total += curr.workingDays;
        return acc;
    }, { present: 0, total: 0 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        employee: {
            id: employee._id,
            name: `${employee.firstName} ${employee.lastName}`,
            position: employee.role,
        },
        months: Number(months),
        trendData,
        overallAttendance: totals.total > 0 ? (totals.present / totals.total) * 100 : 0,
        totalPresent: totals.present,
        totalAbsent: totals.total - totals.present,
    }, "Employee trend data retrieved successfully"));
});
// 3. All Projects Analytics
exports.getProjectAnalyticsAll = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { period = "monthly", year = (0, dayjs_1.default)().year().toString() } = req.query;
    const projects = await projectModel_1.Project.find().select("_id projectName");
    const projectStats = await Promise.all(projects.map(async (project) => {
        const stats = await attendanceModel_1.Attendance.aggregate([
            {
                $match: {
                    project: project._id,
                    type: "project",
                },
            },
            {
                $group: {
                    _id: null,
                    present: { $sum: { $cond: [{ $eq: ["$present", true] }, 1, 0] } },
                    total: { $sum: 1 },
                },
            },
        ]);
        return {
            projectId: project._id,
            projectName: project.projectName,
            present: stats[0]?.present || 0,
            total: stats[0]?.total || 0,
            attendanceRate: stats[0]
                ? (stats[0].present / stats[0].total) * 100
                : 0,
        };
    }));
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        period,
        year,
        projectStats: projectStats.sort((a, b) => b.attendanceRate - a.attendanceRate),
    }, "All projects stats retrieved successfully"));
});
// 4. Specific Project Analytics
exports.getProjectAnalytics = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const { period = "monthly", year = (0, dayjs_1.default)().year().toString() } = req.query;
    const project = await projectModel_1.Project.findById(projectId);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    const analytics = await attendanceModel_1.Attendance.aggregate([
        {
            $match: {
                project: new mongoose_1.Types.ObjectId(projectId),
                type: "project",
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "user",
                foreignField: "_id",
                as: "user",
            },
        },
        { $unwind: "$user" },
        {
            $group: {
                _id: {
                    period: period === "monthly"
                        ? { $dateToString: { format: "%Y-%m", date: "$date" } }
                        : { $dateToString: { format: "%Y-%U", date: "$date" } },
                    userId: "$user._id",
                    userName: {
                        $first: { $concat: ["$user.firstName", " ", "$user.lastName"] },
                    },
                },
                present: { $sum: { $cond: [{ $eq: ["$present", true] }, 1, 0] } },
                total: { $sum: 1 },
            },
        },
        {
            $group: {
                _id: "$_id.period",
                period: { $first: "$_id.period" },
                workers: {
                    $push: {
                        userId: "$_id.userId",
                        name: "$_id.userName",
                        present: "$present",
                        total: "$total",
                        rate: { $divide: ["$present", "$total"] },
                    },
                },
                totalPresent: { $sum: "$present" },
                totalDays: { $sum: "$total" },
            },
        },
        {
            $project: {
                period: 1,
                attendanceRate: {
                    $round: [
                        {
                            $multiply: [{ $divide: ["$totalPresent", "$totalDays"] }, 100],
                        },
                        1,
                    ],
                },
                workers: {
                    $map: {
                        input: "$workers",
                        as: "worker",
                        in: {
                            userId: "$$worker.userId",
                            name: "$$worker.name",
                            presentDays: "$$worker.present",
                            totalDays: "$$worker.total",
                            attendanceRate: {
                                $round: [{ $multiply: ["$$worker.rate", 100] }, 1],
                            },
                        },
                    },
                },
                _id: 0,
            },
        },
        { $sort: { period: 1 } },
    ]);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        project: {
            id: project._id,
            name: project.projectName,
            startDate: project.createdAt,
            endDate: project.updatedAt,
        },
        period,
        year,
        analytics,
    }, "Project analytics retrieved successfully"));
});
//# sourceMappingURL=attendanceAnalytics.js.map