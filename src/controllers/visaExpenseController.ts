import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { VisaExpense } from "../models/visaExpenseModel";
import { User } from "../models/userModel";
import ExcelJS from "exceljs";
import { Types } from "mongoose";

export const createVisaExpense = asyncHandler(async (req: Request, res: Response) => {
  const {
    employee,
    iBan,
    passportNumber,
    passportExpireDate,
    emirateIdNumber,
    emirateIdExpireDate,
    labourCardPersonalNumber,
    workPermitNumber,
    labourExpireDate,
    offerLetterTyping = 0,
    labourInsurance = 0,
    labourCardPayment = 0,
    statusChangeInOut = 0,
    insideEntry = 0,
    medicalSharjah = 0,
    tajweehSubmission = 0,
    iloeInsurance = 0,
    healthInsurance = 0,
    emirateId = 0,
    residenceStamping = 0,
    srilankaCouncilHead = 0,
    upscoding = 0,
    labourFinePayment = 0,
    labourCardRenewalPayment = 0,
    servicePayment = 0,
    visaStamping = 0,
    twoMonthVisitingVisa = 0,
    finePayment = 0,
    entryPermitOutside = 0,
    complaintEmployee = 0,
    arabicLetter = 0,
    violationCommittee = 0,
    quotaModification = 0,
    others = 0,
  } = req.body;

  // Validate required fields
  if (!employee) {
    throw new ApiError(400, "Employee is a required field");
  }

  // Check if employee exists
  const employeeExists = await User.findById(employee);
  if (!employeeExists) {
    throw new ApiError(404, "Employee not found");
  }

  // Calculate total safely by converting to numbers first
  const total = Number(offerLetterTyping) +
    Number(labourInsurance) +
    Number(labourCardPayment) +
    Number(statusChangeInOut) +
    Number(insideEntry) +
    Number(medicalSharjah) +
    Number(tajweehSubmission) +
    Number(iloeInsurance) +
    Number(healthInsurance) +
    Number(emirateId) +
    Number(residenceStamping) +
    Number(srilankaCouncilHead) +
    Number(upscoding) +
    Number(labourFinePayment) +
    Number(labourCardRenewalPayment) +
    Number(servicePayment) +
    Number(visaStamping) +
    Number(twoMonthVisitingVisa) +
    Number(finePayment) +
    Number(entryPermitOutside) +
    Number(complaintEmployee) +
    Number(arabicLetter) +
    Number(violationCommittee) +
    Number(quotaModification) +
    Number(others);

  // Create visa expense
  const visaExpense = await VisaExpense.create({
    employee,
    iBan,
    passportNumber,
    passportExpireDate: passportExpireDate ? new Date(passportExpireDate) : undefined,
    emirateIdNumber,
    emirateIdExpireDate: emirateIdExpireDate ? new Date(emirateIdExpireDate) : undefined,
    labourCardPersonalNumber,
    workPermitNumber,
    labourExpireDate: labourExpireDate ? new Date(labourExpireDate) : undefined,
    offerLetterTyping: Number(offerLetterTyping),
    labourInsurance: Number(labourInsurance),
    labourCardPayment: Number(labourCardPayment),
    statusChangeInOut: Number(statusChangeInOut),
    insideEntry: Number(insideEntry),
    medicalSharjah: Number(medicalSharjah),
    tajweehSubmission: Number(tajweehSubmission),
    iloeInsurance: Number(iloeInsurance),
    healthInsurance: Number(healthInsurance),
    emirateId: Number(emirateId),
    residenceStamping: Number(residenceStamping),
    srilankaCouncilHead: Number(srilankaCouncilHead),
    upscoding: Number(upscoding),
    labourFinePayment: Number(labourFinePayment),
    labourCardRenewalPayment: Number(labourCardRenewalPayment),
    servicePayment: Number(servicePayment),
    visaStamping: Number(visaStamping),
    twoMonthVisitingVisa: Number(twoMonthVisitingVisa),
    finePayment: Number(finePayment),
    entryPermitOutside: Number(entryPermitOutside),
    complaintEmployee: Number(complaintEmployee),
    arabicLetter: Number(arabicLetter),
    violationCommittee: Number(violationCommittee),
    quotaModification: Number(quotaModification),
    others: Number(others),
    total: Number(total.toFixed(2)), // Ensure we store as a proper number with 2 decimal places
    createdBy: req.user?.userId,
  });

  res.status(201).json(new ApiResponse(201, visaExpense, "Visa expense created successfully"));
});

