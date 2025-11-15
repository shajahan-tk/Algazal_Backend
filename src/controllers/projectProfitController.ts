import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse, ApiError } from "../utils/apiHandlerHelpers";
import { ProjectProfit } from "../models/projectProfitModel";
import { Project } from "../models/projectModel";
import { LPO } from "../models/lpoModel";
import { IUser } from "../models/userModel";
import ExcelJS from "exceljs";
import {
  handleMultipleFileUploads,
  deleteFileFromS3,
  getS3KeyFromUrl,
} from "../utils/uploadConf";

export const getProjects = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Build filter
  const filter: any = {};

  if (req.query.status) filter.status = req.query.status;
  if (req.query.client) filter.client = req.query.client;

  if (req.query.search) {
    const searchTerm = req.query.search as string;
    filter.$or = [
      { projectName: { $regex: searchTerm, $options: "i" } },
      { projectDescription: { $regex: searchTerm, $options: "i" } },
      { location: { $regex: searchTerm, $options: "i" } },
      { building: { $regex: searchTerm, $options: "i" } },
      { apartmentNumber: { $regex: searchTerm, $options: "i" } },
      { projectNumber: { $regex: searchTerm, $options: "i" } },
    ];
  }

  // Count total
  const total = await Project.countDocuments(filter);

  // Use aggregation to fetch projects + LPO number + Quotation amount
  const projects = await Project.aggregate([
    { $match: filter },

    // Sort by latest created
    { $sort: { createdAt: -1 } },

    // Pagination
    { $skip: skip },
    { $limit: limit },

    // Lookup client info
    {
      $lookup: {
        from: "clients",
        localField: "client",
        foreignField: "_id",
        as: "client",
      },
    },
    { $unwind: "$client" },

    // Lookup LPO info (for each project)
    {
      $lookup: {
        from: "lpos",
        localField: "_id",
        foreignField: "project",
        as: "lpoData",
      },
    },

    // Lookup Quotation info (for each project)
    {
      $lookup: {
        from: "quotations",
        localField: "_id",
        foreignField: "project",
        as: "quotationData",
      },
    },

    // Add LPO and Quotation fields
    {
      $addFields: {
        lpoNumber: { $arrayElemAt: ["$lpoData.lpoNumber", 0] },
        quotationAmount: { $arrayElemAt: ["$quotationData.netAmount", 0] },
        quotationNumber: { $arrayElemAt: ["$quotationData.quotationNumber", 0] },
      },
    },

    // Optionally remove extra fields
    {
      $project: {
        lpoData: 0, // hide full LPO data
        quotationData: 0, // hide full quotation data
      },
    },
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        projects,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      "Projects retrieved successfully"
    )
  );
});

export const createProjectProfit = asyncHandler(
  async (req: Request, res: Response) => {
    let projectId: string;
    let reportPeriodStart: string;
    let reportPeriodEnd: string;
    let budget: string | number;
    let expenses: string | number;
    let description: string;
    let lpoId: string;

    try {
      console.log("=== CREATE PROJECT PROFIT ===");
      console.log("Request body:", req.body);
      console.log("Request files:", req.files);
      console.log("User:", req.user);
      
      // Destructure and assign to outer variables
      ({ 
        projectId, 
        reportPeriodStart, 
        reportPeriodEnd, 
        budget, 
        expenses, 
        description,
        lpoId 
      } = req.body);

      // Detailed validation with specific error messages
      if (!projectId) {
        console.error("Validation failed: Project ID is missing");
        throw new ApiError(400, "Project ID is required");
      }
      
      if (!reportPeriodStart) {
        console.error("Validation failed: Report period start date is missing");
        throw new ApiError(400, "Report period start date is required");
      }
      
      if (!reportPeriodEnd) {
        console.error("Validation failed: Report period end date is missing");
        throw new ApiError(400, "Report period end date is required");
      }
      
      if (budget === undefined || budget === null || budget === '') {
        console.error("Validation failed: Budget is missing or invalid:", budget);
        throw new ApiError(400, "Budget is required");
      }
      
      // Validate that budget is a valid number
      const budgetNum = Number(budget);
      if (isNaN(budgetNum)) {
        console.error("Validation failed: Budget is not a valid number:", budget);
        throw new ApiError(400, "Budget must be a valid number");
      }
      
      console.log("Validation passed, fetching project...");
    } catch (error) {
      console.error("Error in createProjectProfit:", error);
      throw error;
    }

    // Fetch project with populated client
    const project = await Project.findById(projectId).populate("client");
    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Don't store LPO number in project profit - just reference the LPO ID
    // We'll fetch the LPO data when needed

    // Handle file uploads
    let attachments: Array<{ fileName: string; fileType: string; filePath: string }> = [];
    const files = Array.isArray(req.files) ? req.files : req.files ? Object.values(req.files).flat() : [];

    if (files.length > 0) {
      const uploadResults = await handleMultipleFileUploads(files);
      if (!uploadResults.success) {
        throw new ApiError(500, "Failed to upload attachments");
      }
      attachments = uploadResults.uploadData?.map((file) => ({
        fileName: file.key.split("/").pop() || "attachment",
        fileType: file.mimetype,
        filePath: file.url,
      })) || [];
    }

    // Calculate report month (first day of the month)
    const reportMonth = new Date(reportPeriodStart);
    reportMonth.setDate(1);
    reportMonth.setHours(0, 0, 0, 0);

    // Create project profit WITHOUT storing LPO number
    const projectProfit = await ProjectProfit.create({
      project: projectId,
      projectName: project.projectName,
      projectNumber: project.projectNumber,
      clientName: (project.client as any).clientName,
      location: project.location,
      building: project.building,
      apartmentNumber: project.apartmentNumber,
      // Only store lpoId reference, not lpoNumber
      lpoId: lpoId || undefined,
      reportMonth,
      reportPeriodStart: new Date(reportPeriodStart),
      reportPeriodEnd: new Date(reportPeriodEnd),
      budget: Number(budget),
      expenses: Number(expenses) || 0,
      description,
      attachments,
      createdBy: req.user?.userId,
    });

    res.status(201).json(
      new ApiResponse(201, projectProfit, "Project profit record created successfully")
    );
  }
);

