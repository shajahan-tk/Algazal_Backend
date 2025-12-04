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

// Comprehensive salary calculation based on attendance
export const calculateSalaryBasedOnAttendance = async (
  userId: Types.ObjectId,
  basicSalary: number,
  allowance: number,
  period: string
) => {
  try {
    const [monthStr, yearStr] = period.split('-');
    const month = parseInt(monthStr);
    const year = parseInt(yearStr);

    // Get date range for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const daysInMonth = endDate.getDate();

    console.log(`Calculating salary for ${period}, Days in month: ${daysInMonth}`);

    // Get all attendance records for the month
    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: startDate, $lte: endDate }
    });

    // Initialize counters
    let regularWorkedDays = 0; // Mon-Sat days with ANY hours worked
    let sundayWorkingDays = 0; // Sundays worked (any hours = full bonus)
    let paidLeaveDays = 0; // Paid leave days (no pay, no bonus, no deduction)
    let absentDays = 0; // Absent days (deducted from base salary)
    let totalRegularHours = 0; // Mon-Sat actual working hours
    let totalOvertimeHours = 0; // Mon-Sat overtime hours
    let sundayOvertimeHours = 0; // Sunday overtime hours

    // Count Sundays in the month
    let totalSundays = 0;
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      if (currentDate.getDay() === 0) {
        totalSundays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Process each attendance record
    attendances.forEach(att => {
      const date = new Date(att.date);
      const isSunday = date.getDay() === 0;

      if (att.isPaidLeave) {
        // ✅ PAID LEAVE: Count as paid leave day (no pay, no bonus, NO deduction from base)
        paidLeaveDays++;
      } else if (!att.present) {
        // ✅ ABSENT: Count as absent day (will be deducted from base salary)
        absentDays++;
      } else if (att.present) {
        // ✅ PRESENT AND WORKED
        const workingHours = att.workingHours || 0;
        const overtime = att.overtimeHours || 0;

        if (isSunday) {
          // ✅ SUNDAY: Any hours worked = full day bonus
          if (workingHours > 0) {
            sundayWorkingDays++;
          }
          sundayOvertimeHours += overtime;
        } else {
          // ✅ MON-SAT: ANY hours worked = full day pay
          if (workingHours > 0) {
            regularWorkedDays++;
            // Track actual hours for display
            totalRegularHours += workingHours;
            totalOvertimeHours += overtime;
          }
        }
      }
    });

    // ✅ NEW CALCULATION FORMULAS
    // 1. Total Monthly Salary = Basic + Allowance
    const totalMonthlySalary = basicSalary + allowance;

    // 2. Daily Rate = Total Monthly Salary ÷ Total days in month
    const dailyRate = daysInMonth > 0 ? totalMonthlySalary / daysInMonth : 0;

    // 3. Overtime Hourly Rate: Basic salary ÷ ALL days ÷ 10 hours per day
    const overtimeHourlyRate = daysInMonth > 0 ? basicSalary / daysInMonth / 10 : 0;

    console.log('✅ NEW Salary Calculation Details:', {
      totalMonthlySalary: totalMonthlySalary.toFixed(2),
      daysInMonth,
      dailyRate: dailyRate.toFixed(2),
      overtimeHourlyRate: overtimeHourlyRate.toFixed(2),
      totalSundays,
      regularWorkedDays: regularWorkedDays + ' (Mon-Sat with hours)',
      sundayWorkingDays: sundayWorkingDays + ' (Sundays with hours)',
      paidLeaveDays: paidLeaveDays + ' (NO PAY, NO BONUS, NO DEDUCTION)',
      absentDays: absentDays + ' (WILL BE DEDUCTED FROM BASE)',
      totalRegularHours: totalRegularHours.toFixed(2) + ' hours',
      totalOvertimeHours: totalOvertimeHours.toFixed(2) + ' hours',
      sundayOvertimeHours: sundayOvertimeHours.toFixed(2) + ' hours'
    });

    // ✅ NEW CALCULATION LOGIC
    // 1. Start with FULL monthly salary (basic + allowance)
    const baseMonthlySalary = totalMonthlySalary;

    // 2. Calculate Sunday Bonus (for Sundays worked)
    const sundayBonus = sundayWorkingDays * dailyRate;

    // 3. Calculate Overtime Amount
    const regularOvertimeAmount = totalOvertimeHours * overtimeHourlyRate;
    const sundayOvertimeAmount = sundayOvertimeHours * overtimeHourlyRate;
    const totalOvertimeAmount = regularOvertimeAmount + sundayOvertimeAmount;

    // 4. Calculate Absent Deduction (only for absent days)
    const absentDeduction = absentDays * dailyRate;

    // 5. Total Earnings Calculation
    //    Base Salary + Sunday Bonus + Overtime - Absent Deduction
    //    Paid leave days are ignored (no pay, no bonus, no deduction)
    const totalEarnings = baseMonthlySalary + sundayBonus + totalOvertimeAmount - absentDeduction;

    console.log('✅ NEW Calculation Breakdown:', {
      baseMonthlySalary: baseMonthlySalary.toFixed(2),
      sundayBonus: sundayBonus.toFixed(2),
      regularOvertimeAmount: regularOvertimeAmount.toFixed(2),
      sundayOvertimeAmount: sundayOvertimeAmount.toFixed(2),
      totalOvertimeAmount: totalOvertimeAmount.toFixed(2),
      absentDeduction: absentDeduction.toFixed(2),
      paidLeaveDays: paidLeaveDays + ' days (ignored in calculation)',
      totalEarnings: totalEarnings.toFixed(2),
      calculationFormula: 'Base + Sunday Bonus + Overtime - Absent Deduction'
    });

    return {
      // For payroll display
      baseSalaryAmount: Math.round(baseMonthlySalary * 100) / 100,
      overtimeAmount: Math.round(totalOvertimeAmount * 100) / 100,
      sundayBonus: Math.round(sundayBonus * 100) / 100,
      absentDeduction: Math.round(absentDeduction * 100) / 100, // NEW FIELD
      totalEarnings: Math.round(totalEarnings * 100) / 100,

      attendanceSummary: {
        totalMonthDays: daysInMonth,
        totalSundays,
        paidLeaveDays, // These days get NO PAY, NO BONUS, and NO DEDUCTION
        absentDays, // These days get DEDUCTED from base salary
        regularWorkedDays, // Mon-Sat with hours (just for info)
        sundayWorkingDays, // Sundays with hours = Full day bonus
        totalRegularHours, // Total hours worked Mon-Sat (for display)
        totalOvertimeHours, // Overtime hours Mon-Sat
        sundayOvertimeHours // Overtime hours Sunday
      },

      rates: {
        dailyRate: Math.round(dailyRate * 100) / 100,
        overtimeHourlyRate: Math.round(overtimeHourlyRate * 100) / 100
      },

      calculationBreakdown: {
        baseSalary: {
          basic: basicSalary,
          allowance: allowance,
          total: baseMonthlySalary,
          note: "Full monthly salary (basic + allowance)"
        },
        sundayBonus: {
          days: sundayWorkingDays,
          dailyRate: Math.round(dailyRate * 100) / 100,
          amount: Math.round(sundayBonus * 100) / 100,
          rule: "Any hours worked on Sunday = Full day bonus"
        },
        regularOvertime: {
          hours: totalOvertimeHours,
          rate: Math.round(overtimeHourlyRate * 100) / 100,
          amount: Math.round(regularOvertimeAmount * 100) / 100
        },
        sundayOvertime: {
          hours: sundayOvertimeHours,
          rate: Math.round(overtimeHourlyRate * 100) / 100,
          amount: Math.round(sundayOvertimeAmount * 100) / 100
        },
        absentDeduction: {
          days: absentDays,
          dailyRate: Math.round(dailyRate * 100) / 100,
          amount: Math.round(absentDeduction * 100) / 100,
          rule: "Absent days deducted from base salary"
        },
        paidLeave: {
          days: paidLeaveDays,
          note: "No pay, no bonus, no deduction from base salary"
        }
      },
      period
    };

  } catch (error) {
    console.error("Error calculating salary based on attendance:", error);
    return {
      baseSalaryAmount: 0,
      overtimeAmount: 0,
      sundayBonus: 0,
      absentDeduction: 0,
      totalEarnings: 0,
      attendanceSummary: {
        totalMonthDays: 0,
        totalSundays: 0,
        paidLeaveDays: 0,
        absentDays: 0,
        regularWorkedDays: 0,
        sundayWorkingDays: 0,
        totalRegularHours: 0,
        totalOvertimeHours: 0,
        sundayOvertimeHours: 0
      },
      rates: {
        dailyRate: 0,
        overtimeHourlyRate: 0
      },
      calculationBreakdown: {
        baseSalary: {
          basic: 0,
          allowance: 0,
          total: 0,
          note: "Full monthly salary (basic + allowance)"
        },
        sundayBonus: {
          days: 0,
          dailyRate: 0,
          amount: 0,
          rule: "Any hours worked on Sunday = Full day bonus"
        },
        regularOvertime: { hours: 0, rate: 0, amount: 0 },
        sundayOvertime: { hours: 0, rate: 0, amount: 0 },
        absentDeduction: {
          days: 0,
          dailyRate: 0,
          amount: 0,
          rule: "Absent days deducted from base salary"
        },
        paidLeave: {
          days: 0,
          note: "No pay, no bonus, no deduction from base salary"
        }
      },
      period: ''
    };
  }
};