// Interface for query parameters
interface VisaExpenseQuery {
  page?: string;
  limit?: string;
  employee?: string;
  startDate?: string;
  endDate?: string;
  month?: string;
  year?: string;
  search?: string;
  minTotal?: string;
  maxTotal?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const getVisaExpenses = asyncHandler(async (req: Request<{}, {}, {}, VisaExpenseQuery>, res: Response) => {
  // Input validation and sanitization
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
  const skip = (page - 1) * limit;

  // Sorting options
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sortOptions: Record<string, 1 | -1> = { [sortBy]: sortOrder };

  const filter: any = {};

  try {
    // Employee filter (exclude when search is being used)
    if (req.query.employee && !req.query.search) {
      if (!Types.ObjectId.isValid(req.query.employee)) {
        throw new ApiError(400, "Invalid employee ID format");
      }
      filter.employee = new Types.ObjectId(req.query.employee);
    }

    // Search functionality - similar to payroll controller
    if (req.query.search && req.query.search.trim()) {
      const searchTerm = req.query.search.trim();
      const searchRegex = new RegExp(searchTerm, 'i');

      // Search for employees by name first
      const users = await User.find({
        $or: [
          { firstName: { $regex: searchRegex } },
          { lastName: { $regex: searchRegex } }
        ]
      }).select('_id');

      const userIds = users.map(user => user._id);

      // Search across multiple fields including employee names
      filter.$or = [
        { employee: { $in: userIds } },
        { passportNumber: { $regex: searchRegex } },
        { emirateIdNumber: { $regex: searchRegex } },
        { labourCardPersonalNumber: { $regex: searchRegex } },
        { workPermitNumber: { $regex: searchRegex } },
        { iBan: { $regex: searchRegex } },
      ];

      // If search term is a number, also search in total field
      if (!isNaN(Number(searchTerm))) {
        filter.$or.push({ total: Number(searchTerm) });
      }

      // If no users found and no other matches, return empty results
      if (userIds.length === 0) {
        const otherFieldsMatch = await VisaExpense.findOne({
          $or: filter.$or.slice(1) // Exclude employee search
        });

        if (!otherFieldsMatch) {
          return res.status(200).json(
            new ApiResponse(
              200,
              {
                visaExpenses: [],
                pagination: {
                  total: 0,
                  page,
                  limit,
                  totalPages: 0,
                  hasNextPage: false,
                  hasPreviousPage: false,
                  pageTotal: 0,
                },
                summary: {
                  totalAmount: 0,
                  averageAmount: 0,
                  maxAmount: 0,
                  minAmount: 0,
                  totalRecords: 0
                },
                filters: {
                  employee: req.query.employee,
                  startDate: req.query.startDate,
                  endDate: req.query.endDate,
                  month: req.query.month,
                  year: req.query.year,
                  search: req.query.search,
                  minTotal: req.query.minTotal,
                  maxTotal: req.query.maxTotal,
                  sortBy,
                  sortOrder: req.query.sortOrder
                }
              },
              "No visa expenses found matching the search criteria"
            )
          );
        }
      }
    }

    // Date range filter (takes priority over month/year filter)
    if (req.query.startDate && req.query.endDate) {
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new ApiError(400, "Invalid date format. Use YYYY-MM-DD format");
      }

      if (startDate > endDate) {
        throw new ApiError(400, "Start date cannot be later than end date");
      }

      // Set time to start and end of day
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      filter.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }
    // Month/Year filter (only if date range is not provided)
    else if (req.query.month && req.query.year) {
      const year = parseInt(req.query.year);
      const month = parseInt(req.query.month);

      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        throw new ApiError(400, "Invalid month or year. Month should be 1-12");
      }

      // Create date range for the specific month
      const startOfMonth = new Date(year, month - 1, 1); // MongoDB months are 0-indexed
      const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month

      filter.createdAt = {
        $gte: startOfMonth,
        $lte: endOfMonth,
      };
    }
    // Year only filter
    else if (req.query.year) {
      const year = parseInt(req.query.year);
      if (isNaN(year)) {
        throw new ApiError(400, "Invalid year format");
      }

      filter.createdAt = {
        $gte: new Date(year, 0, 1), // Start of year
        $lte: new Date(year, 11, 31, 23, 59, 59, 999), // End of year
      };
    }

    // Total amount range filter
    if (req.query.minTotal || req.query.maxTotal) {
      filter.total = {};

      if (req.query.minTotal) {
        const minTotal = parseFloat(req.query.minTotal);
        if (isNaN(minTotal) || minTotal < 0) {
          throw new ApiError(400, "Invalid minimum total amount");
        }
        filter.total.$gte = minTotal;
      }

      if (req.query.maxTotal) {
        const maxTotal = parseFloat(req.query.maxTotal);
        if (isNaN(maxTotal) || maxTotal < 0) {
          throw new ApiError(400, "Invalid maximum total amount");
        }
        filter.total.$lte = maxTotal;
      }

      // Validate range
      if (req.query.minTotal && req.query.maxTotal) {
        const minTotal = parseFloat(req.query.minTotal);
        const maxTotal = parseFloat(req.query.maxTotal);
        if (minTotal > maxTotal) {
          throw new ApiError(400, "Minimum total cannot be greater than maximum total");
        }
      }
    }

    // Get total count for pagination
    const total = await VisaExpense.countDocuments(filter);

    // Fetch visa expenses with populated data
    const visaExpenses = await VisaExpense.find(filter)
      .skip(skip)
      .limit(limit)
      .sort(sortOptions)
      .populate("employee", "firstName lastName email phoneNumbers role department")
      .populate("createdBy", "firstName lastName email")
      .lean(); // Use lean() for better performance

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Calculate aggregated data for the current page
    const pageTotal = visaExpenses.reduce((sum, expense) => sum + expense.total, 0);

    // Calculate overall totals based on current filter
    const aggregatedData = await VisaExpense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$total' },
          averageAmount: { $avg: '$total' },
          maxAmount: { $max: '$total' },
          minAmount: { $min: '$total' },
          count: { $sum: 1 }
        }
      }
    ]);

    const summary = aggregatedData.length > 0 ? aggregatedData[0] : {
      totalAmount: 0,
      averageAmount: 0,
      maxAmount: 0,
      minAmount: 0,
      count: 0
    };

    // Response data
    const responseData = {
      visaExpenses,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPreviousPage,
        pageTotal, // Total amount for current page
      },
      summary: {
        totalAmount: summary.totalAmount,
        averageAmount: Math.round(summary.averageAmount * 100) / 100, // Round to 2 decimal places
        maxAmount: summary.maxAmount,
        minAmount: summary.minAmount,
        totalRecords: summary.count
      },
      filters: {
        employee: req.query.employee,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        month: req.query.month,
        year: req.query.year,
        search: req.query.search,
        minTotal: req.query.minTotal,
        maxTotal: req.query.maxTotal,
        sortBy,
        sortOrder: req.query.sortOrder
      }
    };

    res.status(200).json(
      new ApiResponse(
        200,
        responseData,
        `${total} visa expense${total === 1 ? '' : 's'} retrieved successfully`
      )
    );

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    // Handle MongoDB errors
    if (error instanceof Error) {
      if (error.message.includes('Cast to ObjectId failed')) {
        throw new ApiError(400, "Invalid ID format provided");
      }
      throw new ApiError(500, `Database error: ${error.message}`);
    }

    throw new ApiError(500, "An unexpected error occurred while fetching visa expenses");
  }
});
// Additional helper function to get visa expense statistics
export const getVisaExpenseStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const stats = await VisaExpense.aggregate([
      {
        $group: {
          _id: null,
          totalExpenses: { $sum: '$total' },
          averageExpense: { $avg: '$total' },
          maxExpense: { $max: '$total' },
          minExpense: { $min: '$total' },
          totalRecords: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          totalExpenses: 1,
          averageExpense: { $round: ['$averageExpense', 2] },
          maxExpense: 1,
          minExpense: 1,
          totalRecords: 1
        }
      }
    ]);

    // Monthly breakdown for the current year
    const currentYear = new Date().getFullYear();
    const monthlyStats = await VisaExpense.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(currentYear, 0, 1),
            $lte: new Date(currentYear, 11, 31, 23, 59, 59, 999)
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          totalAmount: { $sum: '$total' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    const responseData = {
      overall: stats[0] || {
        totalExpenses: 0,
        averageExpense: 0,
        maxExpense: 0,
        minExpense: 0,
        totalRecords: 0
      },
      monthlyBreakdown: monthlyStats,
      year: currentYear
    };

    res.status(200).json(
      new ApiResponse(200, responseData, "Visa expense statistics retrieved successfully")
    );

  } catch (error) {
    throw new ApiError(500, "Error retrieving visa expense statistics");
  }
});