export const getProjectProfits = asyncHandler(
  async (req: Request, res: Response) => {
    const { 
      search, 
      month, 
      year, 
      startDate, 
      endDate, 
      minProfit, 
      maxProfit,
      projectId,
      page = 1, 
      limit = 10 
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = {};

    // Project filter
    if (projectId) {
      filter.project = projectId;
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      filter.$or = [
        { projectName: searchRegex },
        { projectNumber: searchRegex },
        { description: searchRegex },
        { clientName: searchRegex },
      ];
    }

    // Date range filter (takes precedence over year/month)
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    } else {
      // Year filter - based on createdAt
      if (year) {
        const yearNum = parseInt(year as string);
        if (isNaN(yearNum)) {
          throw new ApiError(400, "Invalid year value");
        }
        filter.createdAt = {
          $gte: new Date(yearNum, 0, 1),
          $lte: new Date(yearNum + 1, 0, 1),
        };
      }

      // Month filter - based on createdAt (works with year filter)
      if (month) {
        const monthNum = parseInt(month as string);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          throw new ApiError(400, "Invalid month value (1-12)");
        }

        if (!filter.createdAt) {
          const currentYear = new Date().getFullYear();
          filter.createdAt = {
            $gte: new Date(currentYear, monthNum - 1, 1),
            $lt: new Date(currentYear, monthNum, 1),
          };
        } else {
          const startDate = new Date(filter.createdAt.$gte);
          startDate.setMonth(monthNum - 1);
          startDate.setDate(1);

          const endDate = new Date(startDate);
          endDate.setMonth(monthNum);

          filter.createdAt.$gte = startDate;
          filter.createdAt.$lte = endDate;
        }
      }
    }

    // Profit range filter
    if (minProfit || maxProfit) {
      filter.profit = {};
      if (minProfit) {
        filter.profit.$gte = parseFloat(minProfit as string);
      }
      if (maxProfit) {
        filter.profit.$lte = parseFloat(maxProfit as string);
      }
    }

    const total = await ProjectProfit.countDocuments(filter);
    const totals = await ProjectProfit.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalBudget: { $sum: "$budget" },
          totalExpenses: { $sum: "$expenses" },
          totalProfit: { $sum: "$profit" },
        },
      },
    ]);

    // Get project profits with populated LPO data
    const projects = await ProjectProfit.aggregate([
      { $match: filter },
      { $skip: skip },
      { $limit: Number(limit) },
      { $sort: { createdAt: -1 } },
      // First lookup project to get project details
      {
        $lookup: {
          from: "projects",
          localField: "project",
          foreignField: "_id",
          as: "projectData",
        },
      },
      // Unwind project data
      {
        $unwind: {
          path: "$projectData",
          preserveNullAndEmptyArrays: true
        }
      },
      // Lookup LPO data - try both lpoId and project as fallback
      {
        $lookup: {
          from: "lpos",
          localField: "lpoId",
          foreignField: "_id",
          as: "lpoData",
        },
      },
      // If no LPO found with lpoId, try looking up by project
      {
        $lookup: {
          from: "lpos",
          localField: "project",
          foreignField: "project",
          as: "lpoDataByProject",
        },
      },
      // Add lpoNumber field - try lpoData first, then lpoDataByProject
      {
        $addFields: {
          lpoNumber: {
            $ifNull: [
              { $arrayElemAt: ["$lpoData.lpoNumber", 0] },
              { $arrayElemAt: ["$lpoDataByProject.lpoNumber", 0] },
              "N/A"
            ]
          },
        },
      },
      // Group back to remove unwound documents
      {
        $group: {
          _id: "$_id",
          project: { $first: "$project" },
          projectName: { $first: "$projectName" },
          projectNumber: { $first: "$projectNumber" },
          clientName: { $first: "$clientName" },
          location: { $first: "$location" },
          building: { $first: "$building" },
          apartmentNumber: { $first: "$apartmentNumber" },
          lpoId: { $first: "$lpoId" },
          lpoNumber: { $first: "$lpoNumber" },
          reportMonth: { $first: "$reportMonth" },
          reportPeriodStart: { $first: "$reportPeriodStart" },
          reportPeriodEnd: { $first: "$reportPeriodEnd" },
          budget: { $first: "$budget" },
          expenses: { $first: "$expenses" },
          profit: { $first: "$profit" },
          description: { $first: "$description" },
          attachments: { $first: "$attachments" },
          createdBy: { $first: "$createdBy" },
          createdAt: { $first: "$createdAt" },
          updatedAt: { $first: "$updatedAt" }
        }
      },
      // Sort again after grouping
      { $sort: { createdAt: -1 } }
    ]);

    // Populate createdBy and project separately
    const populatedProjects = await ProjectProfit.populate(projects, [
      { path: "createdBy", select: "firstName lastName" },
      { path: "project", select: "projectName projectNumber" },
    ]);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          projects: populatedProjects,
          totals: totals[0] || { totalBudget: 0, totalExpenses: 0, totalProfit: 0 },
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
            hasNextPage: Number(page) * Number(limit) < total,
            hasPreviousPage: Number(page) > 1,
          },
        },
        "Project profits retrieved successfully"
      )
    );
  }
);
export const getProjectProfit = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const project = await ProjectProfit.findById(id)
      .populate("createdBy", "firstName lastName")
      .populate("project", "projectName projectNumber")
      .populate("lpoId", "lpoNumber"); // Populate LPO to get lpoNumber

    if (!project) {
      throw new ApiError(404, "Project profit record not found");
    }

    res.status(200).json(
      new ApiResponse(
        200,
        project,
        "Project profit retrieved successfully"
      )
    );
  }
);