// Enhanced employee summary with calculation details
export const getEmployeeSummary = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) throw new ApiError(400, "User ID is required");

  const user = await User.findById(id).select("-password");
  if (!user) throw new ApiError(404, "User not found");

  // Get employee expense details
  const employeeExpense = await EmployeeExpense.findOne({ employee: user._id });
  const basicSalary = Number(employeeExpense?.basicSalary) || 0;
  const allowance = Number(employeeExpense?.allowance) || 0;

  // Get current period for calculation
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const period = `${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${prevMonth.getFullYear()}`;

  // Calculate salary with new system
  const salaryData = await calculateSalaryBasedOnAttendance(user._id, basicSalary, allowance, period);

  const visaExpense = await VisaExpense.findOne({ employee: user._id })
    .sort({ createdAt: -1 })
    .select("labourCardPersonalNumber workPermitNumber passportNumber emirateIdNumber iBan total")
    .lean();

  // Prepare detailed calculation breakdown for frontend
  const calculationDetails = {
    formulas: {
      dailyRate: `(Basic ${basicSalary} + Allowance ${allowance}) ÷ ${salaryData.attendanceSummary.totalMonthDays} days = ${salaryData.rates.dailyRate} AED/day`,
      overtimeRate: `Basic ${basicSalary} ÷ ${salaryData.attendanceSummary.totalMonthDays} days ÷ 10 hours = ${salaryData.rates.overtimeHourlyRate} AED/hour`,
      totalEarnings: `Base Salary (${salaryData.calculationBreakdown.baseSalary.total}) + Sunday Bonus (${salaryData.sundayBonus}) + Overtime (${salaryData.overtimeAmount}) - Absent Deduction (${salaryData.absentDeduction}) = ${salaryData.totalEarnings} AED`
    },
    rules: {
      baseSalary: "Full monthly salary (Basic + Allowance)",
      sundayRule: "ANY hours worked on Sunday = FULL day bonus",
      absentRule: "Absent days = Deduction from base salary",
      paidLeave: "Paid leave = No pay, no bonus, no deduction",
      overtime: "Overtime calculated separately for hours beyond regular work"
    }
  };

  const response = {
    employee: {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      basicSalary,
      allowance,
      phoneNumbers: user.phoneNumbers,
      accountNumber: user.accountNumber,
      emiratesId: user.emiratesId,
      passportNumber: user.passportNumber,
      iBANNumber: user.iBANNumber,
      address: user.address,
    },
    salaryCalculation: {
      baseSalaryAmount: salaryData.baseSalaryAmount,
      overtimeAmount: salaryData.overtimeAmount,
      sundayBonus: salaryData.sundayBonus,
      absentDeduction: salaryData.absentDeduction, // NEW
      totalEarnings: salaryData.totalEarnings,
      attendanceSummary: salaryData.attendanceSummary,
      rates: salaryData.rates,
      calculationBreakdown: salaryData.calculationBreakdown,
      period,
    },
    overtime: {
      previousMonthAmount: salaryData.overtimeAmount,
      previousMonthHours: salaryData.attendanceSummary.totalOvertimeHours + salaryData.attendanceSummary.sundayOvertimeHours,
      hourlyRate: salaryData.rates.overtimeHourlyRate,
      daysInMonth: salaryData.attendanceSummary.totalMonthDays,
      period,
    },
    visaDetails: visaExpense
      ? {
        labourCardPersonalNumber: visaExpense.labourCardPersonalNumber,
        workPermitNumber: visaExpense.workPermitNumber,
        passportNumber: visaExpense.passportNumber,
        emirateIdNumber: visaExpense.emirateIdNumber,
        iBan: visaExpense.iBan,
        totalVisaExpenses: visaExpense.total,
      }
      : null,
    calculationDetails: calculationDetails
  };

  res.status(200).json(new ApiResponse(200, response, "Employee summary retrieved successfully"));
});

