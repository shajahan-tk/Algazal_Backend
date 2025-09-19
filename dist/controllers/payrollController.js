"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportPayrollsToExcel = exports.deletePayroll = exports.updatePayroll = exports.getPayroll = exports.getPayrolls = exports.createPayroll = exports.calculateOvertime = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const payrollModel_1 = require("../models/payrollModel");
const userModel_1 = require("../models/userModel");
const employeeExpenseModel_1 = require("../models/employeeExpenseModel");
const attendanceModel_1 = require("../models/attendanceModel");
const exceljs_1 = __importDefault(require("exceljs"));
const mongoose_1 = require("mongoose");
// Helper function to calculate overtime for a period
const calculateOvertime = async (userId, period) => {
    try {
        // Extract month and year from period (assuming format "MM-YYYY")
        const [month, year] = period.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0); // Last day of month
        const attendances = await attendanceModel_1.Attendance.find({
            user: userId,
            date: { $gte: startDate, $lte: endDate },
            present: true
        });
        return attendances.reduce((total, attendance) => {
            return total + (attendance.overtimeHours || 0);
        }, 0);
    }
    catch (error) {
        console.error("Error calculating overtime:", error);
        return 0;
    }
};
exports.calculateOvertime = calculateOvertime;
// Create payroll record
exports.createPayroll = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    let { employee, labourCard, labourCardPersonalNo, period, allowance, deduction, mess, advance, remark } = req.body;
    // Convert to numbers safely
    allowance = Number(allowance) || 0;
    deduction = Number(deduction) || 0;
    mess = Number(mess) || 0;
    advance = Number(advance) || 0;
    // Validate required fields
    if (!employee || !labourCard || !labourCardPersonalNo || !period) {
        throw new apiHandlerHelpers_2.ApiError(400, "Required fields are missing");
    }
    // Check if employee exists
    const employeeExists = await userModel_1.User.findById(employee);
    if (!employeeExists) {
        throw new apiHandlerHelpers_2.ApiError(404, "Employee not found");
    }
    // Check for existing payroll for same employee and period
    const existingPayroll = await payrollModel_1.Payroll.findOne({ employee, period });
    if (existingPayroll) {
        throw new apiHandlerHelpers_2.ApiError(400, "Payroll already exists for this employee and period");
    }
    // Get basic salary
    const employeeExpense = await employeeExpenseModel_1.EmployeeExpense.findOne({ employee });
    const basicSalary = Number(employeeExpense?.basicSalary) || 0;
    // Calculate overtime
    const overtime = await (0, exports.calculateOvertime)(employee, period);
    // Totals
    const totalEarnings = basicSalary + allowance + overtime;
    const net = totalEarnings - deduction - mess - advance;
    const payroll = await payrollModel_1.Payroll.create({
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
    res.status(201).json(new apiHandlerHelpers_1.ApiResponse(201, payroll, "Payroll created successfully"));
});
// Get all payroll records with comprehensive data
exports.getPayrolls = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { employee, period, labourCard, labourCardPersonalNo, startDate, endDate, month, year, page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = {};
    // Basic filters
    if (employee)
        filter.employee = new mongoose_1.Types.ObjectId(employee);
    if (period)
        filter.period = period;
    if (labourCard)
        filter.labourCard = labourCard;
    if (labourCardPersonalNo)
        filter.labourCardPersonalNo = labourCardPersonalNo;
    // Date range filter (takes precedence over year/month)
    if (startDate && endDate) {
        filter.createdAt = {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
        };
    }
    else {
        // Initialize date filter if not exists
        if (!filter.createdAt)
            filter.createdAt = {};
        // Year filter
        if (year) {
            const yearNum = parseInt(year);
            if (isNaN(yearNum)) {
                throw new apiHandlerHelpers_2.ApiError(400, "Invalid year value");
            }
            filter.createdAt.$gte = new Date(yearNum, 0, 1);
            filter.createdAt.$lte = new Date(yearNum + 1, 0, 1);
        }
        // Month filter (works with year filter)
        if (month) {
            const monthNum = parseInt(month);
            if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
                throw new apiHandlerHelpers_2.ApiError(400, "Invalid month value (1-12)");
            }
            if (!filter.createdAt.$gte) {
                // If no year specified, use current year
                const currentYear = new Date().getFullYear();
                filter.createdAt.$gte = new Date(currentYear, monthNum - 1, 1);
                filter.createdAt.$lte = new Date(currentYear, monthNum, 1);
            }
            else {
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
    const total = await payrollModel_1.Payroll.countDocuments(filter);
    // Get base payroll records with proper typing for populated fields
    const payrolls = await payrollModel_1.Payroll.find(filter)
        .skip(skip)
        .limit(Number(limit))
        .sort({ period: -1, createdAt: -1 })
        .populate({
        path: 'employee',
        select: 'firstName lastName role emiratesId'
    })
        .populate({
        path: 'createdBy',
        select: 'firstName lastName'
    });
    // Enhance with data from other models
    const enhancedPayrolls = await Promise.all(payrolls.map(async (payroll) => {
        // Ensure employee is populated and has the expected properties
        if (!payroll.employee || typeof payroll.employee !== 'object') {
            throw new Error('Employee data not properly populated');
        }
        const employeeExpense = await employeeExpenseModel_1.EmployeeExpense.findOne({
            employee: payroll.employee._id
        }).lean();
        const overtime = await (0, exports.calculateOvertime)(payroll.employee._id, payroll.period);
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
    }));
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        payrolls: enhancedPayrolls,
        pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
            hasNextPage: Number(page) * Number(limit) < total,
            hasPreviousPage: Number(page) > 1,
        },
    }, "Payrolls retrieved successfully"));
});
// Get single payroll record
exports.getPayroll = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const payroll = await payrollModel_1.Payroll.findById(id)
        .populate({
        path: 'employee',
        select: 'firstName lastName role emiratesId'
    })
        .populate({
        path: 'createdBy',
        select: 'firstName lastName'
    });
    if (!payroll) {
        throw new apiHandlerHelpers_2.ApiError(404, "Payroll not found");
    }
    // Type guard to ensure employee is properly populated
    if (!payroll.employee || typeof payroll.employee !== 'object' || !('firstName' in payroll.employee)) {
        throw new apiHandlerHelpers_2.ApiError(500, "Employee data not properly populated");
    }
    // Enhance with additional data
    const employeeExpense = await employeeExpenseModel_1.EmployeeExpense.findOne({
        employee: payroll.employee._id
    }).lean();
    const overtime = await (0, exports.calculateOvertime)(payroll.employee._id, payroll.period);
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
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, enhancedPayroll, "Payroll retrieved successfully"));
});
// Update payroll record
exports.updatePayroll = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const payroll = await payrollModel_1.Payroll.findById(id);
    if (!payroll) {
        throw new apiHandlerHelpers_2.ApiError(404, "Payroll not found");
    }
    // Check for duplicate payroll if employee/period is updated
    if (updateData.employee || updateData.period) {
        const employeeId = updateData.employee || payroll.employee;
        const period = updateData.period || payroll.period;
        const existingPayroll = await payrollModel_1.Payroll.findOne({
            _id: { $ne: id },
            employee: employeeId,
            period
        });
        if (existingPayroll) {
            throw new apiHandlerHelpers_2.ApiError(400, "Payroll already exists for this employee and period");
        }
    }
    // --- Cast incoming financial fields to numbers ---
    if (updateData.allowance !== undefined)
        updateData.allowance = Number(updateData.allowance) || 0;
    if (updateData.deduction !== undefined)
        updateData.deduction = Number(updateData.deduction) || 0;
    if (updateData.mess !== undefined)
        updateData.mess = Number(updateData.mess) || 0;
    if (updateData.advance !== undefined)
        updateData.advance = Number(updateData.advance) || 0;
    // Recalculate net if financial fields changed
    if (updateData.allowance !== undefined ||
        updateData.deduction !== undefined ||
        updateData.mess !== undefined ||
        updateData.advance !== undefined) {
        const employeeExpense = await employeeExpenseModel_1.EmployeeExpense.findOne({
            employee: updateData.employee || payroll.employee
        });
        const basicSalary = Number(employeeExpense?.basicSalary) || 0;
        const allowance = updateData.allowance ?? payroll.allowance;
        const deduction = updateData.deduction ?? payroll.deduction;
        const mess = updateData.mess ?? payroll.mess;
        const advance = updateData.advance ?? payroll.advance;
        const overtime = await (0, exports.calculateOvertime)(updateData.employee || payroll.employee, updateData.period || payroll.period);
        updateData.net = (basicSalary + allowance + overtime) - deduction - mess - advance;
    }
    const updatedPayroll = await payrollModel_1.Payroll.findByIdAndUpdate(id, updateData, {
        new: true
    })
        .populate({
        path: "employee",
        select: "firstName lastName role emiratesId"
    })
        .populate({
        path: "createdBy",
        select: "firstName lastName"
    });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, updatedPayroll, "Payroll updated successfully"));
});
// Delete payroll record
exports.deletePayroll = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const payroll = await payrollModel_1.Payroll.findByIdAndDelete(id);
    if (!payroll) {
        throw new apiHandlerHelpers_2.ApiError(404, "Payroll not found");
    }
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "Payroll deleted successfully"));
});
// Export payrolls to Excel
exports.exportPayrollsToExcel = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const filter = {};
    // Apply filters with type safety
    if (req.query.period)
        filter.period = req.query.period;
    if (req.query.employee)
        filter.employee = req.query.employee;
    if (req.query.labourCard)
        filter.labourCard = req.query.labourCard;
    const payrolls = await payrollModel_1.Payroll.find(filter)
        .sort({ period: -1, createdAt: -1 })
        .populate({
        path: 'employee',
        select: 'firstName lastName role emiratesId'
    });
    // Create workbook and worksheet
    const workbook = new exceljs_1.default.Workbook();
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
        const employeeExpense = await employeeExpenseModel_1.EmployeeExpense.findOne({
            employee: payroll.employee._id
        }).lean();
        const overtime = await (0, exports.calculateOvertime)(payroll.employee._id, payroll.period);
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
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=payroll_report_${new Date().toISOString().split('T')[0]}.xlsx`);
    // Send the workbook
    await workbook.xlsx.write(res);
    res.end();
});
//# sourceMappingURL=payrollController.js.map