export const getVisaExpense = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const visaExpense = await VisaExpense.findById(id)
    .populate("employee", "firstName lastName email phoneNumbers role")
    .populate("createdBy", "firstName lastName");

  if (!visaExpense) {
    throw new ApiError(404, "Visa expense not found");
  }

  res.status(200).json(new ApiResponse(200, visaExpense, "Visa expense retrieved successfully"));
});

export const updateVisaExpense = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if employee exists if being updated
  if (updateData.employee) {
    const employeeExists = await User.findById(updateData.employee);
    if (!employeeExists) {
      throw new ApiError(404, "Employee not found");
    }
  }

  // Convert date fields if they exist in updateData
  if (updateData.passportExpireDate) {
    updateData.passportExpireDate = new Date(updateData.passportExpireDate);
  }
  if (updateData.emirateIdExpireDate) {
    updateData.emirateIdExpireDate = new Date(updateData.emirateIdExpireDate);
  }
  if (updateData.labourExpireDate) {
    updateData.labourExpireDate = new Date(updateData.labourExpireDate);
  }

  // If any expense fields are being updated, recalculate the total
  const expenseFields = [
    'offerLetterTyping', 'labourInsurance', 'labourCardPayment', 'statusChangeInOut',
    'insideEntry', 'medicalSharjah', 'tajweehSubmission', 'iloeInsurance',
    'healthInsurance', 'emirateId', 'residenceStamping', 'srilankaCouncilHead',
    'upscoding', 'labourFinePayment', 'labourCardRenewalPayment', 'servicePayment',
    'visaStamping', 'twoMonthVisitingVisa', 'finePayment', 'entryPermitOutside',
    'complaintEmployee', 'arabicLetter', 'violationCommittee', 'quotaModification',
    'others'
  ];

  const shouldRecalculateTotal = expenseFields.some(field => field in updateData);

  if (shouldRecalculateTotal) {
    // Get the current document
    const currentExpense: any = await VisaExpense.findById(id);
    if (!currentExpense) {
      throw new ApiError(404, "Visa expense not found");
    }


    // Calculate new total based on updated values or existing values
    const total = expenseFields.reduce((sum, field) => {
      const value = field in updateData ? Number(updateData[field]) : Number(currentExpense[field]);
      return sum + (isNaN(value) ? 0 : value);
    }, 0);

    updateData.total = Number(total.toFixed(2));
  }

  const updatedVisaExpense = await VisaExpense.findByIdAndUpdate(id, updateData, {
    new: true,
  })
    .populate("employee", "firstName lastName email phoneNumbers role")
    .populate("createdBy", "firstName lastName");

  if (!updatedVisaExpense) {
    throw new ApiError(404, "Visa expense not found or update failed");
  }

  res.status(200).json(new ApiResponse(200, updatedVisaExpense, "Visa expense updated successfully"));
});
export const deleteVisaExpense = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const visaExpense = await VisaExpense.findByIdAndDelete(id);

  if (!visaExpense) {
    throw new ApiError(404, "Visa expense not found");
  }

  res.status(200).json(new ApiResponse(200, null, "Visa expense deleted successfully"));
});
interface ExportQuery {
  employee?: string;
  startDate?: string;
  endDate?: string;
  month?: string;
  year?: string;
  search?: string;
  minTotal?: string;
  maxTotal?: string;
  format?: 'xlsx' | 'csv';
  includeStats?: 'true' | 'false';
}