// Create payroll with new calculation system
export const createPayroll = asyncHandler(async (req: Request, res: Response) => {
  // Get all required fields from request body
  let { employee, labourCard, labourCardPersonalNo, transport, medical, bonus, specialOT, mess, salaryAdvance, loanDeduction, fineAmount, visaDeduction, remark } = req.body;

  console.log('Creating payroll with new attendance-based calculation:', req.body);

  // Convert all numeric fields to numbers
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

  // Fetch basicSalary and allowance from EmployeeExpense for calculation
  const employeeExpense = await EmployeeExpense.findOne({ employee });
  const basicSalary = Number(employeeExpense?.basicSalary) || 0;
  const allowance = Number(employeeExpense?.allowance) || 0;

  // Use new attendance-based calculation
  const salaryData = await calculateSalaryBasedOnAttendance(employee, basicSalary, allowance, period);

  // The base salary is the FULL monthly salary (basic + allowance)
  const baseSalaryFromAttendance = salaryData.baseSalaryAmount;
  const overtime = salaryData.overtimeAmount;
  const absentDeduction = salaryData.absentDeduction || 0;

  // Calculate total earnings: Base salary + overtime + Sunday bonus - absent deduction + other allowances
  const totalEarnings = baseSalaryFromAttendance + transport + overtime + specialOT + medical + bonus + salaryData.sundayBonus - absentDeduction;
  const totalDeductions = mess + salaryAdvance + loanDeduction + fineAmount + visaDeduction;
  const net = totalEarnings - totalDeductions;

  const payroll = await Payroll.create({
    employee,
    labourCard,
    labourCardPersonalNo,
    period,
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
    createdBy: req.user?.userId,
    calculationDetails: {
      baseSalaryFromAttendance,
      sundayBonus: salaryData.sundayBonus,
      absentDeduction: absentDeduction,
      attendanceSummary: salaryData.attendanceSummary,
      rates: salaryData.rates,
      calculationBreakdown: salaryData.calculationBreakdown
    }
  });

  console.log(`Payroll created successfully for period ${period}`);
  console.log('NEW Salary Calculation:', {
    basicSalary,
    allowance,
    totalMonthlySalary: basicSalary + allowance,
    dailyRate: salaryData.rates.dailyRate,
    absentDays: salaryData.attendanceSummary.absentDays,
    absentDeduction,
    sundayWorkingDays: salaryData.attendanceSummary.sundayWorkingDays,
    baseSalaryFromAttendance,
    overtime,
    sundayBonus: salaryData.sundayBonus,
    transport,
    specialOT,
    medical,
    bonus,
    totalEarnings,
    totalDeductions,
    net,
    calculationFormula: "Base + Sunday Bonus + Overtime - Absent Deduction + Other Allowances - Deductions"
  });

  res.status(201).json(
    new ApiResponse(201, {
      payroll,
      calculationDetails: salaryData
    }, "Payroll created successfully with attendance-based calculation")
  );
});

// Get single payroll record with calculation details
export const getPayroll = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const payroll = await Payroll.findById(id)
    .populate<{ employee: IUser }>({ path: 'employee', select: 'firstName lastName role emiratesId' })
    .populate<{ createdBy: IUser }>({ path: 'createdBy', select: 'firstName lastName' });

  if (!payroll) {
    throw new ApiError(404, "Payroll not found");
  }

  if (!payroll.employee || typeof payroll.employee !== 'object') {
    throw new ApiError(500, "Employee data not properly populated");
  }

  const employeeExpense = await EmployeeExpense.findOne({ employee: payroll.employee._id }).lean();

  // Use calculation details if available, otherwise calculate
  let calculationDetails: any = payroll.calculationDetails;
  if (!calculationDetails) {
    const basicSalary = employeeExpense?.basicSalary || 0;
    const allowance = employeeExpense?.allowance || 0;
    calculationDetails = await calculateSalaryBasedOnAttendance(payroll.employee._id, basicSalary, allowance, payroll.period);
  }

  const absentDeduction = calculationDetails.absentDeduction || 0;
  const totalEarnings = calculationDetails.totalEarnings + payroll.transport + payroll.specialOT + payroll.medical + payroll.bonus;
  const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction;

  const enhancedPayroll = {
    ...payroll.toObject(),
    name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
    designation: payroll.employee.role,
    emiratesId: payroll.employee.emiratesId || 'N/A',
    basicSalary: calculationDetails.baseSalaryAmount,
    absentDeduction: absentDeduction,
    totalEarnings,
    totalDeductions,
    calculationDetails,
    createdByName: payroll.createdBy ? `${payroll.createdBy.firstName} ${payroll.createdBy.lastName}` : 'System'
  };

  res.status(200).json(
    new ApiResponse(200, enhancedPayroll, "Payroll retrieved successfully")
  );
});

