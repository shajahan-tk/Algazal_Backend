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
    let sundayRegularHours = 0; // Sunday normal hours (added for PDF display)

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
            sundayRegularHours += workingHours; // Track Sunday normal hours
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
      sundayOvertimeHours: sundayOvertimeHours.toFixed(2) + ' hours',
      sundayRegularHours: sundayRegularHours.toFixed(2) + ' hours (Sunday normal hours)'
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
        sundayOvertimeHours, // Overtime hours Sunday
        sundayRegularHours // Sunday normal hours (added)
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
        sundayOvertimeHours: 0,
        sundayRegularHours: 0
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
      absentDeduction: salaryData.absentDeduction,
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
  let {
    employee, labourCard, labourCardPersonalNo, transport, medical, bonus,
    specialOT, mess, salaryAdvance, loanDeduction, fineAmount, visaDeduction,
    // NEW DEDUCTION FIELDS
    otherDeduction1, otherDeduction2, otherDeduction3,
    remark
  } = req.body;

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
  // NEW DEDUCTION FIELDS
  otherDeduction1 = Number(otherDeduction1) || 0;
  otherDeduction2 = Number(otherDeduction2) || 0;
  otherDeduction3 = Number(otherDeduction3) || 0;

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

  // Calculate total deductions including new fields
  const totalDeductions = mess + salaryAdvance + loanDeduction + fineAmount + visaDeduction
    + otherDeduction1 + otherDeduction2 + otherDeduction3;

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
    // NEW DEDUCTION FIELDS
    otherDeduction1,
    otherDeduction2,
    otherDeduction3,
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
  const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction
    + (payroll.otherDeduction1 || 0) + (payroll.otherDeduction2 || 0) + (payroll.otherDeduction3 || 0);

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
  const { employee, labourCard, labourCardPersonalNo, startDate, endDate, month, year, page = 1, limit = 10, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  interface PayrollFilter {
    employee?: any;
    labourCard?: string;
    labourCardPersonalNo?: string;
    createdAt?: { $gte?: Date; $lte?: Date };
  }

  const filter: PayrollFilter = {};

  // Handle search by employee name
  if (search) {
    const searchRegex = new RegExp(search as string, 'i'); // Case-insensitive search
    const users = await User.find({
      $or: [
        { firstName: { $regex: searchRegex } },
        { lastName: { $regex: searchRegex } }
      ]
    }).select('_id');

    if (users.length > 0) {
      filter.employee = { $in: users.map(user => user._id) };
    } else {
      // If no users match the search, return empty results
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            payrolls: [],
            pagination: {
              total: 0,
              page: Number(page),
              limit: Number(limit),
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          },
          "No payrolls found matching the search criteria"
        )
      );
    }
  } else {
    // Only apply these filters if not searching by name
    if (employee) filter.employee = new Types.ObjectId(employee as string);
  }

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
      const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction
        + (payroll.otherDeduction1 || 0) + (payroll.otherDeduction2 || 0) + (payroll.otherDeduction3 || 0);

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
        // NEW DEDUCTION FIELDS
        otherDeduction1: payroll.otherDeduction1 || 0,
        otherDeduction2: payroll.otherDeduction2 || 0,
        otherDeduction3: payroll.otherDeduction3 || 0,
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
  // NEW DEDUCTION FIELDS
  if (updateData.otherDeduction1 !== undefined) updateData.otherDeduction1 = Number(updateData.otherDeduction1) || 0;
  if (updateData.otherDeduction2 !== undefined) updateData.otherDeduction2 = Number(updateData.otherDeduction2) || 0;
  if (updateData.otherDeduction3 !== undefined) updateData.otherDeduction3 = Number(updateData.otherDeduction3) || 0;

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
  // NEW DEDUCTION FIELDS
  const otherDeduction1 = updateData.otherDeduction1 !== undefined ? updateData.otherDeduction1 : (payroll.otherDeduction1 || 0);
  const otherDeduction2 = updateData.otherDeduction2 !== undefined ? updateData.otherDeduction2 : (payroll.otherDeduction2 || 0);
  const otherDeduction3 = updateData.otherDeduction3 !== undefined ? updateData.otherDeduction3 : (payroll.otherDeduction3 || 0);

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
  const totalDeductions = mess + salaryAdvance + loanDeduction + fineAmount + visaDeduction
    + otherDeduction1 + otherDeduction2 + otherDeduction3;
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
    let sundayRegularHours = 0; // Added for Sunday normal hours
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
              sundayRegularHours += regularHours; // Track Sunday normal hours
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
        sundayRegularHours: sundayRegularHours.toFixed(2),
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
  const sundayBonus = calculationDetails.sundayBonus || 0;
  const totalOvertimeHours = (calculationDetails.attendanceSummary?.totalOvertimeHours || 0) +
    (calculationDetails.attendanceSummary?.sundayOvertimeHours || 0);
  const totalEarnings = calculationDetails.totalEarnings + payroll.transport + payroll.specialOT + payroll.medical + payroll.bonus;
  const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction
    + (payroll.otherDeduction1 || 0) + (payroll.otherDeduction2 || 0) + (payroll.otherDeduction3 || 0);

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
    sundayRegularHours: calculationDetails.attendanceSummary.sundayRegularHours || 0, // Added
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
    // NEW DEDUCTION FIELDS
    otherDeduction1: payroll.otherDeduction1 || 0,
    otherDeduction2: payroll.otherDeduction2 || 0,
    otherDeduction3: payroll.otherDeduction3 || 0,
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


