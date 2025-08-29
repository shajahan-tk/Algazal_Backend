"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateYearlyReport = exports.generateMonthlyReport = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const billModel_1 = require("../models/billModel");
const payrollModel_1 = require("../models/payrollModel");
const categoryModel_1 = require("../models/categoryModel");
const exceljs_1 = __importDefault(require("exceljs"));
function getBillDescription(bill) {
    switch (bill.billType) {
        case 'general':
            return bill.remarks || `General bill from ${bill?.shopDetails?.shopName || 'unknown shop'}`;
        case 'fuel':
            return bill.description ||
                `Fuel for ${bill.vehicle ? bill.vehicle.toString() : 'unknown vehicle'}` +
                    (bill.kilometer ? ` (${bill.kilometer} km)` : '') +
                    (bill.liter ? ` (${bill.liter} L)` : '');
        case 'mess':
            return bill.remarks || 'Mess expenses';
        case 'vehicle':
            return bill.purpose ||
                `Vehicle maintenance for ${bill.vehicles?.length ? bill.vehicles.length + ' vehicles' : 'unknown vehicle'}`;
        case 'accommodation':
            return bill.note ||
                (bill.roomNo ? `Accommodation for room ${bill.roomNo}` : 'Accommodation expenses');
        case 'commission':
            return bill.remarks || 'Commission payment';
        default:
            return bill.remarks || 'No description available';
    }
}
exports.generateMonthlyReport = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { year, month } = req.query;
    // Validate inputs
    if (!year || !month) {
        throw new apiHandlerHelpers_1.ApiError(400, "Year and month are required");
    }
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new apiHandlerHelpers_1.ApiError(400, "Invalid year or month value");
    }
    // Calculate date range with proper timezone handling
    const startDate = new Date(Date.UTC(yearNum, monthNum - 1, 1));
    const endDate = new Date(Date.UTC(yearNum, monthNum, 0, 23, 59, 59));
    // Create workbook
    const workbook = new exceljs_1.default.Workbook();
    const summarySheet = workbook.addWorksheet("Summary");
    const detailedBreakdownSheet = workbook.addWorksheet("Detailed Breakdown");
    const billsSheet = workbook.addWorksheet("Bills");
    const payrollSheet = workbook.addWorksheet("Payroll");
    const categorySheet = workbook.addWorksheet("Categories");
    // Get bills with proper number conversion
    const bills = await billModel_1.Bill.aggregate([
        {
            $match: {
                billDate: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $addFields: {
                amount: { $toDouble: "$amount" } // Ensure numeric
            }
        },
        {
            $lookup: {
                from: "categories",
                localField: "category",
                foreignField: "_id",
                as: "categoryDetails"
            }
        },
        { $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: "shops",
                localField: "shop",
                foreignField: "_id",
                as: "shopDetails"
            }
        },
        { $unwind: { path: "$shopDetails", preserveNullAndEmptyArrays: true } }
    ]);
    // Get payroll with proper number conversion
    const period = `${monthNum.toString().padStart(2, '0')}-${yearNum}`;
    const payrolls = await payrollModel_1.Payroll.aggregate([
        {
            $match: {
                period: { $regex: new RegExp(`^${period}$`) }
            }
        },
        {
            $addFields: {
                allowance: { $toDouble: "$allowance" },
                deduction: { $toDouble: "$deduction" },
                mess: { $toDouble: "$mess" },
                advance: { $toDouble: "$advance" },
                net: { $toDouble: "$net" }
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "employee",
                foreignField: "_id",
                as: "employeeDetails"
            }
        },
        { $unwind: "$employeeDetails" }
    ]);
    // Calculate totals with proper rounding
    const totalBills = parseFloat(bills.reduce((sum, bill) => sum + (bill.amount || 0), 0).toFixed(2));
    const totalPayroll = parseFloat(payrolls.reduce((sum, payroll) => sum + (payroll.net || 0), 0).toFixed(2));
    const grandTotal = parseFloat((totalBills + totalPayroll).toFixed(2));
    // Summary Sheet
    summarySheet.columns = [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Amount (AED)", key: "amount", width: 20, style: { numFmt: "#,##0.00" } }
    ];
    summarySheet.addRows([
        { metric: "Total Bills", amount: totalBills },
        { metric: "Total Payroll", amount: totalPayroll },
        { metric: "Grand Total", amount: grandTotal }
    ]);
    // Detailed Breakdown Sheet - Simple Bill Type + Category format
    detailedBreakdownSheet.columns = [
        { header: "Bill Type + Category", key: "description", width: 40 },
        { header: "Total Amount (AED)", key: "totalAmount", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Count", key: "count", width: 10 }
    ];
    // Get categories for later use
    const categories = await categoryModel_1.Category.find();
    // Create simple breakdown exactly as requested
    const billTypeCategories = [];
    // Group bills by bill type and category combination
    bills.forEach(bill => {
        const billType = bill.billType || 'general';
        const categoryName = bill.categoryDetails?.name || 'Uncategorized';
        const key = `${billType}_${categoryName}`;
        const existing = billTypeCategories.find(item => item.key === key);
        if (existing) {
            existing.total += bill.amount;
            existing.count += 1;
        }
        else {
            billTypeCategories.push({
                key: key,
                billType: billType,
                category: categoryName,
                description: `${billType} bills ${categoryName} category`,
                total: bill.amount,
                count: 1
            });
        }
    });
    // Sort by bill type and then by category
    billTypeCategories.sort((a, b) => {
        if (a.billType !== b.billType) {
            return a.billType.localeCompare(b.billType);
        }
        return a.category.localeCompare(b.category);
    });
    // Add rows exactly as requested format
    billTypeCategories.forEach(item => {
        detailedBreakdownSheet.addRow({
            description: item.description,
            totalAmount: parseFloat(item.total.toFixed(2)),
            count: item.count
        });
    });
    // Rest of the function remains the same...
    // Bills Sheet
    billsSheet.columns = [
        { header: "Date", key: "date", width: 12, style: { numFmt: "dd-mmm-yyyy" } },
        { header: "Type", key: "type", width: 15 },
        { header: "Category", key: "category", width: 20 },
        { header: "Shop", key: "shop", width: 20 },
        { header: "Amount", key: "amount", width: 15, style: { numFmt: "#,##0.00" } },
        { header: "Description", key: "description", width: 40 }
    ];
    bills.forEach(bill => {
        billsSheet.addRow({
            date: bill.billDate,
            type: bill.billType,
            category: bill.categoryDetails?.name || "N/A",
            shop: bill.shopDetails?.shopName || "N/A",
            amount: parseFloat(bill.amount.toFixed(2)),
            description: getBillDescription(bill)
        });
    });
    // Payroll Sheet
    payrollSheet.columns = [
        { header: "Employee", key: "employee", width: 25 },
        { header: "Labour Card", key: "labourCard", width: 15 },
        { header: "Allowance", key: "allowance", width: 15, style: { numFmt: "#,##0.00" } },
        { header: "Deduction", key: "deduction", width: 15, style: { numFmt: "#,##0.00" } },
        { header: "Mess", key: "mess", width: 15, style: { numFmt: "#,##0.00" } },
        { header: "Advance", key: "advance", width: 15, style: { numFmt: "#,##0.00" } },
        { header: "Net Salary", key: "net", width: 15, style: { numFmt: "#,##0.00" } },
        { header: "Period", key: "period", width: 12 }
    ];
    payrolls.forEach(payroll => {
        payrollSheet.addRow({
            employee: `${payroll.employeeDetails.firstName} ${payroll.employeeDetails.lastName}`,
            labourCard: payroll.labourCard,
            allowance: parseFloat(payroll.allowance.toFixed(2)),
            deduction: parseFloat(payroll.deduction.toFixed(2)),
            mess: parseFloat(payroll.mess.toFixed(2)),
            advance: parseFloat(payroll.advance.toFixed(2)),
            net: parseFloat(payroll.net.toFixed(2)),
            period: payroll.period
        });
    });
    // Category Breakdown Sheet
    categorySheet.columns = [
        { header: "Category", key: "category", width: 25 },
        { header: "Total", key: "total", width: 15, style: { numFmt: "#,##0.00" } },
        { header: "Count", key: "count", width: 10 },
        { header: "Average", key: "average", width: 15, style: { numFmt: "#,##0.00" } }
    ];
    categories.forEach(category => {
        const categoryBills = bills.filter(bill => bill.categoryDetails?._id.equals(category._id));
        const categoryTotal = parseFloat(categoryBills
            .reduce((sum, bill) => sum + (bill.amount || 0), 0)
            .toFixed(2));
        const categoryAverage = categoryBills.length > 0 ? categoryTotal / categoryBills.length : 0;
        categorySheet.addRow({
            category: category.name,
            total: categoryTotal,
            count: categoryBills.length,
            average: parseFloat(categoryAverage.toFixed(2))
        });
    });
    // Style all sheets
    [summarySheet, detailedBreakdownSheet, billsSheet, payrollSheet, categorySheet].forEach(sheet => {
        // Style header row
        sheet.getRow(1).eachCell(cell => {
            cell.font = { bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3D3D3" } };
            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" }
            };
        });
        // Auto filter for data sheets
        if (sheet !== detailedBreakdownSheet) {
            sheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: sheet.columnCount }
            };
        }
    });
    // Add auto filter to detailed breakdown
    detailedBreakdownSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: detailedBreakdownSheet.columnCount }
    };
    // Send response
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=detailed_report_${year}-${month}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
});
exports.generateYearlyReport = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { year } = req.query;
    // Validate input
    if (!year) {
        throw new apiHandlerHelpers_1.ApiError(400, "Year is required");
    }
    const yearNum = parseInt(year);
    if (isNaN(yearNum)) {
        throw new apiHandlerHelpers_1.ApiError(400, "Invalid year value");
    }
    // Create a new workbook
    const workbook = new exceljs_1.default.Workbook();
    // Add sheets
    const summarySheet = workbook.addWorksheet("Summary");
    const monthlySheet = workbook.addWorksheet("Monthly Breakdown");
    const payrollSheet = workbook.addWorksheet("Payroll Summary");
    const billsSheet = workbook.addWorksheet("Bills Summary");
    // 1. Get all bills for the year
    const bills = await billModel_1.Bill.aggregate([
        {
            $match: {
                billDate: {
                    $gte: new Date(yearNum, 0, 1),
                    $lte: new Date(yearNum, 11, 31, 23, 59, 59)
                }
            }
        },
        {
            $addFields: {
                month: { $month: "$billDate" }
            }
        },
        {
            $lookup: {
                from: "categories",
                localField: "category",
                foreignField: "_id",
                as: "categoryDetails"
            }
        },
        {
            $unwind: {
                path: "$categoryDetails",
                preserveNullAndEmptyArrays: true
            }
        }
    ]);
    // 2. Get all payroll for the year
    const payrolls = await payrollModel_1.Payroll.aggregate([
        {
            $match: {
                period: { $regex: `^\\d{2}-${yearNum}$` }
            }
        },
        {
            $addFields: {
                month: { $toInt: { $substr: ["$period", 0, 2] } }
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "employee",
                foreignField: "_id",
                as: "employeeDetails"
            }
        },
        {
            $unwind: "$employeeDetails"
        }
    ]);
    // 3. Calculate totals
    const totalBills = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const totalPayroll = payrolls.reduce((sum, payroll) => sum + payroll.net, 0);
    const grandTotal = totalBills + totalPayroll;
    // 4. Create Summary Sheet
    summarySheet.columns = [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Amount (AED)", key: "amount", width: 20, style: { numFmt: "#,##0.00" } }
    ];
    summarySheet.addRows([
        { metric: "Total Bills", amount: totalBills },
        { metric: "Total Payroll", amount: totalPayroll },
        { metric: "Grand Total Expenses", amount: grandTotal }
    ]);
    // 5. Create Monthly Breakdown Sheet
    monthlySheet.columns = [
        { header: "Month", key: "month", width: 15 },
        { header: "Bills Total (AED)", key: "billsTotal", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Payroll Total (AED)", key: "payrollTotal", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Combined Total (AED)", key: "combinedTotal", width: 20, style: { numFmt: "#,##0.00" } }
    ];
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    for (let month = 1; month <= 12; month++) {
        const monthBills = bills.filter(bill => bill.month === month);
        const monthPayrolls = payrolls.filter(payroll => payroll.month === month);
        const billsTotal = monthBills.reduce((sum, bill) => sum + bill.amount, 0);
        const payrollTotal = monthPayrolls.reduce((sum, payroll) => sum + payroll.net, 0);
        monthlySheet.addRow({
            month: monthNames[month - 1],
            billsTotal,
            payrollTotal,
            combinedTotal: billsTotal + payrollTotal
        });
    }
    // 6. Create Payroll Summary Sheet
    payrollSheet.columns = [
        { header: "Employee", key: "employee", width: 25 },
        { header: "Total Allowance (AED)", key: "totalAllowance", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Total Deduction (AED)", key: "totalDeduction", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Total Mess (AED)", key: "totalMess", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Total Advance (AED)", key: "totalAdvance", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Total Net Salary (AED)", key: "totalNet", width: 20, style: { numFmt: "#,##0.00" } }
    ];
    // Group payroll by employee
    const employeePayrollMap = new Map();
    payrolls.forEach(payroll => {
        const employeeId = payroll.employee.toString();
        if (!employeePayrollMap.has(employeeId)) {
            employeePayrollMap.set(employeeId, {
                employee: `${payroll.employeeDetails.firstName} ${payroll.employeeDetails.lastName}`,
                totalAllowance: 0,
                totalDeduction: 0,
                totalMess: 0,
                totalAdvance: 0,
                totalNet: 0
            });
        }
        const entry = employeePayrollMap.get(employeeId);
        entry.totalAllowance += payroll.allowance;
        entry.totalDeduction += payroll.deduction;
        entry.totalMess += payroll.mess;
        entry.totalAdvance += payroll.advance;
        entry.totalNet += payroll.net;
    });
    // Add to sheet
    for (const entry of employeePayrollMap.values()) {
        payrollSheet.addRow(entry);
    }
    // 7. Create Bills Summary Sheet
    billsSheet.columns = [
        { header: "Bill Type", key: "billType", width: 15 },
        { header: "Total Amount (AED)", key: "totalAmount", width: 20, style: { numFmt: "#,##0.00" } },
        { header: "Count", key: "count", width: 10 }
    ];
    // Group bills by type
    const billTypeMap = new Map();
    bills.forEach(bill => {
        if (!billTypeMap.has(bill.billType)) {
            billTypeMap.set(bill.billType, {
                billType: bill.billType,
                totalAmount: 0,
                count: 0
            });
        }
        const entry = billTypeMap.get(bill.billType);
        entry.totalAmount += bill.amount;
        entry.count += 1;
    });
    // Add to sheet
    for (const entry of billTypeMap.values()) {
        billsSheet.addRow(entry);
    }
    // Add category breakdown for each bill type
    const categories = await categoryModel_1.Category.find();
    const billTypes = [...billTypeMap.keys()];
    for (const type of billTypes) {
        billsSheet.addRow({}); // Empty row
        // Add header for category breakdown
        billsSheet.addRow({
            billType: `${type} by Category`
        });
        // Get bills for this type
        const typeBills = bills.filter(bill => bill.billType === type);
        // Group by category
        const categoryMap = new Map();
        for (const bill of typeBills) {
            const categoryName = bill.categoryDetails?.name || "Uncategorized";
            if (!categoryMap.has(categoryName)) {
                categoryMap.set(categoryName, {
                    category: categoryName,
                    totalAmount: 0,
                    count: 0
                });
            }
            const entry = categoryMap.get(categoryName);
            entry.totalAmount += bill.amount;
            entry.count += 1;
        }
        // Add to sheet
        for (const entry of categoryMap.values()) {
            billsSheet.addRow({
                billType: "",
                ...entry
            });
        }
    }
    // Style all sheets
    [summarySheet, monthlySheet, payrollSheet, billsSheet].forEach(sheet => {
        // Style header row
        sheet.getRow(1).eachCell(cell => {
            cell.font = { bold: true };
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFD3D3D3" }
            };
            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" }
            };
        });
        // Freeze header row
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        // Auto filter
        sheet.autoFilter = {
            from: {
                row: 1,
                column: 1
            },
            to: {
                row: 1,
                column: sheet.columnCount
            }
        };
    });
    // Set response headers for Excel file download
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=yearly_report_${year}.xlsx`);
    // Write the workbook to the response
    await workbook.xlsx.write(res);
    res.end();
});
//# sourceMappingURL=monthlyReportController.js.map