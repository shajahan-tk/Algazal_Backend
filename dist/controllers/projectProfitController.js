"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportProjectProfitsToExcel = exports.getProfitSummary = exports.deleteProjectProfit = exports.updateProjectProfit = exports.getProjectProfit = exports.getProjectProfits = exports.createProjectProfit = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const projectProfitModel_1 = require("../models/projectProfitModel");
const uploadConf_1 = require("../utils/uploadConf");
const exceljs_1 = __importDefault(require("exceljs"));
exports.createProjectProfit = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectName, poNumber, startDate, budget, expenses, description } = req.body;
    if (!projectName || !poNumber || !startDate || budget === undefined) {
        throw new apiHandlerHelpers_2.ApiError(400, "Required fields are missing");
    }
    let attachments = [];
    const files = Array.isArray(req.files) ? req.files : req.files ? Object.values(req.files).flat() : [];
    if (files.length > 0) {
        const uploadResults = await (0, uploadConf_1.handleMultipleFileUploads)(files);
        if (!uploadResults.success) {
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload attachments");
        }
        attachments = uploadResults.uploadData?.map((file) => ({
            fileName: file.key.split("/").pop() || "attachment",
            fileType: file.mimetype,
            filePath: file.url,
        })) || [];
    }
    const projectProfit = await projectProfitModel_1.ProjectProfit.create({
        projectName,
        poNumber,
        startDate: new Date(startDate),
        budget,
        expenses: expenses || 0,
        description,
        attachments,
        createdBy: req.user?.userId,
    });
    res.status(201).json(new apiHandlerHelpers_1.ApiResponse(201, projectProfit, "Project profit record created successfully"));
});
exports.getProjectProfits = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { search, month, year, startDate, endDate, minProfit, maxProfit, page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = {};
    // Search filter
    if (search) {
        const searchRegex = new RegExp(search, "i");
        filter.$or = [
            { projectName: searchRegex },
            { poNumber: searchRegex },
            { description: searchRegex },
        ];
    }
    // Date range filter (takes precedence over year/month)
    if (startDate && endDate) {
        filter.startDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
        };
    }
    else {
        // Year filter
        if (year) {
            const yearNum = parseInt(year);
            if (isNaN(yearNum)) {
                throw new apiHandlerHelpers_2.ApiError(400, "Invalid year value");
            }
            filter.startDate = {
                $gte: new Date(yearNum, 0, 1),
                $lte: new Date(yearNum + 1, 0, 1),
            };
        }
        // Month filter (works with year filter)
        if (month) {
            const monthNum = parseInt(month);
            if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
                throw new apiHandlerHelpers_2.ApiError(400, "Invalid month value (1-12)");
            }
            if (!filter.startDate) {
                // If no year specified, use current year
                const currentYear = new Date().getFullYear();
                filter.startDate = {
                    $gte: new Date(currentYear, monthNum - 1, 1),
                    $lt: new Date(currentYear, monthNum, 1),
                };
            }
            else {
                // Adjust existing year filter to specific month
                const startDate = new Date(filter.startDate.$gte);
                startDate.setMonth(monthNum - 1);
                startDate.setDate(1);
                const endDate = new Date(startDate);
                endDate.setMonth(monthNum);
                filter.startDate.$gte = startDate;
                filter.startDate.$lte = endDate;
            }
        }
    }
    // Profit range filter
    if (minProfit || maxProfit) {
        filter.profit = {};
        if (minProfit) {
            filter.profit.$gte = parseFloat(minProfit);
        }
        if (maxProfit) {
            filter.profit.$lte = parseFloat(maxProfit);
        }
    }
    const total = await projectProfitModel_1.ProjectProfit.countDocuments(filter);
    const totals = await projectProfitModel_1.ProjectProfit.aggregate([
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
    const projects = await projectProfitModel_1.ProjectProfit.find(filter)
        .skip(skip)
        .limit(Number(limit))
        .sort({ startDate: -1 })
        .populate("createdBy", "firstName lastName");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        projects,
        totals: totals[0] || { totalBudget: 0, totalExpenses: 0, totalProfit: 0 },
        pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
            hasNextPage: Number(page) * Number(limit) < total,
            hasPreviousPage: Number(page) > 1,
        },
    }, "Project profits retrieved successfully"));
});
exports.getProjectProfit = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const project = await projectProfitModel_1.ProjectProfit.findById(id).populate("createdBy", "firstName lastName");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project profit record not found");
    }
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, project, "Project profit retrieved successfully"));
});
exports.updateProjectProfit = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const project = await projectProfitModel_1.ProjectProfit.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project profit record not found");
    }
    // Handle file uploads for new attachments
    let newAttachments = [];
    const files = Array.isArray(req.files)
        ? req.files
        : req.files
            ? Object.values(req.files).flat()
            : [];
    if (files.length > 0) {
        const uploadResults = await (0, uploadConf_1.handleMultipleFileUploads)(files);
        if (!uploadResults.success) {
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload new attachments");
        }
        newAttachments =
            uploadResults.uploadData?.map((file) => ({
                fileName: file.key.split("/").pop() || "attachment",
                fileType: file.mimetype,
                filePath: file.url,
            })) || [];
    }
    // Handle attachment deletions if specified
    if (updateData.deletedAttachments &&
        updateData.deletedAttachments.length > 0) {
        await Promise.all(updateData.deletedAttachments.map(async (attachmentId) => {
            const attachment = project.attachments.id(attachmentId);
            if (attachment) {
                try {
                    const key = (0, uploadConf_1.getS3KeyFromUrl)(attachment.filePath);
                    await (0, uploadConf_1.deleteFileFromS3)(key);
                    project.attachments.pull(attachmentId);
                }
                catch (error) {
                    console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
                }
            }
        }));
    }
    // Prepare update payload
    const updatePayload = {
        ...updateData,
        $push: { attachments: { $each: newAttachments } },
    };
    // Convert dates if they exist in updateData
    if (updateData.startDate) {
        updatePayload.startDate = new Date(updateData.startDate);
    }
    // Update the project
    const updatedProject = await projectProfitModel_1.ProjectProfit.findByIdAndUpdate(id, updatePayload, {
        new: true,
    }).populate("createdBy", "firstName lastName");
    if (!updatedProject) {
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to update project profit record");
    }
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Project profit updated successfully"));
});
exports.deleteProjectProfit = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const project = await projectProfitModel_1.ProjectProfit.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project profit record not found");
    }
    // Delete all associated files from S3
    if (project.attachments && project.attachments.length > 0) {
        await Promise.all(project.attachments.map(async (attachment) => {
            try {
                const key = (0, uploadConf_1.getS3KeyFromUrl)(attachment.filePath);
                await (0, uploadConf_1.deleteFileFromS3)(key);
            }
            catch (error) {
                console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
            }
        }));
    }
    await projectProfitModel_1.ProjectProfit.findByIdAndDelete(id);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "Project profit record deleted successfully"));
});
exports.getProfitSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { groupBy } = req.query;
    let groupStage;
    switch (groupBy) {
        case "month":
            groupStage = {
                $group: {
                    _id: {
                        year: { $year: "$startDate" },
                        month: { $month: "$startDate" },
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
                        year: { $year: "$startDate" },
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
    const summary = await projectProfitModel_1.ProjectProfit.aggregate([
        groupStage,
        { $sort: { _id: 1 } },
    ]);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, summary, "Profit summary retrieved successfully"));
});
exports.exportProjectProfitsToExcel = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { search, month, year, minProfit, maxProfit } = req.query;
    const filter = {};
    // Search filter
    if (search) {
        const searchRegex = new RegExp(search, "i");
        filter.$or = [
            { projectName: searchRegex },
            { poNumber: searchRegex },
            { description: searchRegex },
        ];
    }
    // Date range filter - Fixed implementation
    if (month && year) {
        // Both month and year provided
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
            throw new apiHandlerHelpers_2.ApiError(400, "Invalid month value (1-12)");
        }
        if (isNaN(yearNum)) {
            throw new apiHandlerHelpers_2.ApiError(400, "Invalid year value");
        }
        // Create start and end dates for the specific month
        const startDate = new Date(yearNum, monthNum - 1, 1); // First day of month
        const endDate = new Date(yearNum, monthNum, 0); // Last day of month
        filter.startDate = {
            $gte: startDate,
            $lte: endDate
        };
    }
    else if (year && !month) {
        // Only year provided
        const yearNum = parseInt(year);
        if (isNaN(yearNum)) {
            throw new apiHandlerHelpers_2.ApiError(400, "Invalid year value");
        }
        const startDate = new Date(yearNum, 0, 1); // January 1st of the year
        const endDate = new Date(yearNum, 11, 31); // December 31st of the year
        filter.startDate = {
            $gte: startDate,
            $lte: endDate
        };
    }
    else if (month && !year) {
        // Only month provided, use current year
        const monthNum = parseInt(month);
        const currentYear = new Date().getFullYear();
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
            throw new apiHandlerHelpers_2.ApiError(400, "Invalid month value (1-12)");
        }
        const startDate = new Date(currentYear, monthNum - 1, 1);
        const endDate = new Date(currentYear, monthNum, 0);
        filter.startDate = {
            $gte: startDate,
            $lte: endDate
        };
    }
    // Profit range filter
    if (minProfit || maxProfit) {
        filter.profit = {};
        if (minProfit) {
            const min = parseFloat(minProfit);
            if (!isNaN(min))
                filter.profit.$gte = min;
        }
        if (maxProfit) {
            const max = parseFloat(maxProfit);
            if (!isNaN(max))
                filter.profit.$lte = max;
        }
    }
    // Get projects with populated createdBy
    const projects = await projectProfitModel_1.ProjectProfit.find(filter)
        .sort({ startDate: -1 })
        .populate("createdBy", "firstName lastName");
    // Create Excel workbook
    const workbook = new exceljs_1.default.Workbook();
    const worksheet = workbook.addWorksheet("Project Profits");
    // Define columns with SNO and all required fields
    worksheet.columns = [
        { header: "SNO", key: "sno", width: 5 },
        { header: "DATE", key: "startDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
        { header: "PROJECT NAME", key: "projectName", width: 25 },
        { header: "PO NUMBER", key: "poNumber", width: 15 },
        { header: "BUDGET", key: "budget", width: 12, style: { numFmt: "#,##0.00" } },
        { header: "EXPENSES", key: "expenses", width: 12, style: { numFmt: "#,##0.00" } },
        { header: "PROFIT", key: "profit", width: 12, style: { numFmt: "#,##0.00" } },
        { header: "REMARKS", key: "description", width: 30 },
    ];
    // Add data rows with SNO
    projects.forEach((project, index) => {
        worksheet.addRow({
            sno: index + 1,
            startDate: project.startDate,
            projectName: project.projectName,
            poNumber: project.poNumber,
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
        cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
        };
    });
    // Freeze the header row
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    // Add totals row
    const totals = await projectProfitModel_1.ProjectProfit.aggregate([
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
        worksheet.addRow([]); // Empty row before totals
        const totalRow = worksheet.addRow({
            sno: "", // Empty for totals row
            projectName: "TOTALS",
            budget: totals[0].totalBudget,
            expenses: totals[0].totalExpenses,
            profit: totals[0].totalProfit,
        });
        // Style totals row
        totalRow.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF2F2F2" },
            };
        });
    }
    // Set response headers
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=project_profits_${new Date().toISOString().split("T")[0]}.xlsx`);
    // Send Excel file
    await workbook.xlsx.write(res);
    res.end();
});
//# sourceMappingURL=projectProfitController.js.map