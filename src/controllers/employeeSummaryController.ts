import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { User } from "../models/userModel";
import { Attendance } from "../models/attendanceModel";
import { VisaExpense } from "../models/visaExpenseModel";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { EmployeeExpense } from "../models/employeeExpenseModel";
import { calculateOvertime } from "./payrollController";

export const getEmployeeSummary = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) throw new ApiError(400, "User ID is required");

  const user = await User.findById(id).select("-password");
  if (!user) throw new ApiError(404, "User not found");

  // Previous month as period string
  const now = new Date();
  const prevMonth = subMonths(now, 1);
  const period = format(prevMonth, "MM-yyyy"); // "08-2025" for example

  // ✅ Reuse the helper here
  const totalOvertime = await calculateOvertime(user._id, period);

  const visaExpense = await VisaExpense.findOne({ employee: user._id })
    .sort({ createdAt: -1 })
    .select("labourCardPersonalNumber workPermitNumber passportNumber emirateIdNumber iBan total")
    .lean();

  const employeeExpense = await EmployeeExpense.findOne({ employee: user._id });
  const basicSalary = Number(employeeExpense?.basicSalary) || 0;

  const response = {
    employee: {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      basicSalary,
      phoneNumbers: user.phoneNumbers,
      accountNumber: user.accountNumber,
      emiratesId: user.emiratesId,
      passportNumber: user.passportNumber,
      iBANNumber: user.iBANNumber,
      address: user.address,
    },
    overtime: {
      previousMonthTotal: totalOvertime,
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
  };

  res.status(200).json(new ApiResponse(200, response, "Employee summary retrieved successfully"));
});