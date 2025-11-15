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
import puppeteer from "puppeteer";
import { VisaExpense } from "../models/visaExpenseModel";

// Helper function to calculate overtime for previous month
export const calculatePreviousMonthOvertimeAmount = async (
  userId: Types.ObjectId,
  basicSalary: number
) => {
  try {
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = previousMonth.getFullYear();
    const month = previousMonth.getMonth() + 1; // JavaScript months are 0-indexed

    const startDate = new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);

    const daysInMonth = endDate.getDate();

    console.log(`Calculating overtime for user ${userId} for previous month: ${month}-${year}`);
    console.log(`Days in month: ${daysInMonth}, Basic Salary: ${basicSalary}`);

    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: startDate, $lte: endDate },
      present: true
    });

    console.log(`Found ${attendances.length} attendance records for previous month`);

    const totalOvertimeHours = attendances.reduce((total, attendance) => {
      const ot = attendance.overtimeHours || 0;
      console.log(`Date: ${attendance.date}, OT Hours: ${ot}`);
      return total + ot;
    }, 0);

    const hourlyRate = (basicSalary / daysInMonth) / 10;
    const overtimeAmount = totalOvertimeHours * hourlyRate;

    console.log(`Total OT hours: ${totalOvertimeHours}, Hourly rate: ${hourlyRate.toFixed(2)}, OT amount: ${overtimeAmount.toFixed(2)}`);

    return {
      overtimeHours: totalOvertimeHours,
      overtimeAmount: Math.round(overtimeAmount * 100) / 100,
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      daysInMonth
    };
  } catch (error) {
    console.error("Error calculating previous month overtime:", error);
    return {
      overtimeHours: 0,
      overtimeAmount: 0,
      hourlyRate: 0,
      daysInMonth: 30
    };
  }
};

// Helper function to get month number from month name
const getMonthNumber = (monthName: string): number => {
  const months: { [key: string]: number } = {
    'January': 1,
    'February': 2,
    'March': 3,
    'April': 4,
    'May': 5,
    'June': 6,
    'July': 7,
    'August': 8,
    'September': 9,
    'October': 10,
    'November': 11,
    'December': 12
  };
  return months[monthName] || 0;
};

// Helper function to format date
const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'N/A';
  const d = new Date(date);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  });
};