export const exportPayrollsToExcel = asyncHandler(async (req: Request, res: Response) => {
  const { month, year } = req.query;

  const filter: Record<string, any> = {};

  // Only handle month and year filters
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
  }

  const payrolls = await Payroll.find(filter)
    .sort({ period: -1, createdAt: -1 })
    .populate<{ employee: IUser }>({ path: 'employee', select: 'firstName lastName role emiratesId' });

  if (payrolls.length === 0) {
    return res.status(404).json({ success: false, message: "No payroll records found for specified criteria" });
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payroll Report');

  // Add title row at the top
  const titleRow = worksheet.addRow([]);
  let titleText = 'PAYROLL REPORT';

  // Generate title based on filters - month parameter represents the PREVIOUS month
  if (month && year) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    // month=12 means November (month-1), month=1 means December of previous year
    const actualMonthIndex = Number(month) - 2;
    let displayYear = Number(year);
    let displayMonth;

    if (actualMonthIndex < 0) {
      // If month=1, it's December of previous year
      displayMonth = monthNames[11]; // December
      displayYear = displayYear - 1;
    } else {
      displayMonth = monthNames[actualMonthIndex];
    }

    titleText = `PAYROLL ${displayMonth.toUpperCase()} ${displayYear}`;
  } else if (year) {
    titleText = `PAYROLL ${year}`;
  }

  worksheet.mergeCells('A1:AB1'); // Merge across all columns
  const titleCell = worksheet.getCell('A1');
  titleCell.value = titleText;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2c5aa0' } // Same blue as headers
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleRow.height = 30;

  // Add headers with separate BASIC SALARY and ALLOWANCE columns
  worksheet.columns = [
    { header: 'S/NO', key: 'serialNo', width: 6 },
    { header: 'NAME', key: 'name', width: 20 },
    { header: 'Designation', key: 'designation', width: 15 },
    { header: 'EMIRATES ID', key: 'emiratesId', width: 18 },
    { header: 'LABOUR CARD', key: 'labourCard', width: 18 },
    { header: 'LABOUR CARD PERSONAL NO', key: 'labourCardPersonalNo', width: 22 },
    { header: 'PERIOD', key: 'period', width: 12 },
    { header: 'BASIC SALARY', key: 'basicSalary', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'ALLOWANCE', key: 'allowance', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'TRANSPORT', key: 'transport', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'OVERTIME', key: 'overtime', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'SPECIAL OVERTIME', key: 'specialOT', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'SUNDAY BONUS', key: 'sundayBonus', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'ABSENT DEDUCTION', key: 'absentDeduction', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'MEDICAL', key: 'medical', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'BONUS', key: 'bonus', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'FOOD ALLOWANCE', key: 'mess', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'SALARY ADVANCE', key: 'salaryAdvance', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'LOAN DEDUCTION', key: 'loanDeduction', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'FINE AMOUNT', key: 'fineAmount', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'VISA DEDUCTION', key: 'visaDeduction', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'OTHER DEDUCTION 1', key: 'otherDeduction1', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'OTHER DEDUCTION 2', key: 'otherDeduction2', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'OTHER DEDUCTION 3', key: 'otherDeduction3', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'TOTAL EARNINGS', key: 'totalEarnings', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'TOTAL DEDUCTIONS', key: 'totalDeductions', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'NET PAY', key: 'net', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'REMARK', key: 'remark', width: 25 }
  ];

  // Initialize totals
  let totalBasicSalary = 0;
  let totalAllowance = 0;
  let totalTransport = 0;
  let totalOvertime = 0;
  let totalSpecialOT = 0;
  let totalSundayBonus = 0;
  let totalAbsentDeduction = 0;
  let totalMedical = 0;
  let totalBonus = 0;
  let totalMess = 0;
  let totalSalaryAdvance = 0;
  let totalLoanDeduction = 0;
  let totalFineAmount = 0;
  let totalVisaDeduction = 0;
  let totalOtherDeduction1 = 0;
  let totalOtherDeduction2 = 0;
  let totalOtherDeduction3 = 0;
  let totalAllEarnings = 0;
  let totalAllDeductions = 0;
  let totalNetPay = 0;

  // Border style for data rows
  const dataBorder = {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const }
  };

  // Add data rows
  for (let i = 0; i < payrolls.length; i++) {
    const payroll = payrolls[i];
    if (!payroll.employee || typeof payroll.employee !== 'object') {
      continue;
    }

    // Get employee expense data
    const employeeExpense = await EmployeeExpense.findOne({ employee: payroll.employee._id }).lean();
    const basicSalary = Number(employeeExpense?.basicSalary) || 0;
    const allowance = Number(employeeExpense?.allowance) || 0;

    // Get calculation details
    const calculationDetails: any = payroll.calculationDetails || await calculateSalaryBasedOnAttendance(
      payroll.employee._id,
      basicSalary,
      allowance,
      payroll.period
    );

    // Extract values with proper fallbacks
    const sundayBonus = Number(calculationDetails.sundayBonus) || 0;
    const absentDeduction = Number(calculationDetails.absentDeduction) || 0;
    const baseSalaryFromAttendance = Number(calculationDetails.baseSalaryFromAttendance) || (basicSalary + allowance);

    // Calculate total earnings properly
    const transport = Number(payroll.transport) || 0;
    const overtime = Number(payroll.overtime) || 0;
    const specialOT = Number(payroll.specialOT) || 0;
    const medical = Number(payroll.medical) || 0;
    const bonus = Number(payroll.bonus) || 0;

    const totalEarnings = baseSalaryFromAttendance + transport + overtime + specialOT + medical + bonus + sundayBonus - absentDeduction;

    // Calculate total deductions properly
    const mess = Number(payroll.mess) || 0;
    const salaryAdvance = Number(payroll.salaryAdvance) || 0;
    const loanDeduction = Number(payroll.loanDeduction) || 0;
    const fineAmount = Number(payroll.fineAmount) || 0;
    const visaDeduction = Number(payroll.visaDeduction) || 0;
    const otherDeduction1 = Number(payroll.otherDeduction1) || 0;
    const otherDeduction2 = Number(payroll.otherDeduction2) || 0;
    const otherDeduction3 = Number(payroll.otherDeduction3) || 0;

    const totalDeductions = mess + salaryAdvance + loanDeduction + fineAmount + visaDeduction + otherDeduction1 + otherDeduction2 + otherDeduction3;

    // Accumulate totals
    totalBasicSalary += basicSalary;
    totalAllowance += allowance;
    totalTransport += transport;
    totalOvertime += overtime;
    totalSpecialOT += specialOT;
    totalSundayBonus += sundayBonus;
    totalAbsentDeduction += absentDeduction;
    totalMedical += medical;
    totalBonus += bonus;
    totalMess += mess;
    totalSalaryAdvance += salaryAdvance;
    totalLoanDeduction += loanDeduction;
    totalFineAmount += fineAmount;
    totalVisaDeduction += visaDeduction;
    totalOtherDeduction1 += otherDeduction1;
    totalOtherDeduction2 += otherDeduction2;
    totalOtherDeduction3 += otherDeduction3;
    totalAllEarnings += totalEarnings;
    totalAllDeductions += totalDeductions;
    totalNetPay += Number(payroll.net) || 0;

    const row = worksheet.addRow({
      serialNo: i + 1,
      name: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
      designation: payroll.employee.role,
      emiratesId: payroll.employee.emiratesId || 'N/A',
      labourCard: payroll.labourCard,
      labourCardPersonalNo: payroll.labourCardPersonalNo,
      period: payroll.period,
      basicSalary: basicSalary,
      allowance: allowance,
      transport: transport,
      overtime: overtime,
      specialOT: specialOT,
      sundayBonus: sundayBonus,
      absentDeduction: absentDeduction,
      medical: medical,
      bonus: bonus,
      mess: mess,
      salaryAdvance: salaryAdvance,
      loanDeduction: loanDeduction,
      fineAmount: fineAmount,
      visaDeduction: visaDeduction,
      otherDeduction1: otherDeduction1,
      otherDeduction2: otherDeduction2,
      otherDeduction3: otherDeduction3,
      totalEarnings: totalEarnings,
      totalDeductions: totalDeductions,
      net: payroll.net,
      remark: payroll.remark || ''
    });

    // Apply background color based on user role
    const userRole = payroll.employee.role?.toLowerCase() || '';
    let bgColor = 'FFFFFFFF'; // Default white

    if (userRole.includes('engineer')) {
      bgColor = 'FFD4E6F1'; // Light blue
    } else if (userRole.includes('super admin') || userRole.includes('admin')) {
      bgColor = 'FFFFC7CE'; // Light red
    }

    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgColor }
    };

    // Set row height for data rows
    row.height = 18;

    // Apply border and center alignment to all cells in the row
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = dataBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };

      // Reduce font size for NAME column (column 2)
      if (colNumber === 2) {
        cell.font = { size: 9 };
      }
    });
  }

  // Add TOTAL ROW at the end with actual calculated numbers
  const totalRow = worksheet.addRow({
    serialNo: '',
    name: '',
    designation: '',
    emiratesId: '',
    labourCard: '',
    labourCardPersonalNo: '',
    period: 'TOTAL',
    basicSalary: totalBasicSalary,
    allowance: totalAllowance,
    transport: totalTransport,
    overtime: totalOvertime,
    specialOT: totalSpecialOT,
    sundayBonus: totalSundayBonus,
    absentDeduction: totalAbsentDeduction,
    medical: totalMedical,
    bonus: totalBonus,
    mess: totalMess,
    salaryAdvance: totalSalaryAdvance,
    loanDeduction: totalLoanDeduction,
    fineAmount: totalFineAmount,
    visaDeduction: totalVisaDeduction,
    otherDeduction1: totalOtherDeduction1,
    otherDeduction2: totalOtherDeduction2,
    otherDeduction3: totalOtherDeduction3,
    totalEarnings: totalAllEarnings,
    totalDeductions: totalAllDeductions,
    net: totalNetPay,
    remark: ''
  });

  // Style the total row
  totalRow.font = { bold: true };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFEB3B' } // Yellow background for totals
  };
  totalRow.height = 20;

  // Apply border and center alignment to total row
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = dataBorder;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Add empty row after total
  worksheet.addRow({});

  // Add signature box section
  const signatureStartRow = worksheet.lastRow!.number + 1;

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
  worksheet.addRow({});

  // Add footer text
  const footerRow = worksheet.addRow({});
  worksheet.mergeCells(`A${footerRow.number}:AA${footerRow.number}`);
  const footerCell = worksheet.getCell(`A${footerRow.number}`);
  footerCell.value = 'This payroll is generated using AGATS software';
  footerCell.font = { italic: true, size: 10, color: { argb: 'FF808080' } }; // Gray color
  footerCell.alignment = { vertical: 'middle', horizontal: 'center' };
  footerRow.height = 20;

  // Style the header row (now row 2 after title)
  const headerRow = worksheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2c5aa0' }
  };
  headerRow.height = 22;

  // Apply border and center alignment to header row
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = dataBorder;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  let filename = 'payroll_report';
  if (month && year) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // month=12 means November (month-1)
    const actualMonthIndex = Number(month) - 2;
    let displayYear = Number(year);
    let displayMonth;

    if (actualMonthIndex < 0) {
      displayMonth = monthNames[11]; // Dec
      displayYear = displayYear - 1;
    } else {
      displayMonth = monthNames[actualMonthIndex];
    }

    filename += `_${displayMonth}_${displayYear}`;
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
  const sundayRegularHours = calculationDetails.attendanceSummary?.sundayRegularHours || 0;
  const totalOvertimeHours = (calculationDetails.attendanceSummary?.totalOvertimeHours || 0) +
    (calculationDetails.attendanceSummary?.sundayOvertimeHours || 0);
  const totalEarnings = calculationDetails.totalEarnings + payroll.transport + payroll.specialOT + payroll.medical + payroll.bonus;
  const totalDeductions = payroll.mess + payroll.salaryAdvance + payroll.loanDeduction + payroll.fineAmount + payroll.visaDeduction
    + (payroll.otherDeduction1 || 0) + (payroll.otherDeduction2 || 0) + (payroll.otherDeduction3 || 0);

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
    sundayRegularHours: sundayRegularHours,
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
    otherDeduction1: payroll.otherDeduction1 || 0,
    otherDeduction2: payroll.otherDeduction2 || 0,
    otherDeduction3: payroll.otherDeduction3 || 0,
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

