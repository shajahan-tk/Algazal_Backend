import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { VisaExpense } from "../models/visaExpenseModel";
import { User } from "../models/userModel";
import ExcelJS from "exceljs";

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

export const getVisaExpenses = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const filter: any = {};

  // Employee filter
  if (req.query.employee) {
    filter.employee = req.query.employee;
  }

  // Date range filter
  if (req.query.startDate && req.query.endDate) {
    filter.createdAt = {
      $gte: new Date(req.query.startDate as string),
      $lte: new Date(req.query.endDate as string),
    };
  }

  // Total range filter
  if (req.query.minTotal || req.query.maxTotal) {
    filter.total = {};
    if (req.query.minTotal) {
      filter.total.$gte = parseFloat(req.query.minTotal as string);
    }
    if (req.query.maxTotal) {
      filter.total.$lte = parseFloat(req.query.maxTotal as string);
    }
  }

  const total = await VisaExpense.countDocuments(filter);

  // Get all visa expenses with employee details
  const visaExpenses = await VisaExpense.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
    .populate("employee", "firstName lastName email phoneNumbers role")
    .populate("createdBy", "firstName lastName");

  res.status(200).json(
    new ApiResponse(
      200,
      {
        visaExpenses,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      "Visa expenses retrieved successfully"
    )
  );
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
    const currentExpense:any = await VisaExpense.findById(id);
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

export const exportVisaExpensesToExcel = asyncHandler(async (req: Request, res: Response) => {
  const filter: any = {};

  // Employee filter
  if (req.query.employee) {
    filter.employee = req.query.employee;
  }

  // Date range filter
  if (req.query.startDate && req.query.endDate) {
    filter.createdAt = {
      $gte: new Date(req.query.startDate as string),
      $lte: new Date(req.query.endDate as string),
    };
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
      };
    }>("employee", "firstName lastName phoneNumbers role");

  // Create a new workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Visa Expenses");

  // Define columns
  const columns = [
    { header: "Name", key: "name", width: 25 },
    { header: "Country", key: "country", width: 15 },
    { header: "Designation", key: "designation", width: 20 },
    { header: "Bank Number", key: "bankNumber", width: 20 },
    { header: "IBAN", key: "iBan", width: 25 },
    { header: "Passport Number", key: "passportNumber", width: 20 },
    { header: "Expire Date", key: "passportExpireDate", width: 15, style: { numFmt: "dd-mm-yyyy" } },
    { header: "Emirate ID Number", key: "emirateIdNumber", width: 20 },
    { header: "ID Expire", key: "emirateIdExpireDate", width: 15, style: { numFmt: "dd-mm-yyyy" } },
    { header: "Labour Card Personal Number", key: "labourCardPersonalNumber", width: 25 },
    { header: "Work Permit Num", key: "workPermitNumber", width: 20 },
    { header: "Labour Expire Date", key: "labourExpireDate", width: 15, style: { numFmt: "dd-mm-yyyy" } },
    { header: "Offer Letter Typing", key: "offerLetterTyping", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Labour Insurance", key: "labourInsurance", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Labour Card Payment", key: "labourCardPayment", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Status Change In/Out", key: "statusChangeInOut", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Inside Entry", key: "insideEntry", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Medical Sharjh", key: "medicalSharjah", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Tajweeh Submission", key: "tajweehSubmission", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "ILOE Insurance", key: "iloeInsurance", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Health Insurance", key: "healthInsurance", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Emirated ID", key: "emirateId", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Residence Stamping (Normal)", key: "residenceStamping", width: 20, style: { numFmt: "#,##0.00" } },
    { header: "Srilanka Council Head", key: "srilankaCouncilHead", width: 20, style: { numFmt: "#,##0.00" } },
    { header: "Upscoding", key: "upscoding", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Labour Fine Payment", key: "labourFinePayment", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Labour Card Renewal Payment", key: "labourCardRenewalPayment", width: 20, style: { numFmt: "#,##0.00" } },
    { header: "Service Payment", key: "servicePayment", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Visa Stamping", key: "visaStamping", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "2 Month Visiting Visa", key: "twoMonthVisitingVisa", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Fine Payment", key: "finePayment", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Entry Permit Outside", key: "entryPermitOutside", width: 20, style: { numFmt: "#,##0.00" } },
    { header: "Complaint Employee", key: "complaintEmployee", width: 20, style: { numFmt: "#,##0.00" } },
    { header: "Arabic Letter", key: "arabicLetter", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Violation Committee", key: "violationCommittee", width: 20, style: { numFmt: "#,##0.00" } },
    { header: "Quota Modification Others", key: "quotaModification", width: 20, style: { numFmt: "#,##0.00" } },
    { header: "Total", key: "total", width: 15, style: { numFmt: "#,##0.00" } },
  ];

  // Set the worksheet columns
  worksheet.columns = columns;

  // Add data rows
  visaExpenses.forEach((expense) => {
    const employee = expense.employee as any;
    const rowData = {
      name: `${employee.firstName} ${employee.lastName}`,
      country: "", // You might want to add country to your User model
      designation: employee.role,
      bankNumber: "", // You might want to add bankNumber to your User model
      iBan: expense.iBan,
      passportNumber: expense.passportNumber,
      passportExpireDate: expense.passportExpireDate,
      emirateIdNumber: expense.emirateIdNumber,
      emirateIdExpireDate: expense.emirateIdExpireDate,
      labourCardPersonalNumber: expense.labourCardPersonalNumber,
      workPermitNumber: expense.workPermitNumber,
      labourExpireDate: expense.labourExpireDate,
      offerLetterTyping: expense.offerLetterTyping,
      labourInsurance: expense.labourInsurance,
      labourCardPayment: expense.labourCardPayment,
      statusChangeInOut: expense.statusChangeInOut,
      insideEntry: expense.insideEntry,
      medicalSharjah: expense.medicalSharjah,
      tajweehSubmission: expense.tajweehSubmission,
      iloeInsurance: expense.iloeInsurance,
      healthInsurance: expense.healthInsurance,
      emirateId: expense.emirateId,
      residenceStamping: expense.residenceStamping,
      srilankaCouncilHead: expense.srilankaCouncilHead,
      upscoding: expense.upscoding,
      labourFinePayment: expense.labourFinePayment,
      labourCardRenewalPayment: expense.labourCardRenewalPayment,
      servicePayment: expense.servicePayment,
      visaStamping: expense.visaStamping,
      twoMonthVisitingVisa: expense.twoMonthVisitingVisa,
      finePayment: expense.finePayment,
      entryPermitOutside: expense.entryPermitOutside,
      complaintEmployee: expense.complaintEmployee,
      arabicLetter: expense.arabicLetter,
      violationCommittee: expense.violationCommittee,
      quotaModification: expense.quotaModification,
      total: expense.total,
    };

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
    `attachment; filename=visa_expenses_export_${new Date().toISOString().split("T")[0]}.xlsx`
  );

  // Write the workbook to the response
  await workbook.xlsx.write(res);
  res.end();
});