// Get attendance details for a specific period with Sunday tracking
const getAttendanceDetails = async (userId: Types.ObjectId, period: string) => {
  try {
    // Validate inputs
    if (!userId || !period) {
      return {
        summary: {
          totalDays: 0,
          presentDays: 0,
          absentDays: 0,
          holidays: 0,
          fridays: 0,
          saturdays: 0,
          sundays: 0
        }
      };
    }

    const filter: any = {
      user: userId
    };

    // Add date filter if period is provided
    if (period) {
      // Parse period (expected format: MM-YYYY)
      const [monthStr, yearStr] = period.split('-');
      
      if (!monthStr || !yearStr) {
        console.log('Invalid period format:', period);
        return {
          summary: {
            totalDays: 0,
            presentDays: 0,
            absentDays: 0,
            holidays: 0,
            fridays: 0,
            saturdays: 0,
            sundays: 0
          }
        };
      }

      const monthNum = parseInt(monthStr, 10);
      const yearNum = parseInt(yearStr, 10);

      if (isNaN(monthNum) || isNaN(yearNum) || monthNum < 1 || monthNum > 12) {
        console.log('Invalid month/year in period:', period);
        return {
          summary: {
            totalDays: 0,
            presentDays: 0,
            absentDays: 0,
            holidays: 0,
            fridays: 0,
            saturdays: 0,
            sundays: 0
          }
        };
      }

      // Create VALID date range for the specific month
      // JavaScript months are 0-indexed (0=Jan, 1=Feb, etc.)
      const startDate = new Date(yearNum, monthNum - 1, 1);
      const endDate = new Date(yearNum, monthNum, 0); // 0th day of next month is last day of current month
      
      console.log('Date range for attendance:', {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      filter.date = {
        $gte: startDate,
        $lte: endDate
      };
    }

    console.log('Attendance filter:', filter);

    const attendances = await Attendance.find(filter)
      .populate('user', 'firstName lastName')
      .sort({ date: 1 });

    // Initialize counters
    let totalDays = 0;
    let presentDays = 0;
    let absentDays = 0;
    let dutyOffDays = 0;
    let totalHours = 0;
    let overtimeHours = 0;
    let sundayWorkingDays = 0;
    let sundayOvertimeHours = 0;

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

    // Process attendance records
    const attendanceRecords = attendances.map((att, index) => {
      if (!att.date) return;

      totalDays++;
      
      const date = new Date(att.date);
      const dayName = days[date.getDay()];
      const isSunday = date.getDay() === 0;

      let status = 'ABSENT';
      let hours = 0;

      if (att.isPaidLeave) {
        status = 'DUTY OFF';
        dutyOffDays++;
      } else if (att.present) {
        status = 'PRESENT';
        hours = att.workingHours || 0;
        totalHours += hours;
        overtimeHours += att.overtimeHours || 0;
        presentDays++;

        // Track Sunday working separately
        if (isSunday) {
          sundayWorkingDays++;
          sundayOvertimeHours += att.overtimeHours || 0;
        }
      } else {
        absentDays++;
      }

      return {
        sno: index + 1,
        date: date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        day: dayName,
        status,
        hours: hours.toFixed(2),
        overtimeHours: (att.overtimeHours || 0).toFixed(2),
        isSunday
      };
    });

    const summary = {
      totalDays,
      presentDays,
      absentDays,
      dutyOffDays,
      totalHours: totalHours.toFixed(2),
      overtimeHours: overtimeHours.toFixed(2),
      sundayWorkingDays,
      sundayOvertimeHours: sundayOvertimeHours.toFixed(2)
    };

    console.log('Attendance summary:', summary);

    return {
      records: attendanceRecords,
      summary
    };

  } catch (error) {
    console.error('Error in getAttendanceDetails:', error);
    return {
      summary: {
        totalDays:  0,
        presentDays: 0,
        absentDays: 0,
        holidays: 0,
        fridays: 0,
        saturdays: 0,
        sundays: 0
      }
    };
  }
};

// New function to get attendance details by month and year
const getAttendanceDetailsByMonthYear = async (userId: Types.ObjectId, month: number, year: number) => {
  try {
    // Validate inputs
    if (!userId || !month || !year) {
      return {
        summary: {
          totalDays: 0,
          presentDays: 0,
          absentDays: 0,
          holidays: 0,
          fridays: 0,
          saturdays: 0,
          sundays: 0
        }
      };
    }

    const filter: any = {
      user: userId
    };

    // Create date range for specific month and year
    // JavaScript months are 0-indexed (0=Jan, 1=Feb, etc.)
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    
    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.log('Invalid dates created:', { startDate, endDate, month, year });
      return {
        summary: {
          totalDays: 0,
          presentDays: 0,
          absentDays: 0,
          holidays: 0,
          fridays: 0,
          saturdays: 0,
          sundays: 0
        }
      };
    }

    console.log('Date range for attendance:', {
      month,
      year,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    filter.date = {
      $gte: startDate,
      $lte: endDate
    };

    const attendances = await Attendance.find(filter)
      .populate('user', 'firstName lastName')
      .sort({ date: 1 });

    // Initialize counters
    let totalDays = 0;
    let presentDays = 0;
    let absentDays = 0;
    let dutyOffDays = 0;
    let totalHours = 0;
    let overtimeHours = 0;
    let sundayWorkingDays = 0;
    let sundayOvertimeHours = 0;

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

    // Process attendance records
    const attendanceRecords = attendances.map((att, index) => {
      if (!att.date) return;

      totalDays++;
      
      const date = new Date(att.date);
      const dayName = days[date.getDay()];
      const isSunday = date.getDay() === 0;

      let status = 'ABSENT';
      let hours = 0;

      if (att.isPaidLeave) {
        status = 'DUTY OFF';
        dutyOffDays++;
      } else if (att.present) {
        status = 'PRESENT';
        hours = att.workingHours || 0;
        totalHours += hours;
        overtimeHours += att.overtimeHours || 0;
        presentDays++;

        // Track Sunday working separately
        if (isSunday) {
          sundayWorkingDays++;
          sundayOvertimeHours += att.overtimeHours || 0;
        }
      } else {
        absentDays++;
      }

      return {
        sno: index + 1,
        date: date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        day: dayName,
        status,
        hours: hours.toFixed(2),
        overtimeHours: (att.overtimeHours || 0).toFixed(2),
        isSunday
      };
    });

    const summary = {
      totalDays,
      presentDays,
      absentDays,
      dutyOffDays,
      totalHours: totalHours.toFixed(2),
      overtimeHours: overtimeHours.toFixed(2),
      sundayWorkingDays,
      sundayOvertimeHours: sundayOvertimeHours.toFixed(2)
    };

    console.log('Attendance summary:', summary);

    return {
      records: attendanceRecords,
      summary
    };

  } catch (error) {
    console.error('Error in getAttendanceDetailsByMonthYear:', error);
    return {
      summary: {
        totalDays: 0,
        presentDays: 0,
        absentDays: 0,
        holidays: 0,
        fridays: 0,
        saturdays: 0,
        sundays: 0
      }
    };
  }
};

// Get all payroll records with comprehensive data
export const getPayrolls = asyncHandler(async (req: Request, res: Response) => {
  const {
    employee,
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

  interface PayrollFilter {
    employee?: Types.ObjectId | string;
    labourCard?: string;
    labourCardPersonalNo?: string;
    createdAt?: {
      $gte?: Date;
      $lte?: Date;
    };
  }

  const filter: PayrollFilter = {};

  if (employee) filter.employee = new Types.ObjectId(employee as string);
  if (labourCard) filter.labourCard = labourCard as string;
  if (labourCardPersonalNo) filter.labourCardPersonalNo = labourCardPersonalNo as string;

  // Initialize createdAt filter if not already present
  if (!filter.createdAt) filter.createdAt = {};

  if (startDate && endDate) {
    // Validate and parse the dates
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    
    // Check if dates are valid
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new ApiError(400, "Invalid date format in startDate or endDate");
    }
    
    filter.createdAt = {
      $gte: start,
      $lte: end
    };
  } else if (year) {
    const yearNum = parseInt(year as string);
    if (isNaN(yearNum)) {
      throw new ApiError(400, "Invalid year value");
    }
    
    if (month) {
      const monthNum = parseInt(month as string);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new ApiError(400, "Invalid month value (1-12)");
      }
      
      // Create date range for the specific month
      // JavaScript months are 0-indexed (0=Jan, 1=Feb, etc.)
      const startDateOfMonth = new Date(yearNum, monthNum - 1, 1);
      const endDateOfMonth = new Date(yearNum, monthNum, 0); // 0th day of next month is last day of current month
      
      console.log('Filtering by month/year:', {
        year: yearNum,
        month: monthNum,
        startDate: startDateOfMonth.toISOString(),
        endDate: endDateOfMonth.toISOString()
      });
      
      filter.createdAt = {
        $gte: startDateOfMonth,
        $lte: endDateOfMonth
      };
    } else {
      // If only year is provided, get entire year
      filter.createdAt = {
        $gte: new Date(yearNum, 0, 1),
        $lte: new Date(yearNum + 1, 0, 1)
      };
    }
  }

  console.log('Final payroll filter:', filter);

  const total = await Payroll.countDocuments(filter);

  const payrolls = await Payroll.find(filter)
    .skip(skip)
    .limit(Number(limit))
    .sort({ createdAt: -1 }) // Sort by creation date
    .populate<{ employee: IUser }>({
      path: 'employee',
      select: 'firstName lastName role emiratesId'
    })
    .populate<{ createdBy: IUser }>({
      path: 'createdBy',
      select: 'firstName lastName'
    });

  const enhancedPayrolls = await Promise.all(
    payrolls.map(async (payroll) => {
      if (!payroll.employee || typeof payroll.employee !== 'object') {
        throw new Error('Employee data not properly populated');
      }

      const employeeExpense = await EmployeeExpense.findOne({
        employee: payroll.employee._id
      }).lean();

      // Get attendance details - DON'T pass period since we're filtering by month/year
      const attendanceDetails = await getAttendanceDetailsByMonthYear(
        payroll.employee._id, 
        getMonthNumber(payroll.period.split('-')[0]),
        parseInt(payroll.period.split('-')[1])
      );

      const totalEarnings = (employeeExpense?.basicSalary || 0) +
        payroll.allowance +
        payroll.transport +
        payroll.overtime +
        payroll.medical +
        payroll.bonus;

      const totalDeductions = payroll.mess +
        payroll.salaryAdvance +
        payroll.loanDeduction +
        payroll.fineAmount +
        (payroll.visaDeduction || 0);

      return {
        _id: payroll._id,
        name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
        designation: payroll.employee.role,
        emiratesId: payroll.employee.emiratesId || 'N/A',
        labourCard: payroll.labourCard,
        labourCardPersonalNo: payroll.labourCardPersonalNo,
        period: payroll.period,
        basicSalary: employeeExpense?.basicSalary || 0,
        allowance: payroll.allowance,
        transport: payroll.transport,
        overtime: payroll.overtime,
        medical: payroll.medical,
        bonus: payroll.bonus,
        totalEarnings,
        mess: payroll.mess,
        salaryAdvance: payroll.salaryAdvance,
        loanDeduction: payroll.loanDeduction,
        fineAmount: payroll.fineAmount,
        visaDeduction: payroll.visaDeduction || 0,
        totalDeductions,
        net: payroll.net,
        remark: payroll.remark,
        // Include attendance summary with Sunday tracking
        attendanceSummary: attendanceDetails.summary,
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

// Create payroll record
export const createPayroll = asyncHandler(async (req: Request, res: Response) => {
  let {
    employee,
    labourCard,
    labourCardPersonalNo,
    allowance,
    transport,
    medical,
    bonus,
    specialOT,
    mess,
    salaryAdvance,
    loanDeduction,
    fineAmount,
    visaDeduction,
    remark
  } = req.body;

  console.log('====================================');
  console.log('Creating payroll for previous month:', req.body);
  console.log('====================================');

  allowance = Number(allowance) || 0;
  transport = Number(transport) || 0;
  medical = Number(medical) || 0;
  bonus = Number(bonus) || 0;
  specialOT = Number(specialOT) || 0;
  mess = Number(mess) || 0;
  salaryAdvance = Number(salaryAdvance) || 0;
  loanDeduction = Number(loanDeduction) || 0;
  fineAmount = Number(fineAmount) || 0;
  visaDeduction = Number(visaDeduction) || 0;

  if (!employee || !labourCard || !labourCardPersonalNo) {
    throw new ApiError(400, "Required fields are missing");
  }

  const employeeExists = await User.findById(employee);
  if (!employeeExists) {
    throw new ApiError(404, "Employee not found");
  }

  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const period = `${String(previousMonth.getMonth() + 1).padStart(2, '0')}-${previousMonth.getFullYear()}`;

  console.log(`Auto-generated period for payroll: ${period}`);

  const existingPayroll = await Payroll.findOne({ employee, period });
  if (existingPayroll) {
    throw new ApiError(400, `Payroll already exists for this employee for period ${period}`);
  }

  const employeeExpense = await EmployeeExpense.findOne({ employee });
  const basicSalary = Number(employeeExpense?.basicSalary) || 0;

  const overtimeData = await calculatePreviousMonthOvertimeAmount(employee, basicSalary);
  const overtime = overtimeData.overtimeAmount;

  const totalEarnings = basicSalary + allowance + transport + overtime + specialOT + medical + bonus;
  const totalDeductions = mess + salaryAdvance + loanDeduction + fineAmount + visaDeduction;

  const net = totalEarnings - totalDeductions;

  const payroll = await Payroll.create({
    employee,
    labourCard,
    labourCardPersonalNo,
    period,
    allowance,
    transport,
    overtime,
    specialOT,
    medical,
    bonus,
    mess,
    salaryAdvance,
    loanDeduction,
    fineAmount,
    visaDeduction,
    net,
    remark,
    createdBy: req.user?.userId
  });

  console.log(`Payroll created successfully for period ${period} with overtime: ${overtime}, special OT: ${specialOT}, visa deduction: ${visaDeduction}`);

  res.status(201).json(
    new ApiResponse(201, payroll, "Payroll created successfully for previous month")
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

  // Don'T allow period or overtime to be changed (overtime is auto-calculated)
  delete updateData.period;
  delete updateData.overtime;

  // Validate if employee is being changed
  if (updateData.employee) {
    const employeeId = updateData.employee;
    const period = payroll.period;

    const existingPayroll = await Payroll.findOne({
      _id: { $ne: id },
      employee: employeeId,
      period
    });

    if (existingPayroll) {
      throw new ApiError(400, "Payroll already exists for this employee and period");
    }
  }

  // Convert all numeric fields to numbers
  if (updateData.allowance !== undefined) updateData.allowance = Number(updateData.allowance) || 0;
  if (updateData.transport !== undefined) updateData.transport = Number(updateData.transport) || 0;
  if (updateData.specialOT !== undefined) updateData.specialOT = Number(updateData.specialOT) || 0;
  if (updateData.medical !== undefined) updateData.medical = Number(updateData.medical) || 0;
  if (updateData.bonus !== undefined) updateData.bonus = Number(updateData.bonus) || 0;
  if (updateData.mess !== undefined) updateData.mess = Number(updateData.mess) || 0;
  if (updateData.salaryAdvance !== undefined) updateData.salaryAdvance = Number(updateData.salaryAdvance) || 0;
  if (updateData.loanDeduction !== undefined) updateData.loanDeduction = Number(updateData.loanDeduction) || 0;
  if (updateData.fineAmount !== undefined) updateData.fineAmount = Number(updateData.fineAmount) || 0;
  if (updateData.visaDeduction !== undefined) updateData.visaDeduction = Number(updateData.visaDeduction) || 0;

  // Fetch employee expense to get basic salary
  const employeeExpense = await EmployeeExpense.findOne({
    employee: updateData.employee || payroll.employee
  });

  const basicSalary = Number(employeeExpense?.basicSalary) || 0;
  
  // Use updated values if provided, otherwise keep existing
  const allowance = updateData.allowance !== undefined ? updateData.allowance : payroll.allowance;
  const transport = updateData.transport !== undefined ? updateData.transport : payroll.transport;
  const specialOT = updateData.specialOT !== undefined ? updateData.specialOT : (payroll.specialOT || 0);
  const medical = updateData.medical !== undefined ? updateData.medical : payroll.medical;
  const bonus = updateData.bonus !== undefined ? updateData.bonus : payroll.bonus;
  const mess = updateData.mess !== undefined ? updateData.mess : payroll.mess;
  const salaryAdvance = updateData.salaryAdvance !== undefined ? updateData.salaryAdvance : payroll.salaryAdvance;
  const loanDeduction = updateData.loanDeduction !== undefined ? updateData.loanDeduction : payroll.loanDeduction;
  const fineAmount = updateData.fineAmount !== undefined ? updateData.fineAmount : payroll.fineAmount;
  const visaDeduction = updateData.visaDeduction !== undefined ? updateData.visaDeduction : (payroll.visaDeduction || 0);
  
  // Keep existing overtime (it's auto-calculated, shouldn't be changed manually)
  const overtime = payroll.overtime;

  // Recalculate net salary
  const totalEarnings = basicSalary + allowance + transport + overtime + specialOT + medical + bonus;
  const totalDeductions = mess + salaryAdvance + loanDeduction + fineAmount + visaDeduction;
  updateData.net = totalEarnings - totalDeductions;

  console.log('Update calculation:', {
    basicSalary,
    allowance,
    transport,
    overtime,
    specialOT,
    medical,
    bonus,
    totalEarnings,
    mess,
    salaryAdvance,
    loanDeduction,
    fineAmount,
    visaDeduction,
    totalDeductions,
    net: updateData.net
  });

  const updatedPayroll = await Payroll.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true
  })
    .populate({
      path: "employee",
      select: "firstName lastName role emiratesId"
    })
    .populate({
      path: "createdBy",
      select: "firstName lastName"
    });

  if (!updatedPayroll) {
    throw new ApiError(404, "Payroll not found after update");
  }

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
  const { month, year, search, employee, period, labourCard, startDate, endDate } = req.query;

  const filter: Record<string, unknown> = {};

  if (month && year) {
    const startOfMonth = new Date(Number(year), Number(month) - 1, 1);
    const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);
    
    console.log('Exporting by month/year:', {
      month,
      year,
      startDate: startOfMonth.toISOString(),
      endDate: endOfMonth.toISOString()
    });
    
    filter.createdAt = {
      $gte: startOfMonth,
      $lte: endOfMonth
    };
  } else if (year) {
    const startOfYear = new Date(Number(year), 0, 1);
    const endOfYear = new Date(Number(year), 11, 31, 23, 59, 59, 999);

    console.log('Exporting by year:', {
      year,
      startDate: startOfYear.toISOString(),
      endDate: endOfYear.toISOString()
    });
    
    filter.createdAt = {
      $gte: startOfYear,
      $lte: endOfYear
    };
  } else if (startDate && endDate) {
    filter.createdAt = {
      $gte: new Date(startDate as string),
      $lte: new Date(endDate as string)
    };
  }

  if (period) filter.period = period as string;
  if (employee) filter.employee = employee as string;
  if (labourCard) filter.labourCard = labourCard as string;

  let searchFilter = {};
  if (search && search.toString().trim()) {
    searchFilter = {
      $or: [
        { period: { $regex: search, $options: 'i' } },
        { labourCard: { $regex: search, $options: 'i' } },
        { labourCardPersonalNo: { $regex: search, $options: 'i' } },
        { remark: { $regex: search, $options: 'i' } }
      ]
    };
  }

  const finalFilter = Object.keys(searchFilter).length > 0
    ? { ...filter, ...searchFilter }
    : filter;

  const payrolls = await Payroll.find(finalFilter)
    .sort({ period: -1, createdAt: -1 })
    .populate<{ employee: IUser }>({
      path: 'employee',
      select: 'firstName lastName role emiratesId'
    });

  if (payrolls.length === 0) {
    return res.status(404).json({
      success: false,
      message: "No payroll records found for specified criteria"
    });
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payroll Report');

  worksheet.columns = [
    { header: 'S/NO', key: 'serialNo', width: 8 },
    { header: 'NAME', key: 'name', width: 25 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'EMIRATES ID', key: 'emiratesId', width: 20 },
    { header: 'LABOUR CARD', key: 'labourCard', width: 20 },
    { header: 'LABOUR CARD PERSONAL NO', key: 'labourCardPersonalNo', width: 25 },
    { header: 'PERIOD', key: 'period', width: 15 },
    { header: 'BASIC SALARY', key: 'basicSalary', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'ALLOWANCE', key: 'allowance', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'TRANSPORT', key: 'transport', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'OVERTIME', key: 'overtime', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'MEDICAL', key: 'medical', width: 15, style: { numFmt: '##0.00' } },
    { header: 'BONUS', key: 'bonus', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'TOTAL EARNING', key: 'totalEarning', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'FOOD ALLOWANCE', key: 'mess', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'SALARY ADVANCE', key: 'salaryAdvance', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'LOAN DEDUCTION', key: 'loanDeduction', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'FINE AMOUNT', key: 'fineAmount', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'VISA DEDUCTION', key: 'visaDeduction', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'TOTAL DEDUCTIONS', key: 'totalDeductions', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'NET', key: 'net', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'REMARK', key: 'remark', width: 30 }
  ];

  for (let i = 0; i < payrolls.length; i++) {
    const payroll = payrolls[i];

    if (!payroll.employee || typeof payroll.employee !== 'object') {
      continue;
    }

    const employeeExpense = await EmployeeExpense.findOne({
      employee: payroll.employee._id
    }).lean();

    const basicSalary = employeeExpense?.basicSalary || 0;
    const totalEarnings = basicSalary + payroll.allowance + payroll.transport + payroll.overtime + payroll.medical + payroll.bonus;
    const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction; // UPDATED

    worksheet.addRow({
      serialNo: i + 1,
      name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
      designation: payroll.employee.role,
      emiratesId: payroll.employee.emiratesId || 'N/A',
      labourCard: payroll.labourCard,
      labourCardPersonalNo: payroll.labourCardPersonalNo,
      period: payroll.period,
      basicSalary: employeeExpense?.basicSalary || 0,
      allowance: payroll.allowance,
      transport: payroll.transport,
      overtime: payroll.overtime,
      medical: payroll.medical,
      bonus: payroll.bonus,
      totalEarnings: basicSalary + payroll.allowance + payroll.transport + payroll.overtime + payroll.medical + payroll.bonus,
      mess: payroll.mess,
      salaryAdvance: payroll.salaryAdvance,
      loanDeduction: payroll.loanDeduction,
      fineAmount: payroll.fineAmount,
      visaDeduction: payroll.visaDeduction || 0,
      totalDeductions: payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction,
      net: payroll.net,
      remark: payroll.remark || ''
    });
  }

  let filename = 'payroll_report';
  if (month && year) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    filename += `_${monthNames[Number(month) - 1]}_${year}`;
  } else if (year) {
    filename += `_${year}`;
  } else {
    filename += `_${new Date().toISOString().split('T')[0]}`;
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${filename}.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
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

  if (!payroll.employee || typeof payroll.employee !== 'object') {
    throw new ApiError(500, "Employee data not properly populated");
  }

  const employeeExpense = await EmployeeExpense.findOne({
    employee: payroll.employee._id
  }).lean();

  // Get attendance details - DON'T pass period since we're filtering by month/year
  const attendanceDetails = await getAttendanceDetailsByMonthYear(
    payroll.employee._id, 
    getMonthNumber(payroll.period.split('-')[0]),
    parseInt(payroll.period.split('-')[1])
  );

  const totalEarnings = (employeeExpense?.basicSalary || 0) +
    payroll.allowance +
    payroll.transport +
    payroll.overtime +
    payroll.medical +
    payroll.bonus;

  const totalDeductions = payroll.mess +
    payroll.salaryAdvance +
    payroll.loanDeduction +
    payroll.fineAmount +
    payroll.visaDeduction;

  const enhancedPayroll = {
    ...payroll.toObject(),
    name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
    designation: payroll.employee.role,
    emiratesId: payroll.employee.emiratesId || 'N/A',
    basicSalary: employeeExpense?.basicSalary || 0,
    totalEarnings,
    totalDeductions,
    // Include attendance summary with Sunday tracking
    attendanceSummary: attendanceDetails.summary,
    createdByName: payroll.createdBy
      ? `${payroll.createdBy.firstName} ${payroll.createdBy.lastName}`
      : 'System'
  };

  res.status(200).json(
    new ApiResponse(200, enhancedPayroll, "Payroll retrieved successfully")
  );
});

// Helper function to convert number to words
const convertToWords = (num: number): string => {
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const teens = ['TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];

  if (num === 0) return 'ZERO';

  const convertLessThanThousand = (n: number): string => {
    if (n === 0) return '';

    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');

    return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 !== 0 ? ' ' + convertLessThanThousand(n % 100) : '');
  };

  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);

  let result = '';

  if (integerPart >= 1000) {
    result += convertLessThanThousand(Math.floor(integerPart / 1000)) + ' THOUSAND ';
    result += convertLessThanThousand(integerPart % 1000);
  } else {
    result += convertLessThanThousand(integerPart);
  }

  if (decimalPart > 0) {
    result += ' AND ' + convertLessThanThousand(decimalPart) + ' FILS';
  }

  return result.trim() + ' AED';
};

// Generate HTML for payslip with professional header
const generatePayslipHTML = (data: any): string => {
  console.log(data.attendanceDetails.records[0]);

  const getStatusDisplay = (record: any) => {
    if (record.status.toLowerCase() === 'day off') {
      return 'status-dayoff';
    }
    return '';
  };

  const attendanceRows = data.attendanceDetails.records
    .map((record: any) => {
      const status = record.status?.toLowerCase();
      if (status === 'present' || status === 'absent') {
        return '';
      }

      return `
      <tr${record.isSunday ? ' style="background-color: #fff3cd;"' : ''}>
        <td>${record.sno}</td>
        <td>${record.date}</td>
        <td><strong>${record.day}</strong></td>
        <td class="${getStatusDisplay(record)}">${record.status}</td>
        <td>${status === 'day off' ? '0' : record.hours}</td>
        <td>${status === 'day off' ? '0' : record.overtimeHours}</td>
      </tr>
    `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payslip - ${data.period}</title>
    <style>
        @page {
          size: A4;
          margin: 0.3cm;
        }
        
        body {
            font-family: 'Arial', sans-serif;
            font-size: 10pt;
            line-height: 1.3;
            color: #333;
            margin: 0;
            padding: 0;
            background: white;
        }
        
        .payslip-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
        }
        
        .header {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 10px;
            gap: 15px;
            page-break-after: avoid;
            padding: 10px 0;
            border-bottom: 2px solid #94d7f4;
            position: relative;
        }

        .logo {
            height: 40px;
            width: auto;
            max-width: 120px;
            object-fit: contain;
            position: absolute;
            left: 0;
        }

        .company-names {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            flex-grow: 1;
        }

        .company-name-arabic {
            font-size: 16pt;
            font-weight: bold;
            color: #1a1a1a;
            line-height: 1.2;
            direction: rtl;
            unicode-bidi: bidi-override;
            letter-spacing: 0;
            margin-bottom: 3px;
        }

        .company-name-english {
            font-size: 9pt;
            font-weight: bold;
            color: #1a1a1a;
            line-height: 1.2;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }
        
        .document-title {
            text-align: center;
            margin: 10px 0 15px 0;
            padding: 8px;
            background: linear-gradient(135deg, #2c5aa0 0%, #4a90e2 100%);
            color: white;
            border-radius: 6px;
            font-size: 12pt;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            page-break-after: avoid;
        }
        
        .content {
            padding: 0 15px 15px 15px;
        }
        
        .section {
            margin-bottom: 12px;
            page-break-inside: avoid;
        }
        
        .section-title {
            font-size: 10pt;
            font-weight: bold;
            color: #2c5aa0;
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid #e8f4fd;
            text-transform: uppercase;
            page-break-after: avoid;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 4px 12px;
            margin-bottom: 8px;
            page-break-inside: avoid;
        }
        
        .info-item {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            border-bottom: 1px solid #f5f5f5;
            font-size: 9pt;
        }
        
        .info-label {
            color: #666;
            font-weight: 500;
        }
        
        .info-value {
            color: #333;
            font-weight: 600;
        }
        
        .salary-table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
            border: 1px solid #ddd;
            font-size: 9pt;
            page-break-inside: avoid;
        }
        
        .salary-table th {
            background: #2c5aa0;
            color: white;
            padding: 8px 6px;
            text-align: left;
            font-weight: 600;
            border: 1px solid #2c5aa0;
        }
        
        .salary-table td {
            padding: 6px 6px;
            border: 1px solid #ddd;
            color: #333;
        }
        
        .amount {
            text-align: right;
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        
        .summary-section {
            background: #f8fbff;
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
            border: 1px solid #e8f4fd;
            page-break-inside: avoid;
        }
        
        .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
            font-size: 10pt;
        }
        
        .summary-row.total {
            border-top: 1px solid #2c5aa0;
            margin-top: 5px;
            padding-top: 6px;
            font-weight: 700;
            color: #2c5aa0;
        }
        
        .net-pay {
            background: linear-gradient(135deg, #2c5aa0 0%, #4a90e2 100%);
            color: white;
            padding: 12px;
            text-align: center;
            margin: 12px 0;
            border-radius: 6px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.1);
            page-break-inside: avoid;
        }
        
        .net-pay-label {
            font-size: 10pt;
            opacity: 0.95;
            margin-bottom: 5px;
            font-weight: 600;
        }
        
        .net-pay-amount {
            font-size: 18px;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            letter-spacing: 0.5px;
        }
        
        .attendance-summary {
            background: #f8fbff;
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
            border: 1px solid #e8f4fd;
            page-break-inside: avoid;
        }
        
        .attendance-summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            text-align: center;
        }
        
        .summary-card {
            padding: 10px;
            background: white;
            border-radius: 4px;
            border: 1px solid #e8f4fd;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        .sunday-card {
            padding: 10px;
            background: #fff9e6;
            border-radius: 4px;
            border: 1px solid #ffc107;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        .summary-card h4 {
            margin: 0 0 6px 0;
            font-size: 8pt;
            font-weight: 600;
            color: #2c5aa0;
            text-transform: uppercase;
        }
        
        .sunday-card h4 {
            margin: 0 0 6px 0;
            font-size: 8pt;
            font-weight: 600;
            color: #856404;
            text-transform: uppercase;
        }
        
        .summary-value {
            font-size: 14px;
            font-weight: 700;
            color: #2c5aa0;
            margin-bottom: 2px;
        }
        
        .sunday-value {
            font-size: 14px;
            font-weight: 700;
            color: #856404;
            margin-bottom: 2px;
        }
        
        .summary-label {
            font-size: 8pt;
            color: #666;
            font-weight: 500;
        }
        
        .sunday-label {
            font-size: 8pt;
            color: #856404;
            font-weight: 500;
        }
        
        .attendance-table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
            border: 1px solid #ddd;
            font-size: 8pt;
            page-break-inside: avoid;
        }
        
        .attendance-table th {
            background: #2c5aa0;
            color: white;
            padding: 6px 4px;
            text-align: center;
            font-weight: 600;
            border: 1px solid #2c5aa0;
        }
        
        .attendance-table td {
            padding: 4px 4px;
            border: 1px solid #ddd;
            color: #333;
            text-align: center;
        }
        
        .footer {
            background: #f8f9fa;
            padding: 10px 15px;
            text-align: center;
            font-size: 8pt;
            color: #666;
            border-top: 1px solid #e9ecef;
            margin-top: 15px;
            page-break-inside: avoid;
        }

        .status-dayoff {
            color: #6c757d;
            font-weight: 600;
        }

        .tagline {
            text-align: center;
            font-weight: bold;
            font-size: 10pt;
            margin: 15px 0 8px 0;
            color: #2c5aa0;
            padding-top: 8px;
            border-top: 1px solid #e9ecef;
            page-break-inside: avoid;
        }

        .page-break {
            page-break-before: always;
        }

        .no-break {
            page-break-inside: avoid;
        }

        .compact {
            margin-bottom: 8px;
        }

        @media print {
            body {
                background: white;
                margin: 0;
                padding: 0;
            }
            
            .payslip-container {
                margin: 0;
            }
            
            .content {
                padding: 0 10px 10px 10px;
            }
            
            .document-title {
                margin: 8px 0 12px 0;
            }

            .section {
                margin-bottom: 8px;
            }
        }
    </style>
</head>
<body>
    <div class="payslip-container">
        <div class="header">
            <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg" alt="Company Logo">
            <div class="company-names">
                <div class="company-name-arabic">الغزال الأبيض للخدمات الفنية</div>
                <div class="company-name-english">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
            </div>
        </div>
        
        <div class="document-title">
            SALARY SLIP FOR THE MONTH OF ${data.periodText}
        </div>
        
        <div class="content">
            <!-- Employee Information Section -->
            <div class="section no-break">
                <div class="section-title">Employee Information</div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Employee Name</span>
                        <span class="info-value">${data.employeeName}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Designation</span>
                        <span class="info-value">${data.designation}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Account Number</span>
                        <span class="info-value">${data.accountNumber || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">IBAN Number</span>
                        <span class="info-value">${data.ibanNumber}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Passport Number</span>
                        <span class="info-value">${data.passportNumber}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Passport Expiry</span>
                        <span class="info-value">${data.passportExpiry || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Labour Card Number</span>
                        <span class="info-value">${data.labourCard}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Labour Card Personal Number</span>
                        <span class="info-value">${data.labourCardPersonalNo}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Labour Card Expiry</span>
                        <span class="info-value">${data.labourCardExpiry || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Emirates ID</span>
                        <span class="info-value">${data.emiratesId}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Emirates ID Expiry</span>
                        <span class="info-value">${data.emiratesIdExpiry || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Working Days</span>
                        <span class="info-value">${data.attendanceDetails.summary.presentDays} Days</span>
                    </div>
                </div>
            </div>
            
            <!-- Salary Details Section -->
            <div class="section no-break">
                <div class="section-title">Salary Details</div>
                <table class="salary-table">
                    <thead>
                        <tr>
                            <th style="width: 25%;">EARNINGS</th>
                            <th style="width: 15%;" class="amount">AMOUNT (AED)</th>
                            <th style="width: 25%;">DEDUCTIONS</th>
                            <th style="width: 15%;" class="amount">AMOUNT (AED)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Basic Salary</td>
                            <td class="amount">${data.basicSalary.toFixed(2)}</td>
                            <td>Food Allowance</td>
                            <td class="amount">${data.mess.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Allowance</td>
                            <td class="amount">${data.allowance.toFixed(2)}</td>
                            <td>Salary Advance</td>
                            <td class="amount">${data.salaryAdvance.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Transport</td>
                            <td class="amount">${data.transport.toFixed(2)}</td>
                            <td>Loan Deduction</td>
                            <td class="amount">${data.loanDeduction.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Overtime</td>
                            <td class="amount">${data.overtime.toFixed(2)}</td>
                            <td>Fine Amount</td>
                            <td class="amount">${data.fineAmount.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Special OT</td>
                            <td class="amount">${data.specialOT.toFixed(2)}</td>
                            <td>Visa Deduction</td>
                            <td class="amount">${data.visaDeduction.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Medical</td>
                            <td class="amount">${data.medical.toFixed(2)}</td>
                            <td></td>
                            <td class="amount"></td>
                        </tr>
                        <tr>
                            <td>Bonus</td>
                            <td class="amount">${data.bonus.toFixed(2)}</td>
                            <td></td>
                            <td class="amount"></td>
                        </tr>
                    </tbody>
                </table>
                
                <div class="summary-section">
                    <div class="summary-row">
                        <span>Total Earnings</span>
                        <span style="font-weight: 600;">${data.totalEarnings.toFixed(2)} AED</span>
                    </div>
                    <div class="summary-row">
                        <span>Total Deductions</span>
                        <span style="font-weight: 600;">${data.totalDeductions.toFixed(2)} AED</span>
                    </div>
                    <div class="summary-row total">
                        <span>NET PAY</span>
                        <span>${data.net.toFixed(2)} AED</span>
                    </div>
                </div>
                
                <div class="net-pay">
                    <div class="net-pay-label">AMOUNT IN WORDS</div>
                    <div class="net-pay-amount">${data.netInWords}</div>
                </div>
            </div>
            
            <!-- Attendance Summary Section -->
            <div class="section no-break">
                <div class="section-title">Attendance Summary</div>
                <div class="attendance-summary">
                    <div class="attendance-summary-grid">
                        <div class="summary-card">
                            <h4>Total Working Days</h4>
                            <div class="summary-value">${data.attendanceDetails.summary.presentDays}</div>
                            <div class="summary-label">Days</div>
                        </div>
                        
                        <div class="summary-card">
                            <h4>Regular Hours</h4>
                            <div class="summary-value">${data.attendanceDetails.summary.totalHours}</div>
                            <div class="summary-label">Hours</div>
                        </div>
                        
                        <div class="summary-card">
                            <h4>Overtime Hours</h4>
                            <div class="summary-value">${data.attendanceDetails.summary.overtimeHours}</div>
                            <div class="summary-label">Hours</div>
                        </div>
                        
                        ${data.attendanceDetails.summary.sundayWorkingDays > 0 ? `
                        <div class="sunday-card">
                            <h4>🌟 Sunday Working</h4>
                            <div class="sunday-value">${data.attendanceDetails.summary.sundayWorkingDays}</div>
                            <div class="sunday-label">Days</div>
                        </div>
                        ` : `
                        <div class="summary-card" style="opacity: 0.6;">
                            <h4>Sunday Working</h4>
                            <div class="summary-value">0</div>
                            <div class="summary-label">Days</div>
                        </div>
                        `}
                    </div>
                    
                    ${data.attendanceDetails.summary.sundayOvertimeHours > 0 ? `
                    <div style="margin-top: 8px; text-align: center;">
                        <div style="display: inline-block; background: #fff9e6; padding: 6px 12px; border-radius: 3px; border: 1px solid #ffc107;">
                            <strong style="color: #856404; font-size: 8pt;">Sunday Overtime Hours: ${data.attendanceDetails.summary.sundayOvertimeHours} Hours</strong>
                        </div>
                    </div>
                    ` : ''}
                </div>
                
                <table class="attendance-table">
                    <thead>
                        <tr>
                            <th style="width: 8%;">S.NO</th>
                            <th style="width: 15%;">DATE</th>
                            <th style="width: 15%;">DAY</th>
                            <th style="width: 12%;">STATUS</th>
                            <th style="width: 15%;">REGULAR HOURS</th>
                            <th style="width: 15%;">OT HOURS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${attendanceRows}
                    </tbody>
                </table>
            </div>
            
            ${data.remark ? `
            <div class="section no-break">
                <div class="section-title">Remarks</div>
                <div style="color: #666; font-size: 9pt; padding: 8px; background: #f8f9fa; border-radius: 3px; border-left: 3px solid #2c5aa0;">
                    ${data.remark}
                </div>
            </div>
            ` : ''}

            <div class="tagline">We work U Relax</div>
        </div>
        
        <div class="footer">
            <p><strong>Note:</strong> This is a computer-generated payslip and does not require a signature.</p>
            <p style="margin-top: 3px;"><em>Sunday working days are highlighted in yellow in the attendance table.</em></p>
            <p style="margin-top: 5px;"><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
            <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
            <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/">www.alghazalgroup.com</a></p>
            <p style="margin-top: 6px;">Generated on ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
        </div>
    </div>
</body>
</html>
  `;
};

// Generate payslip PDF
export const generatePayslipPDF = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const payroll = await Payroll.findById(id).populate<{ employee: IUser }>({
    path: 'employee',
    select: 'firstName lastName role emiratesId passportNumber iBANNumber'
  });

  if (!payroll) {
    throw new ApiError(404, "Payroll record not found");
  }

  if (!payroll.employee || typeof payroll.employee !== 'object') {
    throw new ApiError(500, "Employee data not properly populated");
  }

  const employeeExpense = await EmployeeExpense.findOne({
    employee: payroll.employee._id
  }).lean();

  // Get visa expense data for additional employee information
  const visaExpense = await VisaExpense.findOne({
    employee: payroll.employee._id
  }).lean();

  const basicSalary = employeeExpense?.basicSalary || 0;
  const totalEarnings = basicSalary + payroll.allowance + payroll.transport +
    payroll.overtime + payroll.specialOT + payroll.medical + payroll.bonus;
  const totalDeductions = payroll.mess + payroll.salaryAdvance +
    payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction; // UPDATED

  const attendanceDetails = await getAttendanceDetails(payroll.employee._id, payroll.period);

  const [month, year] = payroll.period.split('-');
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const periodText = `${monthNames[parseInt(month) - 1]} ${year}`;

  // Format date function
  const formatDate = (date: Date | string | undefined): string => {
    if (!date) return 'N/A';
    const d = new Date(date);
    return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const payslipData = {
    employeeName: `${payroll.employee.firstName} ${payroll.employee.lastName}`.toUpperCase(),
    designation: payroll.employee.role.toUpperCase(),
    emiratesId: payroll.employee.emiratesId || 'N/A',
    emiratesIdExpiry: formatDate(visaExpense?.emirateIdExpireDate),
    passportNumber: payroll.employee.passportNumber || 'N/A',
    passportExpiry: formatDate(visaExpense?.passportExpireDate),
    ibanNumber: payroll.employee.iBANNumber || 'N/A',
    accountNumber: payroll.employee.accountNumber || 'N/A',
    // bankName: 'Emirates NBD',
    labourCard: payroll.labourCard,
    labourCardPersonalNo: payroll.labourCardPersonalNo,
    labourCardExpiry: formatDate(visaExpense?.labourExpireDate),
    period: payroll.period,
    periodText,
    basicSalary,
    allowance: payroll.allowance,
    transport: payroll.transport,
    overtime: payroll.overtime,
    specialOT: payroll.specialOT || 0,
    medical: payroll.medical,
    bonus: payroll.bonus,
    mess: payroll.mess,
    salaryAdvance: payroll.salaryAdvance,
    loanDeduction: payroll.loanDeduction,
    fineAmount: payroll.fineAmount,
    visaDeduction: payroll.visaDeduction || 0, // NEW FIELD
    totalEarnings,
    totalDeductions,
    net: payroll.net,
    netInWords: convertToWords(payroll.net),
    remark: payroll.remark,
    attendanceDetails
  };

  const html = generatePayslipHTML(payslipData);

  const browser = await puppeteer.launch({
    headless: "shell",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });

    await page.setContent(html, {
      waitUntil: ['load', 'networkidle0', 'domcontentloaded'],
      timeout: 30000
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0.3cm',
        right: '0.3cm',
        bottom: '0.3cm',
        left: '0.3cm'
      },
      displayHeaderFooter: false,
      preferCSSPageSize: true
    });

    const filename = `payslip_${payroll.employee.firstName}_${payroll.employee.lastName}_${payroll.period}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("PDF generation error:", error);
    throw new ApiError(500, "Failed to generate PDF");
  } finally {
    await browser.close();
  }
});

// Get payslip data (preview without PDF generation)
export const getPayslipData = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const payroll = await Payroll.findById(id).populate<{ employee: IUser }>({
    path: 'employee',
    select: 'firstName lastName role emiratesId passportNumber iBANNumber'
  });

  if (!payroll) {
    throw new ApiError(404, "Payroll record not found");
  }

  if (!payroll.employee || typeof payroll.employee !== 'object') {
    throw new ApiError(500, "Employee data not properly populated");
  }

  const employeeExpense = await EmployeeExpense.findOne({
    employee: payroll.employee._id
  }).lean();

  const basicSalary = employeeExpense?.basicSalary || 0;
  const totalEarnings = basicSalary + payroll.allowance + payroll.transport +
    payroll.overtime + payroll.specialOT + payroll.medical + payroll.bonus;
  const totalDeductions = payroll.mess + payroll.salaryAdvance +
    payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction; // UPDATED

  const attendanceDetails = await getAttendanceDetails(payroll.employee._id, payroll.period);

  const [month, year] = payroll.period.split('-');
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const periodText = `${monthNames[parseInt(month) - 1]} ${year}`;

  const payslipData = {
    employeeName: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
    designation: payroll.employee.role,
    emiratesId: payroll.employee.emiratesId || 'N/A',
    passportNumber: payroll.employee.passportNumber || 'N/A',
    ibanNumber: payroll.employee.iBANNumber || 'N/A',
    labourCard: payroll.labourCard,
    labourCardPersonalNo: payroll.labourCardPersonalNo,
    period: payroll.period,
    periodText,
    basicSalary,
    allowance: payroll.allowance,
    transport: payroll.transport,
    overtime: payroll.overtime,
    specialOT: payroll.specialOT || 0,
    medical: payroll.medical,
    bonus: payroll.bonus,
    mess: payroll.mess,
    salaryAdvance: payroll.salaryAdvance,
    loanDeduction: payroll.loanDeduction,
    fineAmount: payroll.fineAmount,
    visaDeduction: payroll.visaDeduction || 0, // NEW FIELD
    totalEarnings,
    totalDeductions,
    net: payroll.net,
    netInWords: convertToWords(payroll.net),
    remark: payroll.remark,
    attendanceDetails
  };

  res.status(200).json(
    new ApiResponse(200, payslipData, "Payslip data retrieved successfully")
  );
});