// Get all payroll records
export const getPayrolls = asyncHandler(async (req: Request, res: Response) => {
  const { employee, labourCard, labourCardPersonalNo, startDate, endDate, month, year, page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  interface PayrollFilter {
    employee?: Types.ObjectId | string;
    labourCard?: string;
    labourCardPersonalNo?: string;
    createdAt?: { $gte?: Date; $lte?: Date };
  }

  const filter: PayrollFilter = {};
  if (employee) filter.employee = new Types.ObjectId(employee as string);
  if (labourCard) filter.labourCard = labourCard as string;
  if (labourCardPersonalNo) filter.labourCardPersonalNo = labourCardPersonalNo as string;

  if (!filter.createdAt) filter.createdAt = {};
  if (startDate && endDate) {
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new ApiError(400, "Invalid date format in startDate or endDate");
    }
    filter.createdAt = { $gte: start, $lte: end };
  } else if (year) {
    const yearNum = parseInt(year as string);
    if (isNaN(yearNum)) throw new ApiError(400, "Invalid year value");

    if (month) {
      const monthNum = parseInt(month as string);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new ApiError(400, "Invalid month value (1-12)");
      }
      const startDateOfMonth = new Date(yearNum, monthNum - 1, 1);
      const endDateOfMonth = new Date(yearNum, monthNum, 0);
      filter.createdAt = { $gte: startDateOfMonth, $lte: endDateOfMonth };
    } else {
      filter.createdAt = { $gte: new Date(yearNum, 0, 1), $lte: new Date(yearNum + 1, 0, 1) };
    }
  }

  const total = await Payroll.countDocuments(filter);
  const payrolls = await Payroll.find(filter)
    .skip(skip)
    .limit(Number(limit))
    .sort({ createdAt: -1 })
    .populate<{ employee: IUser }>({ path: 'employee', select: 'firstName lastName role emiratesId' })
    .populate<{ createdBy: IUser }>({ path: 'createdBy', select: 'firstName lastName' });

  const enhancedPayrolls = await Promise.all(
    payrolls.map(async (payroll) => {
      if (!payroll.employee || typeof payroll.employee !== 'object') {
        throw new Error('Employee data not properly populated');
      }

      const employeeExpense = await EmployeeExpense.findOne({ employee: payroll.employee._id }).lean();

      // Use calculation details if available
      let calculationDetails: any = payroll.calculationDetails;
      if (!calculationDetails) {
        const basicSalary = employeeExpense?.basicSalary || 0;
        const allowance = employeeExpense?.allowance || 0;
        calculationDetails = await calculateSalaryBasedOnAttendance(payroll.employee._id, basicSalary, allowance, payroll.period);
      }

      const absentDeduction = calculationDetails.absentDeduction || 0;
      const totalEarnings = calculationDetails.totalEarnings + payroll.transport + payroll.specialOT + payroll.medical + payroll.bonus;
      const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction;

      return {
        _id: payroll._id,
        name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
        designation: payroll.employee.role,
        emiratesId: payroll.employee.emiratesId || 'N/A',
        labourCard: payroll.labourCard,
        labourCardPersonalNo: payroll.labourCardPersonalNo,
        period: payroll.period,
        basicSalary: calculationDetails.baseSalaryAmount,
        transport: payroll.transport,
        overtime: payroll.overtime,
        specialOT: payroll.specialOT || 0,
        medical: payroll.medical,
        bonus: payroll.bonus,
        absentDeduction: absentDeduction,
        sundayBonus: calculationDetails.sundayBonus || 0,
        totalEarnings,
        mess: payroll.mess,
        salaryAdvance: payroll.salaryAdvance,
        loanDeduction: payroll.loanDeduction,
        fineAmount: payroll.fineAmount,
        visaDeduction: payroll.visaDeduction || 0,
        totalDeductions,
        net: payroll.net,
        remark: payroll.remark,
        calculationDetails,
        createdBy: payroll.createdBy ? `${payroll.createdBy.firstName} ${payroll.createdBy.lastName}` : 'System',
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

// Update payroll record
export const updatePayroll = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updateData = req.body;

  const payroll = await Payroll.findById(id);
  if (!payroll) {
    throw new ApiError(404, "Payroll not found");
  }

  // Don't allow period or overtime to be changed (overtime is auto-calculated)
  delete updateData.period;
  delete updateData.overtime;

  // Validate if employee is being changed
  if (updateData.employee) {
    const employeeId = updateData.employee;
    const period = payroll.period;
    const existingPayroll = await Payroll.findOne({ _id: { $ne: id }, employee: employeeId, period });
    if (existingPayroll) {
      throw new ApiError(400, "Payroll already exists for this employee and period");
    }
  }

  // Convert all numeric fields to numbers
  if (updateData.transport !== undefined) updateData.transport = Number(updateData.transport) || 0;
  if (updateData.specialOT !== undefined) updateData.specialOT = Number(updateData.specialOT) || 0;
  if (updateData.medical !== undefined) updateData.medical = Number(updateData.medical) || 0;
  if (updateData.bonus !== undefined) updateData.bonus = Number(updateData.bonus) || 0;
  if (updateData.mess !== undefined) updateData.mess = Number(updateData.mess) || 0;
  if (updateData.salaryAdvance !== undefined) updateData.salaryAdvance = Number(updateData.salaryAdvance) || 0;
  if (updateData.loanDeduction !== undefined) updateData.loanDeduction = Number(updateData.loanDeduction) || 0;
  if (updateData.fineAmount !== undefined) updateData.fineAmount = Number(updateData.fineAmount) || 0;
  if (updateData.visaDeduction !== undefined) updateData.visaDeduction = Number(updateData.visaDeduction) || 0;

  // Fetch employee expense to get basicSalary and allowance for recalculation
  const employeeExpense = await EmployeeExpense.findOne({
    employee: updateData.employee || payroll.employee
  });
  const basicSalary = Number(employeeExpense?.basicSalary) || 0;
  const allowance = Number(employeeExpense?.allowance) || 0;

  // Use updated values if provided, otherwise keep existing
  const transport = updateData.transport !== undefined ? updateData.transport : payroll.transport;
  const specialOT = updateData.specialOT !== undefined ? updateData.specialOT : (payroll.specialOT || 0);
  const medical = updateData.medical !== undefined ? updateData.medical : payroll.medical;
  const bonus = updateData.bonus !== undefined ? updateData.bonus : payroll.bonus;
  const mess = updateData.mess !== undefined ? updateData.mess : payroll.mess;
  const salaryAdvance = updateData.salaryAdvance !== undefined ? updateData.salaryAdvance : payroll.salaryAdvance;
  const loanDeduction = updateData.loanDeduction !== undefined ? updateData.loanDeduction : payroll.loanDeduction;
  const fineAmount = updateData.fineAmount !== undefined ? updateData.fineAmount : payroll.fineAmount;
  const visaDeduction = updateData.visaDeduction !== undefined ? updateData.visaDeduction : (payroll.visaDeduction || 0);

  // Recalculate salary with new calculation system
  const salaryData = await calculateSalaryBasedOnAttendance(
    updateData.employee || payroll.employee,
    basicSalary,
    allowance,
    payroll.period
  );

  // Keep existing overtime (it's auto-calculated, shouldn't be changed manually)
  const overtime = salaryData.overtimeAmount;
  const absentDeduction = salaryData.absentDeduction || 0;

  // Recalculate net salary with new system
  const baseSalaryFromAttendance = salaryData.baseSalaryAmount;
  const totalEarnings = baseSalaryFromAttendance + transport + overtime + specialOT + medical + bonus + salaryData.sundayBonus - absentDeduction;
  const totalDeductions = mess + salaryAdvance + loanDeduction + fineAmount + visaDeduction;
  updateData.net = totalEarnings - totalDeductions;

  // Update calculation details
  updateData.calculationDetails = {
    baseSalaryFromAttendance,
    sundayBonus: salaryData.sundayBonus,
    absentDeduction: absentDeduction,
    attendanceSummary: salaryData.attendanceSummary,
    rates: salaryData.rates,
    calculationBreakdown: salaryData.calculationBreakdown
  };

  console.log('Update calculation:', {
    basicSalary,
    allowance,
    totalMonthlySalary: basicSalary + allowance,
    dailyRate: salaryData.rates.dailyRate,
    absentDays: salaryData.attendanceSummary.absentDays,
    absentDeduction,
    sundayWorkingDays: salaryData.attendanceSummary.sundayWorkingDays,
    baseSalaryFromAttendance,
    overtime,
    sundayBonus: salaryData.sundayBonus,
    transport,
    specialOT,
    medical,
    bonus,
    totalEarnings,
    totalDeductions,
    net: updateData.net,
    calculationFormula: "Base + Sunday Bonus + Overtime - Absent Deduction + Other Allowances - Deductions"
  });

  const updatedPayroll = await Payroll.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true
  })
    .populate({ path: "employee", select: "firstName lastName role emiratesId" })
    .populate({ path: "createdBy", select: "firstName lastName" });

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

// Get payslip data (preview without PDF generation)
export const getPayslipData = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const payroll = await Payroll.findById(id).populate<{ employee: IUser }>({
    path: 'employee',
    select: 'firstName lastName role emiratesId passportNumber iBANNumber accountNumber'
  });

  if (!payroll) {
    throw new ApiError(404, "Payroll record not found");
  }

  if (!payroll.employee || typeof payroll.employee !== 'object') {
    throw new ApiError(500, "Employee data not properly populated");
  }

  const employeeExpense = await EmployeeExpense.findOne({ employee: payroll.employee._id }).lean();
  const basicSalary = employeeExpense?.basicSalary || 0;
  const allowance = employeeExpense?.allowance || 0;

  // ✅ Always recalculate to ensure fresh data
  const calculationDetails = await calculateSalaryBasedOnAttendance(
    payroll.employee._id,
    basicSalary,
    allowance,
    payroll.period
  );

  // Get attendance details
  const getAttendanceDetails = async (userId: Types.ObjectId, period: string) => {
    const [monthStr, yearStr] = period.split('-');
    const month = parseInt(monthStr);
    const year = parseInt(yearStr);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });

    let totalHours = 0;
    let overtimeHours = 0;
    let presentDays = 0;
    let sundayWorkingDays = 0;
    let sundayOvertimeHours = 0;
    let regularWorkingDays = 0;
    let totalRegularHours = 0;
    let absentDays = 0;
    let paidLeaveDays = 0;

    const records: any[] = [];
    let sno = 1;

    // Get all dates in the month
    const allDatesInMonth = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      allDatesInMonth.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Create a map of attendance records by date for easy lookup
    const attendanceMap = new Map();
    attendances.forEach(att => {
      const dateKey = new Date(att.date).toDateString();
      attendanceMap.set(dateKey, att);
    });

    // Process all dates in the month
    allDatesInMonth.forEach(date => {
      const dateKey = date.toDateString();
      const att = attendanceMap.get(dateKey);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      const isSunday = date.getDay() === 0;
      const formattedDate = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      let status = 'Absent'; // Default to absent if no attendance record
      let hours = '0';
      let overtimeHoursForDay = '0';

      if (att) {
        if (att.isPaidLeave) {
          status = 'Paid Leave';
          paidLeaveDays++;
        } else if (!att.present) {
          status = 'Absent';
          absentDays++;
        } else if (att.present) {
          const regularHours = att.workingHours || 0;
          const overtime = att.overtimeHours || 0;

          if (isSunday) {
            if (regularHours > 0) {
              sundayWorkingDays++;
              status = 'Present (Sunday)';
            }
            sundayOvertimeHours += overtime;
            hours = regularHours.toFixed(2);
            overtimeHoursForDay = overtime.toFixed(2);
          } else {
            if (regularHours > 0) {
              regularWorkingDays++;
              presentDays++;
              status = 'Present';
            }
            totalRegularHours += regularHours;
            overtimeHours += overtime;
            totalHours += regularHours;
            hours = regularHours.toFixed(2);
            overtimeHoursForDay = overtime.toFixed(2);
          }
        }
      } else {
        // No attendance record found for this date = Absent
        absentDays++;
      }

      records.push({
        sno: sno++,
        date: formattedDate,
        day: dayName,
        status: status,
        hours: hours,
        overtimeHours: overtimeHoursForDay,
        isSunday: isSunday
      });
    });

    return {
      summary: {
        presentDays,
        regularWorkingDays,
        sundayWorkingDays,
        totalHours: totalHours.toFixed(2),
        totalRegularHours: totalRegularHours.toFixed(2),
        overtimeHours: overtimeHours.toFixed(2),
        sundayOvertimeHours: sundayOvertimeHours.toFixed(2),
        totalMonthDays: calculationDetails?.attendanceSummary?.totalMonthDays || allDatesInMonth.length,
        totalSundays: calculationDetails?.attendanceSummary?.totalSundays || 0,
        paidLeaveDays,
        absentDays
      },
      records
    };
  };
  const attendanceDetails = await getAttendanceDetails(payroll.employee._id, payroll.period);

  const [month, year] = payroll.period.split('-');
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const periodText = `${monthNames[parseInt(month) - 1]} ${year}`;

  // ✅ Use calculationDetails properly
  const absentDeduction = calculationDetails.absentDeduction || 0;
  const totalEarnings = calculationDetails.totalEarnings + payroll.transport + payroll.specialOT + payroll.medical + payroll.bonus;
  const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + (payroll.visaDeduction || 0);

  const payslipData = {
    employeeName: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
    designation: payroll.employee.role,
    emiratesId: payroll.employee.emiratesId || 'N/A',
    passportNumber: payroll.employee.passportNumber || 'N/A',
    ibanNumber: payroll.employee.iBANNumber || 'N/A',
    accountNumber: payroll.employee.accountNumber || 'N/A',
    labourCard: payroll.labourCard,
    labourCardPersonalNo: payroll.labourCardPersonalNo,
    period: payroll.period,
    periodText,
    // ✅ Salary components
    basicSalary: basicSalary,
    allowance: allowance,
    totalMonthlySalary: basicSalary + allowance,
    sundayBonus: calculationDetails.sundayBonus || 0,
    absentDeduction: absentDeduction,
    regularHours: calculationDetails.attendanceSummary.totalRegularHours,
    transport: payroll.transport,
    overtime: payroll.overtime,
    specialOT: payroll.specialOT || 0,
    medical: payroll.medical,
    bonus: payroll.bonus,
    mess: payroll.mess,
    salaryAdvance: payroll.salaryAdvance,
    loanDeduction: payroll.loanDeduction,
    fineAmount: payroll.fineAmount,
    visaDeduction: payroll.visaDeduction || 0,
    totalEarnings,
    totalDeductions,
    net: payroll.net,
    netInWords: convertToWords(payroll.net),
    remark: payroll.remark,
    attendanceDetails,
    calculationDetails: {
      baseSalaryFromAttendance: calculationDetails.baseSalaryAmount,
      sundayBonus: calculationDetails.sundayBonus,
      absentDeduction: absentDeduction,
      attendanceSummary: calculationDetails.attendanceSummary,
      rates: calculationDetails.rates,
      calculationBreakdown: calculationDetails.calculationBreakdown
    }
  };

  console.log('NEW Payslip Data:', payslipData);

  res.status(200).json(
    new ApiResponse(200, payslipData, "Payslip data retrieved successfully")
  );
});

