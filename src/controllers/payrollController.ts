import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Payroll } from "../models/payrollModel";
import { IUser, User } from "../models/userModel";
import { EmployeeExpense } from "../models/employeeExpenseModel";
import { Attendance } from "../models/attendanceModel";
import ExcelJS from "exceljs";
import { Types } from "mongoose";

// Helper function to calculate overtime for a period
const calculateOvertime = async (userId: Types.ObjectId, period: string) => {
  try {
    // Extract month and year from period (assuming format "MM-YYYY")
    const [month, year] = period.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    
    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: startDate, $lte: endDate },
      present: true
    });
    
    return attendances.reduce((total, attendance) => {
      return total + (attendance.overtimeHours || 0);
    }, 0);
  } catch (error) {
    console.error("Error calculating overtime:", error);
    return 0;
  }
};

// Create payroll record
export const createPayroll = asyncHandler(async (req: Request, res: Response) => {
  const {
    employee,
    labourCard,
    labourCardPersonalNo,
    period,
    allowance,
    deduction,
    mess,
    advance,
    remark
  } = req.body;

  // Validate required fields
  if (!employee || !labourCard || !labourCardPersonalNo || !period || 
      allowance === undefined || deduction === undefined || 
      mess === undefined || advance === undefined) {
    throw new ApiError(400, "Required fields are missing");
  }

  // Check if employee exists
  const employeeExists = await User.findById(employee);
  if (!employeeExists) {
    throw new ApiError(404, "Employee not found");
  }

  // Check for existing payroll for same employee and period
  const existingPayroll = await Payroll.findOne({
    employee,
    period
  });

  if (existingPayroll) {
    throw new ApiError(400, "Payroll already exists for this employee and period");
  }

  // Get basic salary from EmployeeExpense
  const employeeExpense = await EmployeeExpense.findOne({ employee });
  const basicSalary = employeeExpense?.basicSalary || 0;

  // Calculate overtime
  const overtime = await calculateOvertime(employee, period);

  // Calculate totals
  const totalEarnings = basicSalary + allowance + overtime;
  const net = totalEarnings - deduction - mess - advance;

  // Create payroll record
  const payroll = await Payroll.create({
    employee,
    labourCard,
    labourCardPersonalNo,
    period,
    allowance,
    deduction,
    mess,
    advance,
    net,
    remark,
    createdBy: req.user?.userId
  });

  res.status(201).json(
    new ApiResponse(201, payroll, "Payroll created successfully")
  );
});

