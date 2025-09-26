import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { BankReport, BankReportType } from "../models/bankModel";
import { Shop } from "../models/shopModel";
import { Category } from "../models/categoryModel";
import {
  handleMultipleFileUploads,
  deleteFileFromS3,
  getS3KeyFromUrl,
} from "../utils/uploadConf";
import ExcelJS from "exceljs";

export const createBankReport = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      reportType,
      reportDate,
      amount,
      remarks,
      // ADIB fields
      category,
      shop,
      // Expense fields
      description,
    } = req.body;

    // Validate required fields
    if (!reportType || !reportDate || !amount) {
      throw new ApiError(400, "Required fields are missing");
    }

    // Validate report type specific fields
    if (reportType === "adib") {
      if (!category || !shop) {
        throw new ApiError(
          400,
          "Category and shop are required for ADIB reports"
        );
      }
    } else if (reportType === "expense") {
      if (!description) {
        throw new ApiError(400, "Description is required for expense reports");
      }
    }

    // Check references
    if (shop) {
      const shopExists = await Shop.findById(shop);
      if (!shopExists) {
        throw new ApiError(404, "Shop not found");
      }
    }

    if (category) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        throw new ApiError(404, "Category not found");
      }
    }

    // Handle file uploads
    let attachments: Array<{
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
        throw new ApiError(500, "Failed to upload report attachments");
      }
      attachments =
        uploadResults.uploadData?.map((file) => ({
          fileName: file.key.split("/").pop() || "attachment",
          fileType: file.mimetype,
          filePath: file.url,
        })) || [];
    }

    // Create the report
    const report = await BankReport.create({
      reportType,
      reportDate: new Date(reportDate),
      amount,
      remarks,
      attachments,
      createdBy: req.user?.userId,
      // ADIB fields
      category,
      shop,
      // Expense fields
      description,
    });

    res
      .status(201)
      .json(new ApiResponse(201, report, "Bank report created successfully"));
  }
);

// Get all reports with filters
export const getBankReports = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const filter: any = {};

    // Report type filter
    if (req.query.reportType) {
      filter.reportType = req.query.reportType;
    }

    // Date range filter
    if (req.query.startDate && req.query.endDate) {
      filter.reportDate = {
        $gte: new Date(req.query.startDate as string),
        $lte: new Date(req.query.endDate as string),
      };
    } else {
      // Year filter
      if (req.query.year) {
        const year = parseInt(req.query.year as string);
        if (isNaN(year)) {
          throw new ApiError(400, "Invalid year value");
        }
        filter.reportDate = {
          $gte: new Date(year, 0, 1),
          $lte: new Date(year + 1, 0, 1),
        };
      }

      // Month filter
      if (req.query.month) {
        const month = parseInt(req.query.month as string);
        if (isNaN(month) || month < 1 || month > 12) {
          throw new ApiError(400, "Invalid month value (1-12)");
        }

        if (!filter.reportDate) {
          const currentYear = new Date().getFullYear();
          filter.reportDate = {
            $gte: new Date(currentYear, month - 1, 1),
            $lt: new Date(currentYear, month, 1),
          };
        } else {
          const startDate = new Date(filter.reportDate.$gte);
          startDate.setMonth(month - 1);
          startDate.setDate(1);

          const endDate = new Date(startDate);
          endDate.setMonth(month);

          filter.reportDate.$gte = startDate;
          filter.reportDate.$lte = endDate;
        }
      }
    }

    // Shop filter
    if (req.query.shop) {
      filter.shop = req.query.shop;
    }

    // Category filter
    if (req.query.category) {
      filter.category = req.query.category;
    }

    // Amount range filter
    if (req.query.minAmount || req.query.maxAmount) {
      filter.amount = {};
      if (req.query.minAmount) {
        filter.amount.$gte = parseFloat(req.query.minAmount as string);
      }
      if (req.query.maxAmount) {
        filter.amount.$lte = parseFloat(req.query.maxAmount as string);
      }
    }

    // Search filter
    if (req.query.search) {
      filter.$or = [
        { description: { $regex: req.query.search, $options: "i" } },
        { remarks: { $regex: req.query.search, $options: "i" } },
      ];
    }

    const total = await BankReport.countDocuments(filter);

    // Calculate total amount of all matching reports
    const totalAmountResult = await BankReport.aggregate([
      { $match: filter },
      { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
    ]);
    const totalAmount = totalAmountResult[0]?.totalAmount || 0;

    const reports = await BankReport.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ reportDate: -1 })
      .populate("category", "name description")
      .populate("shop", "shopName shopNo")
      .populate("createdBy", "firstName lastName email");

    res.status(200).json(
      new ApiResponse(
        200,
        {
          reports,
          totalAmount,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
        "Bank reports retrieved successfully"
      )
    );
  }
);