export const updateProjectProfit = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    const projectProfit = await ProjectProfit.findById(id);
    if (!projectProfit) {
      throw new ApiError(404, "Project profit record not found");
    }

    // Handle file uploads for new attachments
    let newAttachments: Array<{
      fileName: string;
      fileType: string;
      filePath: string;
    }> = [];

    const files = Array.isArray(req.files)
      ? req.files
      : req.files
      ? Object.values(req.files).flat()
      : [];

    if (files.length > 0) {
      const uploadResults = await handleMultipleFileUploads(files);
      if (!uploadResults.success) {
        throw new ApiError(500, "Failed to upload new attachments");
      }
      newAttachments =
        uploadResults.uploadData?.map((file) => ({
          fileName: file.key.split("/").pop() || "attachment",
          fileType: file.mimetype,
          filePath: file.url,
        })) || [];
    }

    // Handle attachment deletions
    if (updateData.deletedAttachments && updateData.deletedAttachments.length > 0) {
      await Promise.all(
        updateData.deletedAttachments.map(async (attachmentId: string) => {
          const attachment = projectProfit.attachments.id(attachmentId);
          if (attachment) {
            try {
              const key = getS3KeyFromUrl(attachment.filePath);
              await deleteFileFromS3(key);
              projectProfit.attachments.pull(attachmentId);
            } catch (error) {
              console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
            }
          }
        })
      );
    }

    // Prepare update payload
    const updatePayload: any = {
      ...updateData,
      $push: { attachments: { $each: newAttachments } },
    };

    // Convert dates if they exist
    if (updateData.reportPeriodStart) {
      updatePayload.reportPeriodStart = new Date(updateData.reportPeriodStart);
      
      const reportMonth = new Date(updateData.reportPeriodStart);
      reportMonth.setDate(1);
      reportMonth.setHours(0, 0, 0, 0);
      updatePayload.reportMonth = reportMonth;
    }
    if (updateData.reportPeriodEnd) {
      updatePayload.reportPeriodEnd = new Date(updateData.reportPeriodEnd);
    }

    // Convert numbers
    if (updateData.budget !== undefined) {
      updatePayload.budget = Number(updateData.budget);
    }
    if (updateData.expenses !== undefined) {
      updatePayload.expenses = Number(updateData.expenses);
    }

    // Remove lpoNumber from update payload - we don't store it anymore
    delete updatePayload.lpoNumber;

    const updatedProject = await ProjectProfit.findByIdAndUpdate(
      id,
      updatePayload,
      { new: true }
    )
      .populate("createdBy", "firstName lastName")
      .populate("lpoId", "lpoNumber"); // Populate LPO to get lpoNumber

    if (!updatedProject) {
      throw new ApiError(500, "Failed to update project profit record");
    }

    res.status(200).json(
      new ApiResponse(200, updatedProject, "Project profit updated successfully")
    );
  }
);