// Export payrolls to Excel
export const exportPayrollsToExcel = asyncHandler(async (req: Request, res: Response) => {
  const { month, year, search, employee, period, labourCard, startDate, endDate } = req.query;

  const filter: Record<string, any> = {};
  if (month && year) {
    const startOfMonth = new Date(Number(year), Number(month) - 1, 1);
    const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);
    console.log('Exporting by month/year:', { month, year, startDate: startOfMonth.toISOString(), endDate: endOfMonth.toISOString() });
    filter.createdAt = { $gte: startOfMonth, $lte: endOfMonth };
  } else if (year) {
    const startOfYear = new Date(Number(year), 0, 1);
    const endOfYear = new Date(Number(year), 11, 31, 23, 59, 59, 999);
    console.log('Exporting by year:', { year, startDate: startOfYear.toISOString(), endDate: endOfYear.toISOString() });
    filter.createdAt = { $gte: startOfYear, $lte: endOfYear };
  } else if (startDate && endDate) {
    filter.createdAt = { $gte: new Date(startDate as string), $lte: new Date(endDate as string) };
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

  const finalFilter = Object.keys(searchFilter).length > 0 ? { ...filter, ...searchFilter } : filter;

  const payrolls = await Payroll.find(finalFilter)
    .sort({ period: -1, createdAt: -1 })
    .populate<{ employee: IUser }>({ path: 'employee', select: 'firstName lastName role emiratesId' });

  if (payrolls.length === 0) {
    return res.status(404).json({ success: false, message: "No payroll records found for specified criteria" });
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payroll Report');

  // Add headers with new fields
  worksheet.columns = [
    { header: 'S/NO', key: 'serialNo', width: 8 },
    { header: 'NAME', key: 'name', width: 25 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'EMIRATES ID', key: 'emiratesId', width: 20 },
    { header: 'LABOUR CARD', key: 'labourCard', width: 20 },
    { header: 'LABOUR CARD PERSONAL NO', key: 'labourCardPersonalNo', width: 25 },
    { header: 'PERIOD', key: 'period', width: 15 },
    { header: 'BASE SALARY', key: 'baseSalary', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'TRANSPORT', key: 'transport', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'OVERTIME', key: 'overtime', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'SPECIAL OVERTIME', key: 'specialOT', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'SUNDAY BONUS', key: 'sundayBonus', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'ABSENT DEDUCTION', key: 'absentDeduction', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'MEDICAL', key: 'medical', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'BONUS', key: 'bonus', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'FOOD ALLOWANCE', key: 'mess', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'SALARY ADVANCE', key: 'salaryAdvance', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'LOAN DEDUCTION', key: 'loanDeduction', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'FINE AMOUNT', key: 'fineAmount', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'VISA DEDUCTION', key: 'visaDeduction', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'TOTAL EARNINGS', key: 'totalEarnings', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'TOTAL DEDUCTIONS', key: 'totalDeductions', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'NET PAY', key: 'net', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'REMARK', key: 'remark', width: 30 }
  ];

  // Add data rows
  for (let i = 0; i < payrolls.length; i++) {
    const payroll = payrolls[i];
    if (!payroll.employee || typeof payroll.employee !== 'object') {
      continue;
    }

    const employeeExpense = await EmployeeExpense.findOne({ employee: payroll.employee._id }).lean();
    const calculationDetails: any = payroll.calculationDetails || await calculateSalaryBasedOnAttendance(
      payroll.employee._id,
      employeeExpense?.basicSalary || 0,
      employeeExpense?.allowance || 0,
      payroll.period
    );

    const absentDeduction = calculationDetails.absentDeduction || 0;
    const totalEarnings = calculationDetails.totalEarnings + payroll.transport + payroll.specialOT + payroll.medical + payroll.bonus;
    const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction;

    worksheet.addRow({
      serialNo: i + 1,
      name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
      designation: payroll.employee.role,
      emiratesId: payroll.employee.emiratesId || 'N/A',
      labourCard: payroll.labourCard,
      labourCardPersonalNo: payroll.labourCardPersonalNo,
      period: payroll.period,
      baseSalary: calculationDetails.baseSalaryAmount,
      transport: payroll.transport,
      overtime: payroll.overtime,
      specialOT: payroll.specialOT || 0,
      sundayBonus: calculationDetails.sundayBonus || 0,
      absentDeduction: absentDeduction,
      medical: payroll.medical,
      bonus: payroll.bonus,
      mess: payroll.mess,
      salaryAdvance: payroll.salaryAdvance,
      loanDeduction: payroll.loanDeduction,
      fineAmount: payroll.fineAmount,
      visaDeduction: payroll.visaDeduction || 0,
      totalEarnings: totalEarnings,
      totalDeductions: totalDeductions,
      net: payroll.net,
      remark: payroll.remark || ''
    });
  }

  let filename = 'payroll_report';
  if (month && year) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

// Generate payslip PDF
export const generatePayslipPDF = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const payroll = await Payroll.findById(id).populate<{ employee: IUser }>({
    path: 'employee',
    select: 'firstName lastName role emiratesId passportNumber iBANNumber accountNumber'
  });

  if (!payroll) {
    throw new ApiError(404, "Payroll record not found");
  }

  if (!payroll.employee || typeof payroll.employee !== 'object') {
    throw new ApiError(500, "Employee data not properly populated");
  }

  const employeeExpense = await EmployeeExpense.findOne({ employee: payroll.employee._id }).lean();
  const basicSalary = employeeExpense?.basicSalary || 0;
  const allowance = employeeExpense?.allowance || 0;

  // ✅ Always recalculate to ensure fresh data
  const calculationDetails = await calculateSalaryBasedOnAttendance(
    payroll.employee._id,
    basicSalary,
    allowance,
    payroll.period
  );

  // Get attendance details
  const getAttendanceDetails = async (userId: Types.ObjectId, period: string) => {
    const [monthStr, yearStr] = period.split('-');
    const month = parseInt(monthStr);
    const year = parseInt(yearStr);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });

    const records: any[] = [];
    let sno = 1;

    attendances.forEach(att => {
      const date = new Date(att.date);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      const isSunday = date.getDay() === 0;
      const formattedDate = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      let status = 'Present';
      if (att.isPaidLeave) {
        status = 'Paid Leave';
      } else if (!att.present) {
        status = 'Absent';
      } else if (isSunday) {
        status = 'Sunday';
      }

      records.push({
        sno: sno++,
        date: formattedDate,
        day: dayName,
        status: status,
        hours: (att.workingHours || 0).toFixed(2),
        overtimeHours: (att.overtimeHours || 0).toFixed(2),
        isSunday: isSunday
      });
    });

    return {
      records
    };
  };

  const attendanceDetails = await getAttendanceDetails(payroll.employee._id, payroll.period);

  const [month, year] = payroll.period.split('-');
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const periodText = `${monthNames[parseInt(month) - 1]} ${year}`;

  // ✅ Use calculationDetails properly
  const absentDeduction = calculationDetails.absentDeduction || 0;
  const sundayBonus = calculationDetails.sundayBonus || 0;
  const totalOvertimeHours = (calculationDetails.attendanceSummary?.totalOvertimeHours || 0) +
    (calculationDetails.attendanceSummary?.sundayOvertimeHours || 0);
  const totalEarnings = calculationDetails.totalEarnings + payroll.transport + payroll.specialOT + payroll.medical + payroll.bonus;
  const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + (payroll.visaDeduction || 0);

  const payslipData = {
    employeeName: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
    designation: payroll.employee.role,
    emiratesId: payroll.employee.emiratesId || 'N/A',
    passportNumber: payroll.employee.passportNumber || 'N/A',
    ibanNumber: payroll.employee.iBANNumber || 'N/A',
    accountNumber: payroll.employee.accountNumber || 'N/A',
    labourCard: payroll.labourCard,
    labourCardPersonalNo: payroll.labourCardPersonalNo,
    period: payroll.period,
    periodText,
    // ✅ Salary components
    basicSalary: basicSalary,
    allowance: allowance,
    totalMonthlySalary: basicSalary + allowance,
    sundayBonus: sundayBonus,
    absentDeduction: absentDeduction,
    regularHours: calculationDetails.attendanceSummary.totalRegularHours,
    totalOvertimeHours: totalOvertimeHours,
    transport: payroll.transport,
    overtime: payroll.overtime,
    specialOT: payroll.specialOT || 0,
    medical: payroll.medical,
    bonus: payroll.bonus,
    mess: payroll.mess,
    salaryAdvance: payroll.salaryAdvance,
    loanDeduction: payroll.loanDeduction,
    fineAmount: payroll.fineAmount,
    visaDeduction: payroll.visaDeduction || 0,
    totalEarnings,
    totalDeductions,
    net: payroll.net,
    netInWords: convertToWords(payroll.net),
    remark: payroll.remark,
    attendanceDetails,
    calculationDetails: calculationDetails
  };

  console.log('COMPACT PDF Payslip Data:', payslipData);

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
      margin: { top: '0.2cm', right: '0.2cm', bottom: '0.2cm', left: '0.2cm' },
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


const generatePayslipHTML = (data: any): string => {
  const calculationDetails = data.calculationDetails || {};
  const rates = calculationDetails.rates || {};
  const dailyRate = Number(rates.dailyRate) || 0;
  const overtimeHourlyRate = Number(rates.overtimeHourlyRate) || 0;
  const sundayBonus = Number(data.sundayBonus) || 0;
  const absentDeduction = Number(data.absentDeduction) || 0;

  const attendanceSummary = calculationDetails.attendanceSummary || {};
  const calculationBreakdown = calculationDetails.calculationBreakdown || {};

  // Get attendance data
  const attendanceRecords = data.attendanceDetails?.records || [];
  const maxRecords = Math.min(attendanceRecords.length, 50);
  const displayedRecords = attendanceRecords.slice(0, maxRecords);

  const attendanceRows = displayedRecords
    .map((record: any) => {
      const statusClass =
        record.status === 'Absent'
          ? 'status-absent'
          : record.status === 'Paid Leave'
            ? 'status-paid-leave'
            : record.status === 'Sunday'
              ? 'status-sunday'
              : '';

      const rowStyle =
        record.status === 'Absent'
          ? 'style="background-color: #f8d7da;"'
          : record.status === 'Paid Leave'
            ? 'style="background-color: #d1ecf1;"'
            : record.status === 'Sunday'
              ? 'style="background-color: #fff9e6;"'
              : '';

      return `
        <tr ${rowStyle}>
          <td>${record.sno || ''}</td>
          <td>${record.date || ''}</td>
          <td>${record.day || ''}</td>
          <td>${record.status || ''}</td>
          <td>${formatHours(record.hours)}</td>
          <td>${formatHours(record.overtimeHours)}</td>
        </tr>
      `;
    })
    .join('');

  const moreRecordsNote =
    attendanceRecords.length > maxRecords
      ? `<p style="text-align: center; margin-top: 8px; font-size: 11px; color: #666;">... and ${attendanceRecords.length - maxRecords
      } more days</p>`
      : '';

  const basicSalary = Number(data.basicSalary) || 0;
  const allowance = Number(data.allowance) || 0;
  const transport = Number(data.transport) || 0;
  const overtime = Number(data.overtime) || 0;
  const specialOT = Number(data.specialOT) || 0;
  const medical = Number(data.medical) || 0;
  const bonus = Number(data.bonus) || 0;
  const mess = Number(data.mess) || 0;
  const salaryAdvance = Number(data.salaryAdvance) || 0;
  const loanDeduction = Number(data.loanDeduction) || 0;
  const fineAmount = Number(data.fineAmount) || 0;
  const visaDeduction = Number(data.visaDeduction) || 0;
  const totalEarnings = Number(data.totalEarnings) || 0;
  const totalDeductions = Number(data.totalDeductions) || 0;
  const net = Number(data.net) || 0;
  const totalOvertimeHours = Number(data.totalOvertimeHours) || 0;

  const regularWorkedDays = Number(attendanceSummary.regularWorkedDays) || 0;
  const sundayWorkingDays = Number(attendanceSummary.sundayWorkingDays) || 0;
  const paidLeaveDays = Number(attendanceSummary.paidLeaveDays) || 0;
  const absentDays = Number(attendanceSummary.absentDays) || 0;
  const totalRegularHours = attendanceSummary.totalRegularHours || '0';
  const totalMonthDays = attendanceSummary.totalMonthDays || 0;
  const totalSundays = attendanceSummary.totalSundays || 0;

  // Calculate present days for old design (regularWorkedDays + sundayWorkingDays + paidLeaveDays)
  const presentDays = regularWorkedDays + sundayWorkingDays + paidLeaveDays;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Arial', sans-serif; 
          font-size: 11px;
          line-height: 1.4;
          color: #333;
        }
        .container { 
          width: 100%; 
          max-width: 210mm;
          margin: 0 auto;
          padding: 8px;
        }
        .header {
          text-align: center;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 2px solid #2c3e50;
        }
        .company-name-ar {
          font-size: 16px;
          font-weight: bold;
          color: #2c3e50;
          margin-bottom: 3px;
        }
        .company-name-en {
          font-size: 14px;
          font-weight: bold;
          color: #34495e;
          margin-bottom: 8px;
        }
        .payslip-title {
          font-size: 13px;
          font-weight: bold;
          color: #e74c3c;
          margin-top: 8px;
          padding: 5px;
          background: #f8f9fa;
          border-radius: 4px;
        }

        /* OLD DESIGN - EMPLOYEE INFORMATION TABLE */
        .employee-info-section {
          margin-bottom: 15px;
        }
        .employee-info-section h3 {
          font-size: 12px;
          background: #34495e;
          color: white;
          padding: 6px 10px;
          margin-bottom: 0;
          border-radius: 4px 4px 0 0;
        }
        .info-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
          border: 1px solid #ddd;
        }
        .info-table td {
          padding: 6px 10px;
          border: 1px solid #ddd;
        }
        .info-table td:nth-child(odd) {
          background: #f8f9fa;
          font-weight: bold;
          color: #2c3e50;
          width: 25%;
        }
        .info-table td:nth-child(even) {
          background: white;
          color: #555;
          width: 25%;
        }

        /* WORKING DAYS SECTION - OLD DESIGN */
        .working-days-section {
          background: #e8f5e9;
          border: 1px solid #4caf50;
          padding: 8px 10px;
          margin-bottom: 15px;
          border-radius: 4px;
          text-align: center;
        }
        .working-days-section strong {
          font-size: 11px;
          color: #2e7d32;
        }
        .working-days-value {
          font-size: 14px;
          font-weight: bold;
          color: #1b5e20;
          margin-left: 8px;
        }

        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-bottom: 10px;
          font-size: 10px;
        }
        th, td { 
          padding: 6px 8px; 
          text-align: left; 
          border: 1px solid #ddd; 
        }
        th { 
          background-color: #34495e; 
          color: white; 
          font-weight: bold;
          font-size: 10px;
        }
        .salary-table th {
          background-color: #2c3e50;
        }
        .amount { text-align: right; }
        .total-row { 
          font-weight: bold; 
          background-color: #ecf0f1; 
        }
        .net-pay-row { 
          font-weight: bold; 
          background-color: #27ae60; 
          color: white;
          font-size: 12px;
        }
        .amount-in-words {
          background: #d5f4e6;
          padding: 8px;
          margin: 10px 0;
          border-left: 4px solid #27ae60;
          border-radius: 4px;
          text-align: center;
          font-weight: bold;
          font-size: 11px;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 12px;
        }
        .summary-card {
          background: #f8f9fa;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 8px;
          text-align: center;
        }
        .summary-card .label {
          font-size: 9px;
          color: #666;
          margin-bottom: 3px;
        }
        .summary-card .value {
          font-size: 13px;
          font-weight: bold;
          color: #2c3e50;
        }
        .summary-card .unit {
          font-size: 9px;
          color: #999;
        }
        .remarks-section {
          background: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 8px;
          margin: 10px 0;
          border-radius: 4px;
        }
        .remarks-section strong {
          color: #856404;
          font-size: 11px;
        }
        .remarks-section p {
          margin-top: 5px;
          font-size: 10px;
          color: #856404;
        }
        .attendance-section {
          margin-top: 12px;
        }
        .attendance-section h3 {
          font-size: 11px;
          background: #34495e;
          color: white;
          padding: 6px;
          margin-bottom: 8px;
          border-radius: 4px;
        }
        .status-absent { background-color: #f8d7da !important; }
        .status-paid-leave { background-color: #d1ecf1 !important; }
        .status-sunday { background-color: #fff9e6 !important; }
        
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 9px;
          color: #666;
          border-top: 1px solid #ddd;
          padding-top: 10px;
        }
        .footer-note {
          margin: 5px 0;
        }
        .footer-company {
          margin-top: 10px;
          font-weight: bold;
          color: #2c3e50;
        }

        @media print {
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .container { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="company-name-ar">الغزال الأبيض للخدمات الفنية</div>
          <div class="company-name-en">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
          <div class="payslip-title">📄 SALARY SLIP FOR THE MONTH OF ${data.periodText || ''}</div>
        </div>

        <!-- OLD DESIGN: EMPLOYEE INFORMATION TABLE -->
        <div class="employee-info-section">
          <h3>Employee Information</h3>
          <table class="info-table">
            <tr>
              <td>Employee Name</td>
              <td>${data.employeeName || ''}</td>
              <td>Designation</td>
              <td>${data.designation || ''}</td>
            </tr>
            <tr>
              <td>Account Number</td>
              <td>${data.accountNumber || 'N/A'}</td>
              <td>IBAN Number</td>
              <td>${data.ibanNumber || ''}</td>
            </tr>
            <tr>
              <td>Passport Number</td>
              <td>${data.passportNumber || 'N/A'}</td>
              <td>Passport Expiry</td>
              <td>${data.passportExpiry || 'N/A'}</td>
            </tr>
            <tr>
              <td>Labour Card Number</td>
              <td>${data.labourCard || ''}</td>
              <td>Labour Card Personal Number</td>
              <td>${data.labourCardPersonalNo || ''}</td>
            </tr>
            <tr>
              <td>Labour Card Expiry</td>
              <td>${data.labourCardExpiry || 'N/A'}</td>
              <td>Emirates ID</td>
              <td>${data.emiratesId || 'N/A'}</td>
            </tr>
            <tr>
              <td>Emirates ID Expiry</td>
              <td>${data.emiratesIdExpiry || 'N/A'}</td>
              <td></td>
              <td></td>
            </tr>
          </table>
        </div>

        <!-- OLD DESIGN: WORKING DAYS -->
        <div class="working-days-section">
          <strong>Working Days:</strong>
          <span class="working-days-value">${presentDays} Days</span>
        </div>

        <!-- SALARY DETAILS TABLE (UNCHANGED) -->
        <table class="salary-table">
          <thead>
            <tr>
              <th>EARNINGS</th>
              <th class="amount">AMOUNT (AED)</th>
              <th>DEDUCTIONS</th>
              <th class="amount">AMOUNT (AED)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Basic Salary</td>
              <td class="amount">${basicSalary.toFixed(2)}</td>
              <td>Food Allowance</td>
              <td class="amount">${mess.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Allowance</td>
              <td class="amount">${allowance.toFixed(2)}</td>
              <td>Salary Advance</td>
              <td class="amount">${salaryAdvance.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Transport</td>
              <td class="amount">${transport.toFixed(2)}</td>
              <td>Loan Deduction</td>
              <td class="amount">${loanDeduction.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Overtime</td>
              <td class="amount">${overtime.toFixed(2)}</td>
              <td>Fine Amount</td>
              <td class="amount">${fineAmount.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Special OT</td>
              <td class="amount">${specialOT.toFixed(2)}</td>
              <td>Visa Deduction</td>
              <td class="amount">${visaDeduction.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Medical</td>
              <td class="amount">${medical.toFixed(2)}</td>
              <td></td>
              <td></td>
            </tr>
            <tr>
              <td>Bonus</td>
              <td class="amount">${bonus.toFixed(2)}</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <table>
          <tr class="total-row">
            <td style="width: 25%;">Total Earnings</td>
            <td class="amount" style="width: 25%;">${totalEarnings.toFixed(2)} AED</td>
            <td style="width: 25%;">Total Deductions</td>
            <td class="amount" style="width: 25%;">${totalDeductions.toFixed(2)} AED</td>
          </tr>
          <tr class="net-pay-row">
            <td colspan="4" style="text-align: center; font-size: 13px;">
              NET PAY: ${net.toFixed(2)} AED
            </td>
          </tr>
        </table>

        <div class="amount-in-words">
          <strong>AMOUNT IN WORDS</strong><br>
          ${data.netInWords || 'ZERO AED'}
        </div>

        <!-- ATTENDANCE SUMMARY (UNCHANGED) -->
        <div class="summary-grid">
          <div class="summary-card">
            <div class="label">Total Working Days</div>
            <div class="value">${presentDays}</div>
            <div class="unit">Days</div>
          </div>
          <div class="summary-card">
            <div class="label">Regular Hours</div>
            <div class="value">${formatHours(totalRegularHours)}</div>
            <div class="unit">Hours</div>
          </div>
          <div class="summary-card">
            <div class="label">Overtime Hours</div>
            <div class="value">${formatHours(totalOvertimeHours)}</div>
            <div class="unit">Hours</div>
          </div>
          ${sundayWorkingDays > 0 ? `
          <div class="summary-card">
            <div class="label">🌟 Sunday Working</div>
            <div class="value">${sundayWorkingDays}</div>
            <div class="unit">Days</div>
          </div>
          ` : `
          <div class="summary-card">
            <div class="label">Sunday Working</div>
            <div class="value">0</div>
            <div class="unit">Days</div>
          </div>
          `}
        </div>

        ${data.attendanceDetails?.summary?.sundayOvertimeHours > 0 ? `
        <div style="text-align: center; background: #fff9e6; padding: 6px; border-radius: 4px; margin-bottom: 10px; font-size: 10px;">
          <strong>Sunday Overtime Hours:</strong> ${data.attendanceDetails.summary.sundayOvertimeHours} Hours
        </div>
        ` : ''}

        <!-- ATTENDANCE RECORDS (UNCHANGED) -->
        ${displayedRecords.length > 0 ? `
        <div class="attendance-section">
          <table>
            <thead>
              <tr>
                <th>S.NO</th>
                <th>DATE</th>
                <th>DAY</th>
                <th>STATUS</th>
                <th>REGULAR HOURS</th>
                <th>OT HOURS</th>
              </tr>
            </thead>
            <tbody>
              ${attendanceRows}
            </tbody>
          </table>
          ${moreRecordsNote}
        </div>
        ` : ''}

        ${data.remark ? `
        <div class="remarks-section">
          <strong>📝 Remarks</strong>
          <p>${data.remark}</p>
        </div>
        ` : ''}

        <!-- FOOTER - OLD DESIGN -->
        <div class="footer">
          <div class="footer-note">We work U Relax</div>
          <div class="footer-note">Note: This is a computer-generated payslip and does not require a signature.</div>
          <div class="footer-note">Sunday working days are highlighted in yellow in the attendance table.</div>
          <div class="footer-company">
            AL GHAZAL AL ABYAD TECHNICAL SERVICES<br>
            Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E<br>
            Tel: 044102555 | www.alghazalgroup.com
          </div>
          <div style="margin-top: 8px; font-size: 9px;">
            Generated on ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};
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

const formatHours = (value: any) => {
  const num = Number(value);
  if (isNaN(num)) return '0';
  return num.toFixed(2).replace(/\.00$/, '');
};

// Helper function to format dates
const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'N/A';
  const d = new Date(date);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};