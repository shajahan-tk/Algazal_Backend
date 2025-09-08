import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { User } from "../models/userModel";
import { Attendance } from "../models/attendanceModel";
import { VisaExpense } from "../models/visaExpenseModel";
import { startOfMonth, endOfMonth, subMonths } from "date-fns";

export const getEmployeeSummary = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Validate user ID
  if (!id) {
    throw new ApiError(400, "User ID is required");
  }

  // Get user details
  const user = await User.findById(id).select("-password");
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Calculate date range for previous month
  const now = new Date();
  const previousMonthStart = startOfMonth(subMonths(now, 1));
  const previousMonthEnd = endOfMonth(subMonths(now, 1));

  // Get overtime for previous month
  const previousMonthOvertime = await Attendance.aggregate([
    {
      $match: {
        user: user._id,
        date: {
          $gte: previousMonthStart,
          $lte: previousMonthEnd
        },
        present: true
      }
    },
    {
      $group: {
        _id: null,
        totalOvertime: { $sum: "$overtimeHours" }
      }
    }
  ]);

  const totalOvertime = previousMonthOvertime.length > 0 ? previousMonthOvertime[0].totalOvertime : 0;

  // Get latest visa expense data for this employee
  const visaExpense = await VisaExpense.findOne({ employee: user._id })
    .sort({ createdAt: -1 })
    .select('labourCardPersonalNumber workPermitNumber passportNumber emirateIdNumber iBan total')
    .lean();

  // Prepare response
  const response = {
    employee: {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      basicSalary: user.salary || 0,
      phoneNumbers: user.phoneNumbers,
      accountNumber: user.accountNumber,
      emiratesId: user.emiratesId,
      passportNumber: user.passportNumber,
      iBANNumber: user.iBANNumber,
      address: user.address,
    },
    overtime: {
      previousMonthTotal: totalOvertime,
      period: {
        start: previousMonthStart,
        end: previousMonthEnd
      }
    },
    visaDetails: visaExpense ? {
      labourCardPersonalNumber: visaExpense.labourCardPersonalNumber,
      workPermitNumber: visaExpense.workPermitNumber,
      passportNumber: visaExpense.passportNumber,
      emirateIdNumber: visaExpense.emirateIdNumber,
      iBan: visaExpense.iBan,
      totalVisaExpenses: visaExpense.total
    } : null
  };

  res.status(200).json(
    new ApiResponse(
      200,
      response,
      "Employee summary retrieved successfully"
    )
  );
});