export const deleteProjectProfit = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const project = await ProjectProfit.findById(id);
    if (!project) {
      throw new ApiError(404, "Project profit record not found");
    }

    // Delete all associated files from S3
    if (project.attachments && project.attachments.length > 0) {
      await Promise.all(
        project.attachments.map(async (attachment) => {
          try {
            const key = getS3KeyFromUrl(attachment.filePath);
            await deleteFileFromS3(key);
          } catch (error) {
            console.error(
              `Failed to delete file from S3: ${attachment.filePath}`,
              error
            );
          }
        })
      );
    }

    await ProjectProfit.findByIdAndDelete(id);

    res.status(200).json(
      new ApiResponse(
        200,
        null,
        "Project profit record deleted successfully"
      )
    );
  }
);

export const getProfitSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { groupBy } = req.query;

    let groupStage: any;
    switch (groupBy) {
      case "month":
        groupStage = {
          $group: {
            _id: {
              year: { $year: "$reportMonth" },
              month: { $month: "$reportMonth" },
            },
            totalBudget: { $sum: "$budget" },
            totalExpenses: { $sum: "$expenses" },
            totalProfit: { $sum: "$profit" },
            count: { $sum: 1 },
          },
        };
        break;
      case "year":
        groupStage = {
          $group: {
            _id: {
              year: { $year: "$reportMonth" },
            },
            totalBudget: { $sum: "$budget" },
            totalExpenses: { $sum: "$expenses" },
            totalProfit: { $sum: "$profit" },
            count: { $sum: 1 },
          },
        };
        break;
      default:
        groupStage = {
          $group: {
            _id: null,
            totalBudget: { $sum: "$budget" },
            totalExpenses: { $sum: "$expenses" },
            totalProfit: { $sum: "$profit" },
            count: { $sum: 1 },
          },
        };
    }

    const summary = await ProjectProfit.aggregate([
      groupStage,
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json(
      new ApiResponse(
        200,
        summary,
        "Profit summary retrieved successfully"
      )
    );
  }
);

