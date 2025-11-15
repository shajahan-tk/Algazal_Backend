// controllers/analyticsController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { Project } from "../models/projectModel";
import { Client } from "../models/clientModel";
import { User } from "../models/userModel";
import { Expense } from "../models/expenseModel";
import { Quotation } from "../models/quotationModel";
import { LPO } from "../models/lpoModel";
import dayjs from "dayjs";

export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  // Get basic counts
  const totalProjects = await Project.countDocuments();
  const totalClients = await Client.countDocuments();
  const totalEmployees = await User.countDocuments({ role: { $ne: "admin" } });
  const totalExpenses = await Expense.countDocuments();

  // Get project status distribution
  const projectStatusCounts = await Project.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  // Get recent projects
  const recentProjects = await Project.find()
    .populate("client", "clientName")
    .sort({ createdAt: -1 })
    .limit(5);

  // Get projects by month for the last 6 months
  const sixMonthsAgo = dayjs().subtract(6, "month").toDate();
  const projectsByMonth = await Project.aggregate([
    {
      $match: {
        createdAt: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  // Get expense data for the last 6 months
  const expensesByMonth = await Expense.aggregate([
    {
      $match: {
        date: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$date" },
          month: { $month: "$date" },
        },
        total: { $sum: "$amount" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  // Get top clients by project count
  const topClients = await Project.aggregate([
    {
      $group: {
        _id: "$client",
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 5,
    },
    {
      $lookup: {
        from: "clients",
        localField: "_id",
        foreignField: "_id",
        as: "clientInfo",
      },
    },
    {
      $unwind: "$clientInfo",
    },
    {
      $project: {
        clientName: "$clientInfo.clientName",
        projectCount: "$count",
      },
    },
  ]);

  // Get project progress distribution
  const progressDistribution = await Project.aggregate([
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              { case: { $lt: ["$progress", 25] }, then: "0-25%" },
              { case: { $and: [{ $gte: ["$progress", 25] }, { $lt: ["$progress", 50] }] }, then: "25-50%" },
              { case: { $and: [{ $gte: ["$progress", 50] }, { $lt: ["$progress", 75] }] }, then: "50-75%" },
              { case: { $gte: ["$progress", 75] }, then: "75-100%" },
            ],
            default: "Unknown",
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Get revenue data (from quotations)
  const revenueByMonth = await Quotation.aggregate([
    {
      $match: {
        createdAt: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        total: { $sum: "$netAmount" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  // Get upcoming tasks (projects that need attention)
  const upcomingTasks = await Project.find({
    status: { $in: ["quotation_sent", "lpo_received", "team_assigned", "work_started"] },
  })
    .populate("client", "clientName")
    .sort({ updatedAt: -1 })
    .limit(5);

  // Get financial summary
  const totalQuotedAmount = await Quotation.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: "$netAmount" },
      },
    },
  ]);

  const totalExpenseAmount = await Expense.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
      },
    },
  ]);

  const totalLPOAmount = await LPO.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: "$totalAmount" },
      },
    },
  ]);

  // Format month data for charts
  const formatMonthData = (data: any[]) => {
    const result = [];
    const currentMonth = dayjs().month();
    const currentYear = dayjs().year();

    for (let i = 5; i >= 0; i--) {
      const month = currentMonth - i < 0 ? 12 + (currentMonth - i) : currentMonth - i;
      const year = currentMonth - i < 0 ? currentYear - 1 : currentYear;

      const monthData = data.find(
        (item) => item._id.year === year && item._id.month === month + 1
      );

      result.push({
        month: dayjs(`${year}-${month + 1}-01`).format("MMM"),
        value: monthData ? monthData.count || monthData.total || 0 : 0,
      });
    }

    return result;
  };

  const dashboardData = {
    stats: {
      totalProjects,
      totalClients,
      totalEmployees,
      totalExpenses,
      totalQuotedAmount: totalQuotedAmount[0]?.total || 0,
      totalExpenseAmount: totalExpenseAmount[0]?.total || 0,
      totalLPOAmount: totalLPOAmount[0]?.total || 0,
    },
    charts: {
      projectsByMonth: formatMonthData(projectsByMonth),
      expensesByMonth: formatMonthData(expensesByMonth),
      revenueByMonth: formatMonthData(revenueByMonth),
      projectStatusCounts,
      progressDistribution,
    },
    lists: {
      recentProjects,
      topClients,
      upcomingTasks,
    },
  };

  res
    .status(200)
    .json(new ApiResponse(200, dashboardData, "Dashboard data retrieved successfully"));
});