// Get all payroll records with comprehensive data
export const getPayrolls = asyncHandler(async (req: Request, res: Response) => {
  const { 
    employee, 
    period, 
    labourCard, 
    labourCardPersonalNo,
    startDate,
    endDate,
    month,
    year,
    page = 1, 
    limit = 10 
  } = req.query;

  const skip = (Number(page) - 1) * Number(limit);
  
  // Define proper filter type
  interface PayrollFilter {
    employee?: Types.ObjectId | string;
    period?: string;
    labourCard?: string;
    labourCardPersonalNo?: string;
    createdAt?: {
      $gte?: Date;
      $lte?: Date;
    };
  }

  const filter: PayrollFilter = {};

  // Basic filters
  if (employee) filter.employee = new Types.ObjectId(employee as string);
  if (period) filter.period = period as string;
  if (labourCard) filter.labourCard = labourCard as string;
  if (labourCardPersonalNo) filter.labourCardPersonalNo = labourCardPersonalNo as string;

  // Date range filter (takes precedence over year/month)
  if (startDate && endDate) {
    filter.createdAt = {
      $gte: new Date(startDate as string),
      $lte: new Date(endDate as string),
    };
  } else {
    // Initialize date filter if not exists
    if (!filter.createdAt) filter.createdAt = {};

    // Year filter
    if (year) {
      const yearNum = parseInt(year as string);
      if (isNaN(yearNum)) {
        throw new ApiError(400, "Invalid year value");
      }
      filter.createdAt.$gte = new Date(yearNum, 0, 1);
      filter.createdAt.$lte = new Date(yearNum + 1, 0, 1);
    }

    // Month filter (works with year filter)
    if (month) {
      const monthNum = parseInt(month as string);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new ApiError(400, "Invalid month value (1-12)");
      }

      if (!filter.createdAt.$gte) {
        // If no year specified, use current year
        const currentYear = new Date().getFullYear();
        filter.createdAt.$gte = new Date(currentYear, monthNum - 1, 1);
        filter.createdAt.$lte = new Date(currentYear, monthNum, 1);
      } else {
        // Adjust existing year filter to specific month
        const start = new Date(filter.createdAt.$gte);
        start.setMonth(monthNum - 1);
        start.setDate(1);

        const end = new Date(start);
        end.setMonth(monthNum);

        filter.createdAt.$gte = start;
        filter.createdAt.$lte = end;
      }
    }
  }

  const total = await Payroll.countDocuments(filter);

  // Get base payroll records with proper typing for populated fields
  const payrolls = await Payroll.find(filter)
    .skip(skip)
    .limit(Number(limit))
    .sort({ period: -1, createdAt: -1 })
    .populate<{ employee: IUser }>({
      path: 'employee',
      select: 'firstName lastName role emiratesId'
    })
    .populate<{ createdBy: IUser }>({
      path: 'createdBy',
      select: 'firstName lastName'
    });

  // Enhance with data from other models
  const enhancedPayrolls = await Promise.all(
    payrolls.map(async (payroll) => {
      // Ensure employee is populated and has the expected properties
      if (!payroll.employee || typeof payroll.employee !== 'object') {
        throw new Error('Employee data not properly populated');
      }

      const employeeExpense = await EmployeeExpense.findOne({ 
        employee: payroll.employee._id 
      }).lean();

      const overtime = await calculateOvertime(
        payroll.employee._id, 
        payroll.period as string
      );

      return {
        _id: payroll._id,
        name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
        designation: payroll.employee.role,
        emiratesId: payroll.employee.emiratesId || 'N/A',
        labourCard: payroll.labourCard,
        labourCardPersonalNo: payroll.labourCardPersonalNo,
        period: payroll.period,
        basic: employeeExpense?.basicSalary || 0,
        allowance: payroll.allowance,
        ot: overtime,
        totalEarning: (employeeExpense?.basicSalary || 0) + payroll.allowance + overtime,
        deduction: payroll.deduction,
        mess: payroll.mess,
        advance: payroll.advance,
        net: payroll.net,
        remark: payroll.remark,
        createdBy: payroll.createdBy 
          ? `${payroll.createdBy.firstName} ${payroll.createdBy.lastName}`
          : 'System',
        createdAt: payroll.createdAt
      };
    })
  );

  res.status(200).json(
    new ApiResponse(
      200,
      {
        payrolls: enhancedPayrolls,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
          hasNextPage: Number(page) * Number(limit) < total,
          hasPreviousPage: Number(page) > 1,
        },
      },
      "Payrolls retrieved successfully"
    )
  );
});

// Get single payroll record
export const getPayroll = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const payroll = await Payroll.findById(id)
    .populate<{ employee: IUser }>({
      path: 'employee',
      select: 'firstName lastName role emiratesId'
    })
    .populate<{ createdBy: IUser }>({
      path: 'createdBy',
      select: 'firstName lastName'
    });

  if (!payroll) {
    throw new ApiError(404, "Payroll not found");
  }

  // Type guard to ensure employee is properly populated
  if (!payroll.employee || typeof payroll.employee !== 'object' || !('firstName' in payroll.employee)) {
    throw new ApiError(500, "Employee data not properly populated");
  }

  // Enhance with additional data
  const employeeExpense = await EmployeeExpense.findOne({ 
    employee: payroll.employee._id 
  }).lean();

  const overtime = await calculateOvertime(
    payroll.employee._id, 
    payroll.period as string
  );

  const enhancedPayroll = {
    ...payroll.toObject(),
    name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
    designation: payroll.employee.role,
    emiratesId: payroll.employee.emiratesId || 'N/A',
    basic: employeeExpense?.basicSalary || 0,
    ot: overtime,
    totalEarning: (employeeExpense?.basicSalary || 0) + payroll.allowance + overtime,
    createdByName: payroll.createdBy 
      ? `${payroll.createdBy.firstName} ${payroll.createdBy.lastName}`
      : 'System'
  };

  res.status(200).json(
    new ApiResponse(200, enhancedPayroll, "Payroll retrieved successfully")
  );
});

