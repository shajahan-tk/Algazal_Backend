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

    // Employee filter
    if (req.query.employee) {
      if (!Types.ObjectId.isValid(req.query.employee)) {
        throw new ApiError(400, "Invalid employee ID format");
      }
      filter.employee = new Types.ObjectId(req.query.employee);
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
    // Month/Year filter
    else if (req.query.month && req.query.year) {
      const year = parseInt(req.query.year);
      const month = parseInt(req.query.month);

      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        throw new ApiError(400, "Invalid month or year. Month should be 1-12");
      }

      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

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
        $gte: new Date(year, 0, 1),
        $lte: new Date(year, 11, 31, 23, 59, 59, 999),
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
    }

    // Search functionality
    if (req.query.search && req.query.search.trim()) {
      const searchTerm = req.query.search.trim();

      filter.$or = [
        { passportNumber: { $regex: searchTerm, $options: 'i' } },
        { emirateIdNumber: { $regex: searchTerm, $options: 'i' } },
        { labourCardPersonalNumber: { $regex: searchTerm, $options: 'i' } },
        { workPermitNumber: { $regex: searchTerm, $options: 'i' } },
        { iBan: { $regex: searchTerm, $options: 'i' } },
      ];

      if (!isNaN(Number(searchTerm))) {
        filter.$or.push({ total: Number(searchTerm) });
      }
    }

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
      { header: "S.No", key: "serialNumber", width: 8 },
      { header: "Employee Name", key: "name", width: 25 },
      { header: "Country", key: "country", width: 15 },
      { header: "Department", key: "department", width: 20 },
      { header: "Designation", key: "designation", width: 20 },
      { header: "Phone Number", key: "phoneNumber", width: 18 },
      { header: "Bank Number", key: "bankNumber", width: 20 },
      { header: "IBAN", key: "iBan", width: 25 },
      { header: "Passport Number", key: "passportNumber", width: 20 },
      { header: "Passport Expire Date", key: "passportExpireDate", width: 18, style: { numFmt: "dd/mm/yyyy" } },
      { header: "Emirates ID Number", key: "emirateIdNumber", width: 20 },
      { header: "Emirates ID Expire Date", key: "emirateIdExpireDate", width: 20, style: { numFmt: "dd/mm/yyyy" } },
      { header: "Labour Card Personal Number", key: "labourCardPersonalNumber", width: 25 },
      { header: "Work Permit Number", key: "workPermitNumber", width: 20 },
      { header: "Labour Expire Date", key: "labourExpireDate", width: 18, style: { numFmt: "dd/mm/yyyy" } },
      { header: "Offer Letter Typing", key: "offerLetterTyping", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "Labour Insurance", key: "labourInsurance", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "Labour Card Payment", key: "labourCardPayment", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Status Change In/Out", key: "statusChangeInOut", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Inside Entry", key: "insideEntry", width: 15, style: { numFmt: "#,##0.00" } },
      { header: "Medical Sharjah", key: "medicalSharjah", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "Tajweeh Submission", key: "tajweehSubmission", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "ILOE Insurance", key: "iloeInsurance", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "Health Insurance", key: "healthInsurance", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "Emirates ID", key: "emirateId", width: 15, style: { numFmt: "#,##0.00" } },
      { header: "Residence Stamping", key: "residenceStamping", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Sri Lanka Council Head", key: "srilankaCouncilHead", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Upscoding", key: "upscoding", width: 15, style: { numFmt: "#,##0.00" } },
      { header: "Labour Fine Payment", key: "labourFinePayment", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Labour Card Renewal Payment", key: "labourCardRenewalPayment", width: 25, style: { numFmt: "#,##0.00" } },
      { header: "Service Payment", key: "servicePayment", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "Visa Stamping", key: "visaStamping", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "2 Month Visiting Visa", key: "twoMonthVisitingVisa", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Fine Payment", key: "finePayment", width: 15, style: { numFmt: "#,##0.00" } },
      { header: "Entry Permit Outside", key: "entryPermitOutside", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Complaint Employee", key: "complaintEmployee", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Arabic Letter", key: "arabicLetter", width: 15, style: { numFmt: "#,##0.00" } },
      { header: "Violation Committee", key: "violationCommittee", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Quota Modification", key: "quotaModification", width: 20, style: { numFmt: "#,##0.00" } },
      { header: "Others", key: "others", width: 15, style: { numFmt: "#,##0.00" } },
      { header: "Total Amount", key: "total", width: 18, style: { numFmt: "#,##0.00" } },
      { header: "Created Date", key: "createdDate", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
      { header: "Created By", key: "createdBy", width: 20 },
    ];

    // Set the worksheet columns
    worksheet.columns = columns;

    // Add data rows
    let totalAmount = 0;
    visaExpenses.forEach((expense, index) => {
      const employee = expense.employee as any;
      const createdBy = expense.createdBy as any;

      const rowData = {
        serialNumber: index + 1,
        name: `${employee.firstName} ${employee.lastName}`,
        country: employee.country || "N/A",
        department: employee.department || "N/A",
        designation: employee.role || "N/A",
        phoneNumber: employee.phoneNumbers?.join(", ") || "N/A",
        bankNumber: employee.bankNumber || "N/A",
        iBan: expense.iBan || "N/A",
        passportNumber: expense.passportNumber || "N/A",
        passportExpireDate: expense.passportExpireDate || null,
        emirateIdNumber: expense.emirateIdNumber || "N/A",
        emirateIdExpireDate: expense.emirateIdExpireDate || null,
        labourCardPersonalNumber: expense.labourCardPersonalNumber || "N/A",
        workPermitNumber: expense.workPermitNumber || "N/A",
        labourExpireDate: expense.labourExpireDate || null,
        offerLetterTyping: expense.offerLetterTyping || 0,
        labourInsurance: expense.labourInsurance || 0,
        labourCardPayment: expense.labourCardPayment || 0,
        statusChangeInOut: expense.statusChangeInOut || 0,
        insideEntry: expense.insideEntry || 0,
        medicalSharjah: expense.medicalSharjah || 0,
        tajweehSubmission: expense.tajweehSubmission || 0,
        iloeInsurance: expense.iloeInsurance || 0,
        healthInsurance: expense.healthInsurance || 0,
        emirateId: expense.emirateId || 0,
        residenceStamping: expense.residenceStamping || 0,
        srilankaCouncilHead: expense.srilankaCouncilHead || 0,
        upscoding: expense.upscoding || 0,
        labourFinePayment: expense.labourFinePayment || 0,
        labourCardRenewalPayment: expense.labourCardRenewalPayment || 0,
        servicePayment: expense.servicePayment || 0,
        visaStamping: expense.visaStamping || 0,
        twoMonthVisitingVisa: expense.twoMonthVisitingVisa || 0,
        finePayment: expense.finePayment || 0,
        entryPermitOutside: expense.entryPermitOutside || 0,
        complaintEmployee: expense.complaintEmployee || 0,
        arabicLetter: expense.arabicLetter || 0,
        violationCommittee: expense.violationCommittee || 0,
        quotaModification: expense.quotaModification || 0,
        others: expense.others || 0,
        total: expense.total || 0,
        createdDate: expense.createdAt || new Date(),
        createdBy: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : "N/A",
      };

      totalAmount += expense.total || 0;
      worksheet.addRow(rowData);
    });

    // Style the header row
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4472C4" }, // Blue header
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Add alternating row colors for better readability
    for (let i = 2; i <= visaExpenses.length + 1; i++) {
      if (i % 2 === 0) {
        worksheet.getRow(i).eachCell((cell) => {
          if (!cell.fill || cell.fill.type !== 'pattern') {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF2F2F2" }, // Light gray for even rows
            };
          }
        });
      }
    }

    // Add summary statistics if requested
    if (includeStats) {
      const summaryStartRow = visaExpenses.length + 3;

      // Add summary title
      const summaryTitleCell = worksheet.getCell(`A${summaryStartRow}`);
      summaryTitleCell.value = "SUMMARY STATISTICS";
      summaryTitleCell.font = { bold: true, size: 14 };
      summaryTitleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFF9900" },
      };

      // Merge cells for title
      worksheet.mergeCells(`A${summaryStartRow}:D${summaryStartRow}`);

      // Add statistics
      const stats = [
        [`Total Records:`, visaExpenses.length],
        [`Total Amount:`, totalAmount],
        [`Average Amount:`, Math.round((totalAmount / visaExpenses.length) * 100) / 100],
        [`Export Date:`, new Date().toLocaleString()],
      ];

      stats.forEach((stat, index) => {
        const row = summaryStartRow + index + 1;
        worksheet.getCell(`A${row}`).value = stat[0];
        worksheet.getCell(`A${row}`).font = { bold: true };
        worksheet.getCell(`B${row}`).value = stat[1];

        if (typeof stat[1] === 'number' && index > 0) {
          worksheet.getCell(`B${row}`).numFmt = '#,##0.00';
        }
      });
    }

    // Freeze the header row
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    // Auto-filter for the data
    worksheet.autoFilter = {
      from: 'A1',
      to: `AO${visaExpenses.length + 1}` // Adjust based on number of columns
    };

    // Generate filename with current date and filter info
    const dateStr = new Date().toISOString().split("T")[0];
    let filename = `visa_expenses_export_${dateStr}`;

    if (req.query.employee) filename += '_employee_filtered';
    if (req.query.startDate && req.query.endDate) {
      filename += `_${req.query.startDate}_to_${req.query.endDate}`;
    } else if (req.query.month && req.query.year) {
      filename += `_${req.query.year}_${req.query.month.padStart(2, '0')}`;
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