// Helper function to format hours
// const formatHours = (hours: any): string => {
//   const h = parseFloat(hours) || 0;
//   return h.toFixed(2);
// };

// Helper function to generate HTML for payslip
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

  // Only show first 15-20 records to save space, or all if less than 20
  const maxRecords = Math.min(attendanceRecords.length, 50);
  const displayedRecords = attendanceRecords.slice(0, maxRecords);

  // Generate attendance rows with proper styling
  const attendanceRows = displayedRecords
    .map((record: any) => {
      // Determine row styling based on status
      let rowStyle = '';
      let statusClass = '';

      if (record.status === 'Absent') {
        rowStyle = 'style="background-color: #f8d7da;"';
        statusClass = 'status-absent';
      } else if (record.status === 'Paid Leave') {
        rowStyle = 'style="background-color: #d1ecf1;"';
        statusClass = 'status-paid-leave';
      } else if (record.status === 'Present (Sunday)' || record.status === 'Sunday') {
        rowStyle = 'style="background-color: #fff9e6;"';
        statusClass = 'status-sunday';
      } else if (record.status.includes('Sunday')) {
        rowStyle = 'style="background-color: #fff9e6;"';
        statusClass = 'status-sunday';
      }

      return `
      <tr ${rowStyle}>
        <td>${record.sno || ''}</td>
        <td>${record.date || ''}</td>
        <td>${record.day || ''}</td>
        <td class="${statusClass}">${record.status || ''}</td>
        <td>${formatHours(record.hours)}</td>
        <td>${formatHours(record.overtimeHours)}</td>
      </tr>
    `;
    })
    .join('');

  // Add note if more records exist
  const moreRecordsNote = attendanceRecords.length > maxRecords ?
    `<tr><td colspan="6" style="text-align: center; font-style: italic; color: #666;">... and ${attendanceRecords.length - maxRecords} more days</td></tr>` : '';

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
  const otherDeduction1 = Number(data.otherDeduction1) || 0;
  const otherDeduction2 = Number(data.otherDeduction2) || 0;
  const otherDeduction3 = Number(data.otherDeduction3) || 0;
  const totalEarnings = Number(data.totalEarnings) || 0;
  const totalDeductions = Number(data.totalDeductions) || 0;
  const net = Number(data.net) || 0;

  // Use data from calculationDetails for accuracy
  const regularWorkedDays = Number(attendanceSummary.regularWorkedDays) || 0;
  const sundayWorkingDays = Number(attendanceSummary.sundayWorkingDays) || 0;
  const paidLeaveDays = Number(attendanceSummary.paidLeaveDays) || 0;
  const absentDays = Number(attendanceSummary.absentDays) || 0;
  const totalRegularHours = parseFloat(attendanceSummary.totalRegularHours) || 0;
  const sundayRegularHours = parseFloat(attendanceSummary.sundayRegularHours) - parseFloat(attendanceSummary.sundayOvertimeHours) || 0;
  const totalMonthDays = attendanceSummary.totalMonthDays || 0;
  const totalSundays = attendanceSummary.totalSundays || 0;

  // Get separate overtime hours
  const regularOvertimeHours = parseFloat(attendanceSummary.totalOvertimeHours) || 0;
  const sundayOvertimeHours = parseFloat(attendanceSummary.sundayOvertimeHours) || 0;
  const totalOvertimeHoursFromAttendance = regularOvertimeHours + sundayOvertimeHours;

  // Calculate total all hours
  const totalAllHours = totalRegularHours + sundayRegularHours + regularOvertimeHours + sundayOvertimeHours;

  // Calculate separate overtime amounts
  const regularOvertimeAmount = regularOvertimeHours * overtimeHourlyRate;
  const sundayOvertimeAmount = sundayOvertimeHours * overtimeHourlyRate;

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
          margin: 0.2cm;
        }
        
        body {
            font-family: 'Arial', sans-serif;
            font-size: 9pt;
            line-height: 1.2;
            color: #333;
            margin: 0;
            padding: 0;
            background: white;
        }
        
        .payslip-container {
            max-width: 780px;
            margin: 0 auto;
            background: white;
        }
        
        .header {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 5px;
            gap: 10px;
            padding: 8px 0;
            border-bottom: 2px solid #94d7f4;
            position: relative;
        }

        .logo {
            height: 35px;
            width: auto;
            max-width: 100px;
            object-fit: contain;
            position: absolute;
            left: 5px;
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
            font-size: 14pt;
            font-weight: bold;
            color: #1a1a1a;
            line-height: 1.2;
            direction: rtl;
            unicode-bidi: bidi-override;
            letter-spacing: 0;
            margin-bottom: 2px;
        }

        .company-name-english {
            font-size: 8pt;
            font-weight: bold;
            color: #1a1a1a;
            line-height: 1.1;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }
        
        .document-title {
            text-align: center;
            margin: 5px 0 8px 0;
            padding: 6px;
            background: linear-gradient(135deg, #2c5aa0 0%, #4a90e2 100%);
            color: white;
            border-radius: 4px;
            font-size: 10pt;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .content {
            padding: 0 10px 10px 10px;
        }
        
        .section {
            margin-bottom: 8px;
        }
        
        .section-title {
            font-size: 9pt;
            font-weight: bold;
            color: #2c5aa0;
            margin-bottom: 6px;
            padding-bottom: 3px;
            border-bottom: 1px solid #e8f4fd;
            text-transform: uppercase;
        }
        
        .compact-info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 3px 8px;
            margin-bottom: 6px;
            font-size: 8pt;
        }
        
        .compact-info-item {
            display: flex;
            justify-content: space-between;
            padding: 2px 0;
            border-bottom: 1px dotted #e5e5e5;
        }
        
        .info-label {
            color: #666;
            font-weight: 500;
        }
        
        .info-value {
            color: #333;
            font-weight: 600;
        }
        
        .compact-salary-table {
            width: 100%;
            border-collapse: collapse;
            margin: 6px 0;
            border: 1px solid #ddd;
            font-size: 8pt;
        }
        
        .compact-salary-table th {
            background: #2c5aa0;
            color: white;
            padding: 4px 4px;
            text-align: left;
            font-weight: 600;
            border: 1px solid #2c5aa0;
        }
        
        .compact-salary-table td {
            padding: 3px 4px;
            border: 1px solid #ddd;
            color: #333;
        }
        
        .amount {
            text-align: right;
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        
        .compact-summary {
            background: #f8fbff;
            padding: 6px;
            border-radius: 3px;
            margin: 6px 0;
            border: 1px solid #e8f4fd;
        }
        
        .compact-summary-row {
            display: flex;
            justify-content: space-between;
            padding: 3px 0;
            font-size: 9pt;
        }
        
        .compact-summary-row.total {
            border-top: 2px solid #2c5aa0;
            margin-top: 3px;
            padding-top: 4px;
            font-weight: 700;
            color: #2c5aa0;
        }
        
        .net-pay {
            background: linear-gradient(135deg, #2c5aa0 0%, #4a90e2 100%);
            color: white;
            padding: 8px;
            text-align: center;
            margin: 8px 0;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .net-pay-label {
            font-size: 9pt;
            opacity: 0.95;
            margin-bottom: 3px;
            font-weight: 600;
        }
        
        .net-pay-amount {
            font-size: 14px;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            letter-spacing: 0.3px;
        }
        
        .attendance-summary-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            text-align: center;
            margin-bottom: 8px;
        }
        
        .summary-card {
            padding: 10px;
            background: white;
            border-radius: 4px;
            border: 1px solid #e8f4fd;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        .summary-card h4 {
            margin: 0 0 6px 0;
            font-size: 8pt;
            font-weight: 600;
            color: #2c5aa0;
            text-transform: uppercase;
        }
        
        .summary-value {
            font-size: 14px;
            font-weight: 700;
            color: #2c5aa0;
            margin-bottom: 2px;
        }
        
        .summary-label {
            font-size: 8pt;
            color: #666;
            font-weight: 500;
        }
        
        .compact-attendance-table {
            width: 100%;
            border-collapse: collapse;
            margin: 6px 0;
            border: 1px solid #ddd;
            font-size: 7pt;
        }
        
        .compact-attendance-table th {
            background: #2c5aa0;
            color: white;
            padding: 3px 2px;
            text-align: center;
            font-weight: 600;
            border: 1px solid #2c5aa0;
        }
        
        .compact-attendance-table td {
            padding: 2px 2px;
            border: 1px solid #ddd;
            color: #333;
            text-align: center;
        }
        
        .status-paid-leave {
            color: #0c5460;
            font-weight: 600;
        }
        
        .status-absent {
            color: #721c24;
            font-weight: 600;
        }
        
        .status-sunday {
            color: #856404;
            font-weight: 600;
        }
        
        .prepared-by-section {
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px solid #e9ecef;
            text-align: right;
            font-size: 8pt;
            color: #666;
        }
        
        .prepared-by-name {
            font-weight: 600;
            color: #2c5aa0;
            margin-top: 5px;
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
                padding: 0 8px 8px 8px;
            }
            
            .document-title {
                margin: 4px 0 6px 0;
            }

            .section {
                margin-bottom: 6px;
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
            SALARY SLIP FOR THE MONTH OF ${data.periodText || ''}
        </div>
        
        <div class="content">
            <!-- Employee Information Section -->
            <div class="section">
                <div class="section-title">Employee Information</div>
                <div class="compact-info-grid">
                    <div class="compact-info-item">
                        <span class="info-label">Employee Name:</span>
                        <span class="info-value">${data.employeeName || ''}</span>
                    </div>
                    <div class="compact-info-item">
                        <span class="info-label">Designation:</span>
                        <span class="info-value">${data.designation || ''}</span>
                    </div>
                    <div class="compact-info-item">
                        <span class="info-label">Account Number:</span>
                        <span class="info-value">${data.accountNumber || 'N/A'}</span>
                    </div>
                    <div class="compact-info-item">
                        <span class="info-label">IBAN Number:</span>
                        <span class="info-value">${data.ibanNumber || ''}</span>
                    </div>
                    <div class="compact-info-item">
                        <span class="info-label">Labour Card:</span>
                        <span class="info-value">${data.labourCard || ''}</span>
                    </div>
                    <div class="compact-info-item">
                        <span class="info-label">Labour Card Personal No:</span>
                        <span class="info-value">${data.labourCardPersonalNo || ''}</span>
                    </div>
                    <div class="compact-info-item">
                        <span class="info-label">Passport No:</span>
                        <span class="info-value">${data.passportNumber || ''}</span>
                    </div>
                    <div class="compact-info-item">
                        <span class="info-label">Emirate ID:</span>
                        <span class="info-value">${data.emiratesId || ''}</span>
                    </div>
                </div>
            </div>
            
            <!-- Salary Details Section -->
            <div class="section">
                <div class="section-title">Salary Details</div>
                <table class="compact-salary-table">
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
                            <td>Medical</td>
                            <td class="amount">${medical.toFixed(2)}</td>
                            <td>Fine Amount</td>
                            <td class="amount">${fineAmount.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Bonus</td>
                            <td class="amount">${bonus.toFixed(2)}</td>
                            <td>Visa Deduction</td>
                            <td class="amount">${visaDeduction.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Special OT</td>
                            <td class="amount">${specialOT.toFixed(2)}</td>
                            <td></td>
                            <td class="amount"></td>
                        </tr>
                        ${regularOvertimeAmount > 0 ? `
                        <tr>
                            <td>Overtime (Mon-Sat)</td>
                            <td class="amount">${regularOvertimeAmount.toFixed(2)}</td>
                            <td></td>
                            <td class="amount"></td>
                        </tr>
                        ` : ''}
                        ${sundayOvertimeAmount > 0 ? `
                        <tr>
                            <td style="color: #856404;">Overtime (Sunday)</td>
                            <td class="amount" style="color: #856404;">${sundayOvertimeAmount.toFixed(2)}</td>
                            <td></td>
                            <td class="amount"></td>
                        </tr>
                        ` : ''}
                        ${sundayBonus > 0 ? `
                        <tr>
                            <td style="color: #856404; font-weight: 600;">Sunday Bonus</td>
                            <td class="amount" style="color: #856404;">${sundayBonus.toFixed(2)}</td>
                            <td></td>
                            <td class="amount"></td>
                        </tr>
                        ` : ''}
                        ${absentDeduction > 0 ? `
                        <tr>
                            <td style="color: #721c24; font-weight: 600;">Absent Deduction</td>
                            <td class="amount" style="color: #721c24;">-${absentDeduction.toFixed(2)}</td>
                            <td></td>
                            <td class="amount"></td>
                        </tr>
                        ` : ''}
                        ${otherDeduction1 > 0 ? `
                        <tr>
                            <td></td>
                            <td class="amount"></td>
                            <td>Other Deduction 1</td>
                            <td class="amount">${otherDeduction1.toFixed(2)}</td>
                        </tr>
                        ` : ''}
                        ${otherDeduction2 > 0 ? `
                        <tr>
                            <td></td>
                            <td class="amount"></td>
                            <td>Other Deduction 2</td>
                            <td class="amount">${otherDeduction2.toFixed(2)}</td>
                        </tr>
                        ` : ''}
                        ${otherDeduction3 > 0 ? `
                        <tr>
                            <td></td>
                            <td class="amount"></td>
                            <td>Other Deduction 3</td>
                            <td class="amount">${otherDeduction3.toFixed(2)}</td>
                        </tr>
                        ` : ''}
                    </tbody>
                </table>
                
                <div class="compact-summary">
                    <div class="compact-summary-row total">
                        <span>NET PAY</span>
                        <span style="color: #2c5aa0; font-weight: 800;">${net.toFixed(2)} AED</span>
                    </div>
                </div>
                
                <div class="net-pay">
                    <div class="net-pay-label">AMOUNT IN WORDS</div>
                    <div class="net-pay-amount">${data.netInWords || 'ZERO AED'}</div>
                </div>
            </div>
            
            <!-- Attendance Summary Section -->
            <div class="section">
                <div class="section-title">Attendance Summary</div>
                <div class="attendance-summary-grid">
                    <div class="summary-card">
                        <h4>Total Month Days</h4>
                        <div class="summary-value">${totalMonthDays}</div>
                        <div class="summary-label">Days</div>
                    </div>
                    
                    <div class="summary-card">
                        <h4>Present Days (Mon-Sat)</h4>
                        <div class="summary-value">${regularWorkedDays}</div>
                        <div class="summary-label">Days</div>
                    </div>
                    
                    <div class="summary-card" style="background-color: #d1ecf1; border-color: #bee5eb;">
                        <h4 style="color: #0c5460;">Paid Leave Days</h4>
                        <div class="summary-value" style="color: #0c5460;">${paidLeaveDays}</div>
                        <div class="summary-label" style="color: #0c5460;">Days</div>
                    </div>
                </div>
                
                <!-- Second Row for Attendance Summary -->
                <div class="attendance-summary-grid" style="margin-top: 8px;">
                    <div class="summary-card" style="background-color: #f8d7da; border-color: #f5c6cb;">
                        <h4 style="color: #721c24;">Absent Days</h4>
                        <div class="summary-value" style="color: #721c24;">${absentDays}</div>
                        <div class="summary-label" style="color: #721c24;">Days</div>
                    </div>
                    
                    <div class="summary-card" style="background-color: #fff9e6; border-color: #ffc107;">
                        <h4 style="color: #856404;">Sunday Working</h4>
                        <div class="summary-value" style="color: #856404;">${sundayWorkingDays}</div>
                        <div class="summary-label" style="color: #856404;">Days</div>
                    </div>
                    
                    <div class="summary-card">
                        <h4>Total Sundays</h4>
                        <div class="summary-value">${totalSundays}</div>
                        <div class="summary-label">Days</div>
                    </div>
                </div>
                
                <!-- Third Row for Hours -->
                <div class="attendance-summary-grid" style="margin-top: 8px;">
                    <div class="summary-card">
                        <h4>Regular Hours (Mon-Sat)</h4>
                        <div class="summary-value">${formatHours(totalRegularHours)}</div>
                        <div class="summary-label">Hours</div>
                    </div>
                    
                    ${sundayRegularHours > 0 ? `
                    <div class="summary-card" style="background-color: #fff9e6; border-color: #ffc107;">
                        <h4 style="color: #856404;">Sunday Normal Hours</h4>
                        <div class="summary-value" style="color: #856404;">${formatHours(sundayRegularHours)}</div>
                        <div class="summary-label" style="color: #856404;">Hours</div>
                    </div>
                    ` : `
                    <div class="summary-card" style="opacity: 0.6;">
                        <h4>Sunday Normal Hours</h4>
                        <div class="summary-value">0.00</div>
                        <div class="summary-label">Hours</div>
                    </div>
                    `}
                    
                    <div class="summary-card" style="background-color: #e8f4fd; border-color: #2c5aa0;">
                        <h4 style="color: #2c5aa0;">Total Hours</h4>
                        <div class="summary-value" style="color: #2c5aa0;">${formatHours(totalAllHours)}</div>
                        <div class="summary-label" style="color: #2c5aa0;">All Hours</div>
                    </div>
                </div>
                
                <!-- Fourth Row for Overtime Hours -->
                <div class="attendance-summary-grid" style="margin-top: 8px;">
                    ${regularOvertimeHours > 0 ? `
                    <div class="summary-card">
                        <h4>Overtime (Mon-Sat)</h4>
                        <div class="summary-value">${formatHours(regularOvertimeHours)}</div>
                        <div class="summary-label">Hours</div>
                    </div>
                    ` : `
                    <div class="summary-card" style="opacity: 0.6;">
                        <h4>Overtime (Mon-Sat)</h4>
                        <div class="summary-value">0.00</div>
                        <div class="summary-label">Hours</div>
                    </div>
                    `}
                    
                    ${sundayOvertimeHours > 0 ? `
                    <div class="summary-card" style="background-color: #fff9e6; border-color: #ffc107;">
                        <h4 style="color: #856404;">Overtime (Sunday)</h4>
                        <div class="summary-value" style="color: #856404;">${formatHours(sundayOvertimeHours)}</div>
                        <div class="summary-label" style="color: #856404;">Hours</div>
                    </div>
                    ` : `
                    <div class="summary-card" style="opacity: 0.6;">
                        <h4>Overtime (Sunday)</h4>
                        <div class="summary-value">0.00</div>
                        <div class="summary-label">Hours</div>
                    </div>
                    `}
                    
                    <div class="summary-card">
                        <h4>Overtime Per Hour Rate</h4>
                        <div class="summary-value">${overtimeHourlyRate.toFixed(2)}</div>
                        <div class="summary-label">AED/hour</div>
                    </div>
                </div>
                
                <!-- Fifth Row for Daily Rate -->
                <div class="attendance-summary-grid" style="margin-top: 8px;">
                    <div class="summary-card">
                        <h4>Daily Rate</h4>
                        <div class="summary-value">${dailyRate.toFixed(2)}</div>
                        <div class="summary-label">AED/day</div>
                    </div>
                    
                    <div class="summary-card" style="opacity: 0.6;">
                        <h4></h4>
                        <div class="summary-value"></div>
                        <div class="summary-label"></div>
                    </div>
                    
                    <div class="summary-card" style="opacity: 0.6;">
                        <h4></h4>
                        <div class="summary-value"></div>
                        <div class="summary-label"></div>
                    </div>
                </div>
            </div>
            
            <!-- Attendance Records (Compact) -->
            ${displayedRecords.length > 0 ? `
            <div class="section">
                <div class="section-title">Attendance Records (First ${maxRecords} days)</div>
                <table class="compact-attendance-table">
                    <thead>
                        <tr>
                            <th style="width: 6%;">S.NO</th>
                            <th style="width: 12%;">DATE</th>
                            <th style="width: 12%;">DAY</th>
                            <th style="width: 10%;">STATUS</th>
                            <th style="width: 12%;">HOURS</th>
                            <th style="width: 12%;">OT HOURS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${attendanceRows}
                        ${moreRecordsNote}
                    </tbody>
                </table>
                <div style="font-size: 7pt; color: #666; margin-top: 4px; text-align: center;">
                    <strong>Legend:</strong> 
                    <span style="background-color: #d1ecf1; padding: 1px 4px; margin: 0 2px;">Paid Leave</span>
                    <span style="background-color: #f8d7da; padding: 1px 4px; margin: 0 2px;">Absent</span>
                    <span style="background-color: #fff9e6; padding: 1px 4px; margin: 0 2px;">Sunday</span>
                </div>
            </div>
            ` : ''}
            
            ${data.remark ? `
            <div class="section">
                <div class="section-title">Remarks</div>
                <div style="color: #666; font-size: 8pt; padding: 4px; background: #f8f9fa; border-radius: 2px; border-left: 2px solid #2c5aa0;">
                    ${data.remark}
                </div>
            </div>
            ` : ''}
            
            <!-- Prepared by Section -->
            <div class="prepared-by-section">
                <div>Prepared by:</div>
                <div class="prepared-by-name">Meena Sridhar</div>
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