export const exportProjectProfitsToExcel = asyncHandler(
  async (req: Request, res: Response) => {
    const { search, month, year, minProfit, maxProfit, projectId } = req.query;
    
    const filter: any = {};

    // Project filter
    if (projectId) {
      filter.project = projectId;
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      filter.$or = [
        { projectName: searchRegex },
        { description: searchRegex },
        { clientName: searchRegex },
      ];
    }

    // Date filter using createdAt (not reportMonth)
    if (month && year) {
      const monthNum = parseInt(month as string);
      const yearNum = parseInt(year as string);
      
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new ApiError(400, "Invalid month value (1-12)");
      }
      if (isNaN(yearNum)) {
        throw new ApiError(400, "Invalid year value");
      }

      const startDate = new Date(yearNum, monthNum - 1, 1);
      const endDate = new Date(yearNum, monthNum, 0);
      
      filter.createdAt = {
        $gte: startDate,
        $lte: endDate
      };
    } else if (year && !month) {
      const yearNum = parseInt(year as string);
      if (isNaN(yearNum)) {
        throw new ApiError(400, "Invalid year value");
      }

      const startDate = new Date(yearNum, 0, 1);
      const endDate = new Date(yearNum, 11, 31);
      
      filter.createdAt = {
        $gte: startDate,
        $lte: endDate
      };
    }

    // Profit range filter
    if (minProfit || maxProfit) {
      filter.profit = {};
      if (minProfit) {
        const min = parseFloat(minProfit as string);
        if (!isNaN(min)) filter.profit.$gte = min;
      }
      if (maxProfit) {
        const max = parseFloat(maxProfit as string);
        if (!isNaN(max)) filter.profit.$lte = max;
      }
    }

    // Get projects with populated LPO data
    const projects = await ProjectProfit.aggregate([
      { $match: filter },
      { $sort: { createdAt: -1 } }, // Sort by createdAt instead of reportMonth
      // First lookup project to get project details
      {
        $lookup: {
          from: "projects",
          localField: "project",
          foreignField: "_id",
          as: "projectData",
        },
      },
      // Unwind project data
      {
        $unwind: {
          path: "$projectData",
          preserveNullAndEmptyArrays: true
        }
      },
      // Lookup LPO data - try both lpoId and project as fallback
      {
        $lookup: {
          from: "lpos",
          localField: "lpoId",
          foreignField: "_id",
          as: "lpoData",
        },
      },
      // If no LPO found with lpoId, try looking up by project
      {
        $lookup: {
          from: "lpos",
          localField: "project",
          foreignField: "project",
          as: "lpoDataByProject",
        },
      },
      // Add lpoNumber field - try lpoData first, then lpoDataByProject
      {
        $addFields: {
          lpoNumber: {
            $ifNull: [
              { $arrayElemAt: ["$lpoData.lpoNumber", 0] },
              { $arrayElemAt: ["$lpoDataByProject.lpoNumber", 0] },
              "N/A"
            ]
          },
        },
      },
      // Group back to remove unwound documents
      {
        $group: {
          _id: "$_id",
          project: { $first: "$project" },
          projectName: { $first: "$projectName" },
          projectNumber: { $first: "$projectNumber" },
          clientName: { $first: "$clientName" },
          location: { $first: "$location" },
          building: { $first: "$building" },
          apartmentNumber: { $first: "$apartmentNumber" },
          lpoId: { $first: "$lpoId" },
          lpoNumber: { $first: "$lpoNumber" },
          reportMonth: { $first: "$reportMonth" },
          reportPeriodStart: { $first: "$reportPeriodStart" },
          reportPeriodEnd: { $first: "$reportPeriodEnd" },
          budget: { $first: "$budget" },
          expenses: { $first: "$expenses" },
          profit: { $first: "$profit" },
          description: { $first: "$description" },
          attachments: { $first: "$attachments" },
          createdBy: { $first: "$createdBy" },
          createdAt: { $first: "$createdAt" },
          updatedAt: { $first: "$updatedAt" }
        }
      },
      // Sort again after grouping
      { $sort: { createdAt: -1 } } // Sort by createdAt instead of reportMonth
    ]);

    // Populate createdBy
    const populatedProjects = await ProjectProfit.populate(projects, [
      { path: "createdBy", select: "firstName lastName" },
    ]);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Project Profits");

    worksheet.columns = [
      { header: "SNO", key: "sno", width: 5 },
      { header: "REPORT MONTH", key: "reportMonth", width: 12 },
      { header: "PROJECT NAME", key: "projectName", width: 25 },
      { header: "PROJECT NO", key: "projectNumber", width: 15 },
      { header: "CLIENT", key: "clientName", width: 20 },
      { header: "LPO NUMBER", key: "lpoNumber", width: 15 },
      { header: "BUDGET", key: "budget", width: 12 },
      { header: "EXPENSES", key: "expenses", width: 12 },
      { header: "PROFIT", key: "profit", width: 12 },
      { header: "REMARKS", key: "description", width: 30 },
    ];

    populatedProjects.forEach((project:any, index)  => {
      console.log('====================================');
      console.log(project);
      console.log('====================================');
      worksheet.addRow({
        sno: index + 1,
        reportMonth: project.reportMonth,
        projectName: project.projectName,
        projectNumber: project.projectNumber,
        clientName: project.clientName,
        lpoNumber: project.lpoNumber || "N/A",
        budget: project.budget,
        expenses: project.expenses,
        profit: project.profit,
        description: project.description || "",
      });
    });

    // Style header row
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD3D3D3" },
      };
    });

    // Add totals
    const totals = await ProjectProfit.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalBudget: { $sum: "$budget" },
          totalExpenses: { $sum: "$expenses" },
          totalProfit: { $sum: "$profit" },
        },
      },
    ]);

    if (totals.length > 0) {
      worksheet.addRow([]);
      const totalRow = worksheet.addRow({
        projectName: "TOTALS",
        budget: totals[0].totalBudget,
        expenses: totals[0].totalExpenses,
        profit: totals[0].totalProfit,
      });
      
      totalRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F2F2" },
        };
      });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=project_profits_${new Date().toISOString().split("T")[0]}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  }
);