export const getProjectAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { timeframe } = req.query;
  let startDate;

  // Set start date based on timeframe
  switch (timeframe) {
    case "week":
      startDate = dayjs().subtract(1, "week").toDate();
      break;
    case "month":
      startDate = dayjs().subtract(1, "month").toDate();
      break;
    case "quarter":
      startDate = dayjs().subtract(3, "month").toDate();
      break;
    case "year":
      startDate = dayjs().subtract(1, "year").toDate();
      break;
    default:
      startDate = dayjs().subtract(1, "month").toDate();
  }

  // Get project status changes over time
  const statusChanges = await Project.aggregate([
    {
      $match: {
        updatedAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          status: "$status",
          date: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$updatedAt",
            },
          },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { "_id.date": 1 },
    },
  ]);

  // Get project completion rate
  const completedProjects = await Project.countDocuments({
    status: { $in: ["work_completed", "client_handover", "payment_received", "project_closed"] },
    updatedAt: { $gte: startDate },
  });

  const totalProjectsInPeriod = await Project.countDocuments({
    updatedAt: { $gte: startDate },
  });

  const completionRate = totalProjectsInPeriod > 0 ? (completedProjects / totalProjectsInPeriod) * 100 : 0;

  // Get average project duration
  const projectDurations = await Project.aggregate([
    {
      $match: {
        status: { $in: ["work_completed", "client_handover", "payment_received", "project_closed"] },
        workStartDate: { $exists: true },
        workEndDate: { $exists: true },
      },
    },
    {
      $project: {
        duration: {
          $divide: [
            { $subtract: ["$workEndDate", "$workStartDate"] },
            1000 * 60 * 60 * 24, // Convert milliseconds to days
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        averageDuration: { $avg: "$duration" },
        minDuration: { $min: "$duration" },
        maxDuration: { $max: "$duration" },
      },
    },
  ]);

  // Get project type distribution (if you have a project type field)
  // This is a placeholder, adjust based on your actual data model
  const projectTypeDistribution = await Project.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const analyticsData = {
    statusChanges,
    completionRate,
    averageProjectDuration: projectDurations[0]?.averageDuration || 0,
    minProjectDuration: projectDurations[0]?.minDuration || 0,
    maxProjectDuration: projectDurations[0]?.maxDuration || 0,
    projectTypeDistribution,
  };

  res
    .status(200)
    .json(new ApiResponse(200, analyticsData, "Project analytics retrieved successfully"));
});

export const getFinancialAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { timeframe } = req.query;
  let startDate;

  // Set start date based on timeframe
  switch (timeframe) {
    case "week":
      startDate = dayjs().subtract(1, "week").toDate();
      break;
    case "month":
      startDate = dayjs().subtract(1, "month").toDate();
      break;
    case "quarter":
      startDate = dayjs().subtract(3, "month").toDate();
      break;
    case "year":
      startDate = dayjs().subtract(1, "year").toDate();
      break;
    default:
      startDate = dayjs().subtract(1, "month").toDate();
  }

  // Get revenue vs expenses
  const revenueData = await Quotation.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        revenue: { $sum: "$netAmount" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  const expenseData = await Expense.aggregate([
    {
      $match: {
        date: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$date" },
          month: { $month: "$date" },
        },
        expenses: { $sum: "$amount" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  // Get expense categories
  const expenseCategories = await Expense.aggregate([
    {
      $match: {
        date: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: "$category",
        total: { $sum: "$amount" },
      },
    },
    {
      $sort: { total: -1 },
    },
  ]);

  // Get profit margins by project
  const profitMargins = await Project.aggregate([
    {
      $lookup: {
        from: "quotations",
        localField: "_id",
        foreignField: "project",
        as: "quotation",
      },
    },
    {
      $lookup: {
        from: "expenses",
        localField: "_id",
        foreignField: "project",
        as: "expenses",
      },
    },
    {
      $unwind: "$quotation",
    },
    {
      $project: {
        projectName: 1,
        revenue: "$quotation.netAmount",
        expenses: { $sum: "$expenses.amount" },
        profit: { $subtract: ["$quotation.netAmount", { $sum: "$expenses.amount" }] },
        profitMargin: {
          $multiply: [
            {
              $divide: [
                { $subtract: ["$quotation.netAmount", { $sum: "$expenses.amount" }] },
                "$quotation.netAmount",
              ],
            },
            100,
          ],
        },
      },
    },
    {
      $sort: { profitMargin: -1 },
    },
    {
      $limit: 10,
    },
  ]);

  // Format month data for charts
  const formatMonthData = (revenue: any[], expenses: any[]) => {
    const result = [];
    const currentMonth = dayjs().month();
    const currentYear = dayjs().year();

    for (let i = 5; i >= 0; i--) {
      const month = currentMonth - i < 0 ? 12 + (currentMonth - i) : currentMonth - i;
      const year = currentMonth - i < 0 ? currentYear - 1 : currentYear;

      const revenueMonth = revenue.find(
        (item) => item._id.year === year && item._id.month === month + 1
      );
      const expenseMonth = expenses.find(
        (item) => item._id.year === year && item._id.month === month + 1
      );

      result.push({
        month: dayjs(`${year}-${month + 1}-01`).format("MMM"),
        revenue: revenueMonth ? revenueMonth.revenue : 0,
        expenses: expenseMonth ? expenseMonth.expenses : 0,
        profit: (revenueMonth ? revenueMonth.revenue : 0) - (expenseMonth ? expenseMonth.expenses : 0),
      });
    }

    return result;
  };

  const financialData = {
    revenueVsExpenses: formatMonthData(revenueData, expenseData),
    expenseCategories,
    profitMargins,
  };

  res
    .status(200)
    .json(new ApiResponse(200, financialData, "Financial analytics retrieved successfully"));
});