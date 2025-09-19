"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmployeeSummary = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const userModel_1 = require("../models/userModel");
const visaExpenseModel_1 = require("../models/visaExpenseModel");
const date_fns_1 = require("date-fns");
const employeeExpenseModel_1 = require("../models/employeeExpenseModel");
const payrollController_1 = require("./payrollController");
exports.getEmployeeSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    if (!id)
        throw new apiHandlerHelpers_2.ApiError(400, "User ID is required");
    const user = await userModel_1.User.findById(id).select("-password");
    if (!user)
        throw new apiHandlerHelpers_2.ApiError(404, "User not found");
    // Previous month as period string
    const now = new Date();
    const prevMonth = (0, date_fns_1.subMonths)(now, 1);
    const period = (0, date_fns_1.format)(prevMonth, "MM-yyyy"); // "08-2025" for example
    // ✅ Reuse the helper here
    const totalOvertime = await (0, payrollController_1.calculateOvertime)(user._id, period);
    const visaExpense = await visaExpenseModel_1.VisaExpense.findOne({ employee: user._id })
        .sort({ createdAt: -1 })
        .select("labourCardPersonalNumber workPermitNumber passportNumber emirateIdNumber iBan total")
        .lean();
    const employeeExpense = await employeeExpenseModel_1.EmployeeExpense.findOne({ employee: user._id });
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
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, response, "Employee summary retrieved successfully"));
});
//# sourceMappingURL=employeeSummaryController.js.map