export const exportVisaExpensesToExcel = asyncHandler(async (req: Request<{}, {}, {}, ExportQuery>, res: Response) => {
  try {
    const filter: any = {};
    const format = req.query.format || 'xlsx';
    const includeStats = req.query.includeStats === 'true';

    // [Previous filter logic remains the same...]

    // Get all visa expenses with employee details
    const visaExpenses = await VisaExpense.find(filter)
      .sort({ createdAt: -1 })
      .populate<{
        employee: {
          firstName: string;
          lastName: string;
          phoneNumbers: string[];
          role: string;
          department?: string;
          country?: string;
          bankNumber?: string;
        };
      }>("employee", "firstName lastName phoneNumbers role department country bankNumber")
      .populate("createdBy", "firstName lastName")
      .lean();

    if (visaExpenses.length === 0) {
      throw new ApiError(404, "No visa expenses found matching the criteria");
    }

    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Visa Expenses");

    // Define columns with improved headers and formatting
    const columns = [
      { header: "S.NO", key: "serialNumber", width: 8 },
      { header: "EMPLOYEE NAME", key: "name", width: 25 },
      { header: "COUNTRY", key: "country", width: 15 },
      { header: "DESIGNATION", key: "designation", width: 20 },
      { header: "PHONE NUMBER", key: "phoneNumber", width: 18 },
      { header: "IBAN", key: "iBan", width: 25 },
      { header: "PASSPORT NUMBER", key: "passportNumber", width: 20 },
      { header: "PASSPORT EXPIRE DATE", key: "passportExpireDate", width: 20 },
      { header: "EMIRATES ID NUMBER", key: "emirateIdNumber", width: 20 },
      { header: "EMIRATES ID EXPIRE DATE", key: "emirateIdExpireDate", width: 22 },
      { header: "LABOUR CARD PERSONAL NO", key: "labourCardPersonalNumber", width: 25 },
      { header: "WORK PERMIT NUMBER", key: "workPermitNumber", width: 20 },
      { header: "LABOUR EXPIRE DATE", key: "labourExpireDate", width: 20 },
      { header: "OFFER LETTER TYPING", key: "offerLetterTyping", width: 18 },
      { header: "LABOUR INSURANCE", key: "labourInsurance", width: 18 },
      { header: "LABOUR CARD PAYMENT", key: "labourCardPayment", width: 20 },
      { header: "STATUS CHANGE IN/OUT", key: "statusChangeInOut", width: 20 },
      { header: "INSIDE ENTRY", key: "insideEntry", width: 15 },
      { header: "MEDICAL SHARJAH", key: "medicalSharjah", width: 18 },
      { header: "TAJWEEH SUBMISSION", key: "tajweehSubmission", width: 18 },
      { header: "ILOE INSURANCE", key: "iloeInsurance", width: 18 },
      { header: "HEALTH INSURANCE", key: "healthInsurance", width: 18 },
      { header: "EMIRATES ID", key: "emirateId", width: 15 },
      { header: "RESIDENCE STAMPING", key: "residenceStamping", width: 20 },
      { header: "SRI LANKA COUNCIL HEAD", key: "srilankaCouncilHead", width: 22 },
      { header: "UPSCODING", key: "upscoding", width: 15 },
      { header: "LABOUR FINE PAYMENT", key: "labourFinePayment", width: 20 },
      { header: "LABOUR CARD RENEWAL", key: "labourCardRenewalPayment", width: 25 },
      { header: "SERVICE PAYMENT", key: "servicePayment", width: 18 },
      { header: "VISA STAMPING", key: "visaStamping", width: 18 },
      { header: "2 MONTH VISITING VISA", key: "twoMonthVisitingVisa", width: 22 },
      { header: "FINE PAYMENT", key: "finePayment", width: 15 },
      { header: "ENTRY PERMIT OUTSIDE", key: "entryPermitOutside", width: 20 },
      { header: "COMPLAINT EMPLOYEE", key: "complaintEmployee", width: 20 },
      { header: "ARABIC LETTER", key: "arabicLetter", width: 15 },
      { header: "VIOLATION COMMITTEE", key: "violationCommittee", width: 20 },
      { header: "QUOTA MODIFICATION", key: "quotaModification", width: 20 },
      { header: "OTHERS", key: "others", width: 15 },
      { header: "TOTAL AMOUNT", key: "total", width: 18 },
      { header: "CREATED BY", key: "createdBy", width: 20 },
    ];

    // Define constants
    const TOTAL_COLUMNS = columns.length; // 40 columns (A to AN)
    const LAST_COLUMN_LETTER = 'AN'; // Column 40 is AN

    // Add title with blue background (matching payroll Excel) - Row 1
    let titleText = "VISA EXPENSES REPORT";

    // Generate title based on filters
    if (req.query.month && req.query.year) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const displayMonth = monthNames[parseInt(req.query.month) - 1];
      titleText = `VISA EXPENSES - ${displayMonth.toUpperCase()} ${req.query.year}`;
    } else if (req.query.year) {
      titleText = `VISA EXPENSES - ${req.query.year}`;
    }

    // Add title row - Row 1
    worksheet.mergeCells(`A1:${LAST_COLUMN_LETTER}1`);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = titleText;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2c5aa0' } // Same blue as payroll Excel
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 30;

    // Add empty row for spacing
    worksheet.addRow([]);

    // DON'T use worksheet.columns - it causes styling issues
    // Instead, manually add header row

    // Get the header row (row 3 after title and empty row)
    const headerRow = worksheet.getRow(3);

    // Set column widths manually
    columns.forEach((col, index) => {
      worksheet.getColumn(index + 1).width = col.width;
    });

    // Manually add header values and apply styling
    for (let i = 0; i < TOTAL_COLUMNS; i++) {
      const cell = headerRow.getCell(i + 1);

      // Set the header value
      cell.value = columns[i].header;

      // Set the font with white color
      cell.font = {
        bold: true,
        size: 12,
        color: { argb: 'FFFFFFFF' },
        name: 'Calibri'
      };

      // Set the blue fill
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: 'FF2c5aa0' }
      };

      // Set borders
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };

      // Set alignment with text wrapping
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true
      };
    }

    // Set row height for header
    headerRow.height = 40;

    // Commit the row
    headerRow.commit();

    // Initialize totals array with zeros
    const columnTotals = new Array(TOTAL_COLUMNS).fill(0);
    let totalAmount = 0;

    // Add data rows starting from row 4
    visaExpenses.forEach((expense, index) => {
      const employee = expense.employee as any;
      const createdBy = expense.createdBy as any;

      // Create array of values in the same order as columns
      const rowValues = [
        index + 1, // serialNumber
        `${employee.firstName} ${employee.lastName}`, // name
        employee.country || "N/A", // country
        employee.role || "N/A", // designation
        employee.phoneNumbers?.join(", ") || "N/A", // phoneNumber
        expense.iBan || "N/A", // iBan
        expense.passportNumber || "N/A", // passportNumber
        expense.passportExpireDate || null, // passportExpireDate
        expense.emirateIdNumber || "N/A", // emirateIdNumber
        expense.emirateIdExpireDate || null, // emirateIdExpireDate
        expense.labourCardPersonalNumber || "N/A", // labourCardPersonalNumber
        expense.workPermitNumber || "N/A", // workPermitNumber
        expense.labourExpireDate || null, // labourExpireDate
        expense.offerLetterTyping || 0, // offerLetterTyping
        expense.labourInsurance || 0, // labourInsurance
        expense.labourCardPayment || 0, // labourCardPayment
        expense.statusChangeInOut || 0, // statusChangeInOut
        expense.insideEntry || 0, // insideEntry
        expense.medicalSharjah || 0, // medicalSharjah
        expense.tajweehSubmission || 0, // tajweehSubmission
        expense.iloeInsurance || 0, // iloeInsurance
        expense.healthInsurance || 0, // healthInsurance
        expense.emirateId || 0, // emirateId
        expense.residenceStamping || 0, // residenceStamping
        expense.srilankaCouncilHead || 0, // srilankaCouncilHead
        expense.upscoding || 0, // upscoding
        expense.labourFinePayment || 0, // labourFinePayment
        expense.labourCardRenewalPayment || 0, // labourCardRenewalPayment
        expense.servicePayment || 0, // servicePayment
        expense.visaStamping || 0, // visaStamping
        expense.twoMonthVisitingVisa || 0, // twoMonthVisitingVisa
        expense.finePayment || 0, // finePayment
        expense.entryPermitOutside || 0, // entryPermitOutside
        expense.complaintEmployee || 0, // complaintEmployee
        expense.arabicLetter || 0, // arabicLetter
        expense.violationCommittee || 0, // violationCommittee
        expense.quotaModification || 0, // quotaModification
        expense.others || 0, // others
        expense.total || 0, // total
        createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : "N/A", // createdBy
      ];

      totalAmount += expense.total || 0;

      // Add totals for numeric columns
      rowValues.forEach((value, colIndex) => {
        if (typeof value === 'number') {
          columnTotals[colIndex] += value;
        }
      });

      // Add the row data as an array
      const row = worksheet.addRow(rowValues);
      row.height = 20;

      // Apply styling to cells A-AN only
      for (let i = 1; i <= TOTAL_COLUMNS; i++) {
        const cell = row.getCell(i);

        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
        };

        // Apply alternating row colors
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2' }
        };

        // Align center for serial number
        if (i === 1) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        // Apply formatting for date columns (columns 8, 10, 13)
        if ([8, 10, 13].includes(i) && cell.value instanceof Date) {
          cell.numFmt = 'dd/mm/yyyy';
        } else if ([8, 10, 13].includes(i) && cell.value) {
          // If it's a string date, convert it
          try {
            const dateValue = new Date(cell.value as string);
            if (!isNaN(dateValue.getTime())) {
              cell.value = dateValue;
              cell.numFmt = 'dd/mm/yyyy';
            }
          } catch (error) {
            // Keep as is if not a valid date
          }
        }

        // Apply formatting for currency columns (columns 14-39)
        if (i >= 14 && i <= 39 && typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        }

        // Format total column specifically (column 40)
        if (i === 40 && typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00';
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        }
      }
    });

    // Add totals row (yellow background like payroll Excel)
    const totalsRowNumber = worksheet.rowCount + 1;

    // Create totals row data - fill empty strings for all columns first
    const totalsRowData = new Array(TOTAL_COLUMNS).fill('');

    // Set specific values
    totalsRowData[0] = ''; // Column A: Empty
    totalsRowData[1] = 'TOTALS'; // Column B: TOTALS label

    // Set totals for numeric columns (14-40)
    for (let i = 13; i < TOTAL_COLUMNS; i++) {
      if (i >= 13 && i <= 39) { // Columns N-AN (14-40)
        totalsRowData[i] = columnTotals[i];
      }
    }

    const totalsRow = worksheet.addRow(totalsRowData);
    totalsRow.height = 25;
    totalsRow.font = { bold: true, size: 11 };

    // Apply yellow background only to relevant cells
    for (let i = 1; i <= TOTAL_COLUMNS; i++) {
      const cell = totalsRow.getCell(i);

      // Apply yellow background only to cells with data
      if (i === 1 || i === 2 || (i >= 14 && i <= 40)) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFEB3B' } // Yellow like payroll Excel
        };
      } else {
        // White background for empty cells
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };
      }

      // Format numeric columns
      if (i >= 14 && i <= 40 && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (i === 2) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }

      cell.border = {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    }

    // Add empty row before signature
    worksheet.addRow([]);

    // Add signature section (matching payroll Excel)
    const signatureStartRow = worksheet.rowCount + 1;

    // Row 1: Prepared By: Meena S
    const preparedRow = signatureStartRow;
    worksheet.mergeCells(`A${preparedRow}:B${preparedRow}`);
    worksheet.mergeCells(`C${preparedRow}:D${preparedRow}`);

    const preparedKeyCell = worksheet.getCell(`A${preparedRow}`);
    preparedKeyCell.value = 'Prepared By:';
    preparedKeyCell.font = { bold: true, size: 11 };
    preparedKeyCell.alignment = { vertical: 'middle', horizontal: 'right' };
    preparedKeyCell.border = {
      top: { style: 'medium' },
      left: { style: 'medium' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };

    const preparedValueCell = worksheet.getCell(`C${preparedRow}`);
    preparedValueCell.value = 'Meena S';
    preparedValueCell.font = { size: 11, color: { argb: 'FF2c5aa0' } };
    preparedValueCell.alignment = { vertical: 'middle', horizontal: 'left' };
    preparedValueCell.border = {
      top: { style: 'medium' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'medium' }
    };

    // Row 2: Verified By: Syed Ibrahim
    const verifiedRow = signatureStartRow + 1;
    worksheet.mergeCells(`A${verifiedRow}:B${verifiedRow}`);
    worksheet.mergeCells(`C${verifiedRow}:D${verifiedRow}`);

    const verifiedKeyCell = worksheet.getCell(`A${verifiedRow}`);
    verifiedKeyCell.value = 'Verified By:';
    verifiedKeyCell.font = { bold: true, size: 11 };
    verifiedKeyCell.alignment = { vertical: 'middle', horizontal: 'right' };
    verifiedKeyCell.border = {
      top: { style: 'thin' },
      left: { style: 'medium' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };

    const verifiedValueCell = worksheet.getCell(`C${verifiedRow}`);
    verifiedValueCell.value = 'Syed Ibrahim';
    verifiedValueCell.font = { size: 11, color: { argb: 'FF2c5aa0' } };
    verifiedValueCell.alignment = { vertical: 'middle', horizontal: 'left' };
    verifiedValueCell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'medium' }
    };

    // Row 3: Approved By: Layla Juma Ibrahim Obaid Alsuwaidi
    const approvedRow = signatureStartRow + 2;
    worksheet.mergeCells(`A${approvedRow}:B${approvedRow}`);
    worksheet.mergeCells(`C${approvedRow}:D${approvedRow}`);

    const approvedKeyCell = worksheet.getCell(`A${approvedRow}`);
    approvedKeyCell.value = 'Approved By:';
    approvedKeyCell.font = { bold: true, size: 11 };
    approvedKeyCell.alignment = { vertical: 'middle', horizontal: 'right' };
    approvedKeyCell.border = {
      top: { style: 'thin' },
      left: { style: 'medium' },
      bottom: { style: 'medium' },
      right: { style: 'thin' }
    };

    const approvedValueCell = worksheet.getCell(`C${approvedRow}`);
    approvedValueCell.value = 'Layla Juma Ibrahim Obaid Alsuwaidi';
    approvedValueCell.font = { size: 11, color: { argb: 'FF2c5aa0' } };
    approvedValueCell.alignment = { vertical: 'middle', horizontal: 'left' };
    approvedValueCell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'medium' },
      right: { style: 'medium' }
    };

    // Set row heights for signature section
    worksheet.getRow(preparedRow).height = 25;
    worksheet.getRow(verifiedRow).height = 25;
    worksheet.getRow(approvedRow).height = 25;

    // Add empty row
    worksheet.addRow([]);

    // Add footer text (matching payroll Excel)
    const footerRow = worksheet.addRow({});
    worksheet.mergeCells(`A${footerRow.number}:${LAST_COLUMN_LETTER}${footerRow.number}`);
    const footerCell = worksheet.getCell(`A${footerRow.number}`);
    footerCell.value = 'This report is generated using AGATS software';
    footerCell.font = { italic: true, size: 10, color: { argb: 'FF808080' } };
    footerCell.alignment = { vertical: 'middle', horizontal: 'center' };
    footerRow.height = 20;

    // Generate filename
    const dateStr = new Date().toISOString().split("T")[0];
    let filename = `visa_expenses_report`;

    if (req.query.month && req.query.year) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const displayMonth = monthNames[parseInt(req.query.month) - 1];
      filename += `_${displayMonth}_${req.query.year}`;
    } else if (req.query.year) {
      filename += `_${req.query.year}`;
    } else {
      filename += `_${dateStr}`;
    }

    filename += `.${format}`;

    // Set response headers based on format
    if (format === 'csv') {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      // Write as CSV
      await workbook.csv.write(res);
    } else {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      // Write as Excel
      await workbook.xlsx.write(res);
    }

    res.end();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error) {
      if (error.message.includes('Cast to ObjectId failed')) {
        throw new ApiError(400, "Invalid ID format provided");
      }
      throw new ApiError(500, `Export error: ${error.message}`);
    }
    throw new ApiError(500, "An unexpected error occurred during export");
  }
});