// Update payroll record
export const updatePayroll = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updateData = req.body;

  const payroll = await Payroll.findById(id);
  if (!payroll) {
    throw new ApiError(404, "Payroll not found");
  }

  // Check for existing payroll if employee or period is being updated
  if (updateData.employee || updateData.period) {
    const employeeId = updateData.employee || payroll.employee;
    const period = updateData.period || payroll.period;

    const existingPayroll = await Payroll.findOne({
      _id: { $ne: id },
      employee: employeeId,
      period
    });

    if (existingPayroll) {
      throw new ApiError(400, "Payroll already exists for this employee and period");
    }
  }

  // Recalculate net if financial fields are updated
  if (updateData.allowance !== undefined || 
      updateData.deduction !== undefined || 
      updateData.mess !== undefined || 
      updateData.advance !== undefined) {
    
    const employeeExpense = await EmployeeExpense.findOne({ 
      employee: updateData.employee || payroll.employee 
    });

    const basicSalary = employeeExpense?.basicSalary || 0;
    const allowance = updateData.allowance ?? payroll.allowance;
    const deduction = updateData.deduction ?? payroll.deduction;
    const mess = updateData.mess ?? payroll.mess;
    const advance = updateData.advance ?? payroll.advance;
    const overtime = await calculateOvertime(
      updateData.employee || payroll.employee,
      updateData.period || payroll.period
    );

    updateData.net = (basicSalary + allowance + overtime) - deduction - mess - advance;
  }

  const updatedPayroll = await Payroll.findByIdAndUpdate(id, updateData, {
    new: true
  })
    .populate({
      path: 'employee',
      select: 'firstName lastName role emiratesId'
    })
    .populate({
      path: 'createdBy',
      select: 'firstName lastName'
    });

  res.status(200).json(
    new ApiResponse(200, updatedPayroll, "Payroll updated successfully")
  );
});

// Delete payroll record
export const deletePayroll = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const payroll = await Payroll.findByIdAndDelete(id);

  if (!payroll) {
    throw new ApiError(404, "Payroll not found");
  }

  res.status(200).json(
    new ApiResponse(200, null, "Payroll deleted successfully")
  );
});

// Export payrolls to Excel
export const exportPayrollsToExcel = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};

  // Apply filters with type safety
  if (req.query.period) filter.period = req.query.period as string;
  if (req.query.employee) filter.employee = req.query.employee as string;
  if (req.query.labourCard) filter.labourCard = req.query.labourCard as string;

  const payrolls = await Payroll.find(filter)
    .sort({ period: -1, createdAt: -1 })
    .populate<{ employee: IUser }>({
      path: 'employee',
      select: 'firstName lastName role emiratesId'
    });

  // Create workbook and worksheet
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payroll Report');

  // Define columns
  worksheet.columns = [
    { header: 'S/NO', key: 'serialNo', width: 8 },
    { header: 'NAME', key: 'name', width: 25 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'EMIRATES ID', key: 'emiratesId', width: 20 },
    { header: 'LABOUR CARD', key: 'labourCard', width: 20 },
    { header: 'LABOUR CARD PERSONAL NO', key: 'labourCardPersonalNo', width: 25 },
    { header: 'PERIOD', key: 'period', width: 15 },
    { header: 'BASIC', key: 'basic', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'ALLOWANCE', key: 'allowance', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'OT', key: 'ot', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'TOTAL EARNING', key: 'totalEarning', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'DEDUCTION', key: 'deduction', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'MESS', key: 'mess', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'ADVANCE', key: 'advance', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'NET', key: 'net', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'REMARK', key: 'remark', width: 30 }
  ];

  // Process payrolls sequentially to avoid potential memory issues with many parallel queries
  for (let i = 0; i < payrolls.length; i++) {
    const payroll = payrolls[i];
    
    // Type guard for populated employee
    if (!payroll.employee || typeof payroll.employee !== 'object' || !('firstName' in payroll.employee)) {
      continue; // Skip this record or handle error as needed
    }

    const employeeExpense = await EmployeeExpense.findOne({ 
      employee: payroll.employee._id 
    }).lean();

    const overtime = await calculateOvertime(
      payroll.employee._id, 
      payroll.period as string
    );

    worksheet.addRow({
      serialNo: i + 1,
      name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
      designation: payroll.employee.role,
      emiratesId: payroll.employee.emiratesId || 'N/A',
      labourCard: payroll.labourCard,
      labourCardPersonalNo: payroll.labourCardPersonalNo,
      period: payroll.period,
      basic: employeeExpense?.basicSalary || 0,
      allowance: payroll.allowance,
      ot: overtime,
      totalEarning: (employeeExpense?.basicSalary || 0) + payroll.allowance + overtime,
      deduction: payroll.deduction,
      mess: payroll.mess,
      advance: payroll.advance,
      net: payroll.net,
      remark: payroll.remark || ''
    });
  }

  // Style header row
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  });

  // Set response headers
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=payroll_report_${new Date().toISOString().split('T')[0]}.xlsx`
  );

  // Send the workbook
  await workbook.xlsx.write(res);
  res.end();
});