// Get a single report by ID
export const getBankReport = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const report = await BankReport.findById(id)
      .populate("category", "name description")
      .populate("shop", "shopName shopNo")
      .populate("createdBy", "firstName lastName email");

    if (!report) {
      throw new ApiError(404, "Bank report not found");
    }

    res
      .status(200)
      .json(new ApiResponse(200, report, "Bank report retrieved successfully"));
  }
);

export const updateBankReport = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    const report = await BankReport.findById(id);
    if (!report) {
      throw new ApiError(404, "Bank report not found");
    }

    // Check references if being updated
    if (updateData.shop) {
      const shopExists = await Shop.findById(updateData.shop);
      if (!shopExists) {
        throw new ApiError(404, "Shop not found");
      }
    }

    if (updateData.category) {
      const categoryExists = await Category.findById(updateData.category);
      if (!categoryExists) {
        throw new ApiError(404, "Category not found");
      }
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
        throw new ApiError(500, "Failed to upload new report attachments");
      }
      newAttachments =
        uploadResults.uploadData?.map((file) => ({
          fileName: file.key.split("/").pop() || "attachment",
          fileType: file.mimetype,
          filePath: file.url,
        })) || [];
    }

    // Handle attachment deletions if specified
    if (
      updateData.deletedAttachments &&
      updateData.deletedAttachments.length > 0
    ) {
      await Promise.all(
        updateData.deletedAttachments.map(async (attachmentId: string) => {
          const attachment = report.attachments.id(attachmentId);
          if (attachment) {
            try {
              const key = getS3KeyFromUrl(attachment.filePath);
              await deleteFileFromS3(key);
              report.attachments.pull(attachmentId);
            } catch (error) {
              console.error(
                `Failed to delete file from S3: ${attachment.filePath}`,
                error
              );
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

    // Convert dates if they exist in updateData
    if (updateData.reportDate) {
      updatePayload.reportDate = new Date(updateData.reportDate);
    }

    // Validate report type specific fields if type is being changed
    if (updateData.reportType) {
      if (updateData.reportType === "adib") {
        if (!updateData.category || !updateData.shop) {
          throw new ApiError(
            400,
            "Category and shop are required for ADIB reports"
          );
        }
      } else if (updateData.reportType === "expense") {
        if (!updateData.description) {
          throw new ApiError(
            400,
            "Description is required for expense reports"
          );
        }
      }
    }

    // Update the report
    const updatedReport = await BankReport.findByIdAndUpdate(
      id,
      updatePayload,
      {
        new: true,
      }
    )
      .populate("category", "name description")
      .populate("shop", "shopName shopNo")
      .populate("createdBy", "firstName lastName email");

    if (!updatedReport) {
      throw new ApiError(500, "Failed to update bank report");
    }

    res
      .status(200)
      .json(
        new ApiResponse(200, updatedReport, "Bank report updated successfully")
      );
  }
);

// Delete a report
export const deleteBankReport = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const report = await BankReport.findById(id);
    if (!report) {
      throw new ApiError(404, "Bank report not found");
    }

    // Delete all associated files from S3
    if (report.attachments && report.attachments.length > 0) {
      await Promise.all(
        report.attachments.map(async (attachment) => {
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

    await BankReport.findByIdAndDelete(id);

    res
      .status(200)
      .json(new ApiResponse(200, null, "Bank report deleted successfully"));
  }
);

// Get financial summary
export const getBankFinancialSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { startDate, endDate, groupBy } = req.query;

    const match: any = {};
    if (startDate && endDate) {
      match.reportDate = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    let groupStage: any;
    switch (groupBy) {
      case "month":
        groupStage = {
          $group: {
            _id: {
              year: { $year: "$reportDate" },
              month: { $month: "$reportDate" },
              reportType: "$reportType",
            },
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        };
        break;
      case "reportType":
        groupStage = {
          $group: {
            _id: "$reportType",
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        };
        break;
      case "category":
        groupStage = {
          $group: {
            _id: "$category",
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        };
        break;
      case "shop":
        groupStage = {
          $group: {
            _id: "$shop",
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        };
        break;
      default:
        groupStage = {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        };
    }

    const pipeline: any[] = [{ $match: match }, groupStage];

    if (groupBy === "shop" || groupBy === "category") {
      const lookupCollection = groupBy === "shop" ? "shops" : "categories";
      const fieldName = groupBy === "shop" ? "shopDetails" : "categoryDetails";

      pipeline.push({
        $lookup: {
          from: lookupCollection,
          localField: "_id",
          foreignField: "_id",
          as: fieldName,
        },
      });
      pipeline.push({ $unwind: `$${fieldName}` });

      const projection: any = {
        _id: 1,
        totalAmount: 1,
        count: 1,
      };

      if (groupBy === "shop") {
        projection.shopName = `$${fieldName}.shopName`;
        projection.shopNo = `$${fieldName}.shopNo`;
      } else {
        projection.categoryName = `$${fieldName}.name`;
        projection.categoryDescription = `$${fieldName}.description`;
      }

      pipeline.push({ $project: projection });
    }

    pipeline.push({ $sort: { _id: 1 } });

    const summary = await BankReport.aggregate(pipeline);

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          summary,
          "Bank financial summary retrieved successfully"
        )
      );
  }
);

// Get report statistics
export const getBankReportStatistics = asyncHandler(
  async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;

    const match: any = {};
    if (startDate && endDate) {
      match.reportDate = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    const stats = await BankReport.aggregate([
      { $match: match },
      {
        $facet: {
          totalAmount: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
          byType: [
            { $group: { _id: "$reportType", total: { $sum: "$amount" } } },
          ],
          byMonth: [
            {
              $group: {
                _id: {
                  year: { $year: "$reportDate" },
                  month: { $month: "$reportDate" },
                },
                total: { $sum: "$amount" },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
          ],
          topCategories: [
            {
              $group: {
                _id: "$category",
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
            { $sort: { total: -1 } },
            { $limit: 5 },
            {
              $lookup: {
                from: "categories",
                localField: "_id",
                foreignField: "_id",
                as: "categoryDetails",
              },
            },
            { $unwind: "$categoryDetails" },
            {
              $project: {
                _id: 1,
                total: 1,
                count: 1,
                categoryName: "$categoryDetails.name",
                categoryDescription: "$categoryDetails.description",
              },
            },
          ],
          topShops: [
            {
              $group: {
                _id: "$shop",
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
            { $sort: { total: -1 } },
            { $limit: 5 },
            {
              $lookup: {
                from: "shops",
                localField: "_id",
                foreignField: "_id",
                as: "shopDetails",
              },
            },
            { $unwind: "$shopDetails" },
            {
              $project: {
                _id: 1,
                total: 1,
                count: 1,
                shopName: "$shopDetails.shopName",
                shopNo: "$shopDetails.shopNo",
              },
            },
          ],
        },
      },
    ]);

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          stats[0],
          "Bank report statistics retrieved successfully"
        )
      );
  }
);

export const exportBankReportsToExcel = asyncHandler(
  async (req: Request, res: Response) => {
    const filter: any = {};

    // Report type filter
    if (req.query.reportType) {
      filter.reportType = req.query.reportType;
    } 

    // Date range filter - Handle both date range and month/year formats
    if (req.query.startDate && req.query.endDate) {
      filter.reportDate = {
        $gte: new Date(req.query.startDate as string),
        $lte: new Date(req.query.endDate as string),
      };
    } else if (req.query.month && req.query.year) {
      // Handle month/year filtering
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      
      // Create start and end dates for the specified month
      const startDate = new Date(year, month - 1, 1); // month - 1 because Date months are 0-indexed
      const endDate = new Date(year, month, 0); // Last day of the month
      
      filter.reportDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    // Shop filter
    if (req.query.shop) {
      filter.shop = req.query.shop;
    }

    // Category filter
    if (req.query.category) {
      filter.category = req.query.category;
    }

    // Amount range filter
    if (req.query.minAmount || req.query.maxAmount) {
      filter.amount = {};
      if (req.query.minAmount) {
        filter.amount.$gte = parseFloat(req.query.minAmount as string);
      }
      if (req.query.maxAmount) {
        filter.amount.$lte = parseFloat(req.query.maxAmount as string);
      }
    }

    // Search filter
    if (req.query.search) {
      filter.$or = [
        { description: { $regex: req.query.search, $options: "i" } },
        { remarks: { $regex: req.query.search, $options: "i" } },
      ];
    }

    // Get all reports matching the filter
    const reports = await BankReport.find(filter)
      .sort({ reportDate: -1 })
      .populate<{
        category: { name: string } | null;
        shop: { shopName: string; shopNo: string } | null;
        createdBy: { firstName: string; lastName: string } | null;
      }>([
        { path: "category", select: "name" },
        { path: "shop", select: "shopName shopNo" },
        { path: "createdBy", select: "firstName lastName" },
      ]);

    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Bank Reports");

    // Define columns for each report type
    const reportTypeColumns: Record<BankReportType, any[]> = {
      adib: [
        { header: "SNO", key: "sno", width: 5 },
        { header: "DATE", key: "reportDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
        { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
        { header: "CATEGORY", key: "category", width: 20 },
        { header: "SHOP NAME", key: "shopName", width: 25 },
        { header: "REMARKS", key: "remarks", width: 30 }
      ],
      expense: [
        { header: "SNO", key: "sno", width: 5 },
        { header: "DATE", key: "reportDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
        { header: "DESCRIPTION", key: "description", width: 30 },
        { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
        { header: "REMARKS", key: "remarks", width: 30 }
      ]
    };

    // Determine which columns to use based on report type filter
    let columns: any[] = [];
    if (req.query.reportType && typeof req.query.reportType === "string") {
      const reportType = req.query.reportType as BankReportType;
      columns = reportTypeColumns[reportType];
    } else {
      // If no report type specified, use all possible columns (with unique keys)
      const allColumns = Object.values(reportTypeColumns).flat();
      const uniqueColumns = allColumns.filter(
        (col, index, self) => index === self.findIndex((c) => c.key === col.key)
      );
      columns = uniqueColumns;
    }

    // Set the worksheet columns
    worksheet.columns = columns;

    // Add data rows
    reports.forEach((report, index) => {
      const rowData: any = {
        sno: index + 1,
        reportDate: report.reportDate,
        amount: report.amount,
        remarks: report.remarks || ""
      };

      // Type-specific fields
      if (report.reportType === "adib") {
        rowData.category = report.category && typeof report.category === "object"
          ? report.category.name
          : "";
        rowData.shopName = report.shop && typeof report.shop === "object"
          ? report.shop.shopName
          : "";
      } else if (report.reportType === "expense") {
        rowData.description = report.description || "";
      }

      worksheet.addRow(rowData);
    });

    // Style the header row
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

    // Set response headers for Excel file download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=bank_reports_export_${
        new Date().toISOString().split("T")[0]
      }.xlsx`
    );

    // Write the workbook to the response
    await workbook.xlsx.write(res);
    res.end();
  }
);