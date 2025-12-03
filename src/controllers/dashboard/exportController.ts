import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/apiHandlerHelpers";
import { ApiError } from "../../utils/apiHandlerHelpers";
import { Budget } from "../../models/budgetModel";
import { Expense } from "../../models/expenseModel";
import { Project } from "../../models/projectModel";
import { Quotation } from "../../models/quotationModel";
import { Estimation } from "../../models/estimationModel";
import { LPO } from "../../models/lpoModel";
import { Payroll } from "../../models/payrollModel";
import dayjs from "dayjs";
import ExcelJS from "exceljs";

interface ProjectYearlyData {
    projectStartMonth: string;
    clientName: string;
    quotationDate: string;
    quotationNumber: string;
    poDate: string;
    poNumber: string;
    grnNumber: string;
    invoiceNumber: string;
    estimationNumber: string;
    location: string;
    projectName: string;
    quotationAmount: number;
    estimationAmount: number;
    commission: number;
    labourCosts: number;
    materialCosts: number;
    miscellaneousCosts: number;
    totalExpenses: number;
    profitLoss: number;
    workStartDate: string;
    workEndDate: string;
    status: string;
    attentionPerson: string;
}

// Get Monthly Report with Project Profit
export const getMonthlyReport = asyncHandler(async (req: Request, res: Response) => {
    const { month, year, export: exportType } = req.query;

    if (!month || !year) {
        throw new ApiError(400, "Month and year are required");
    }

    const selectedMonth = parseInt(month as string);
    const selectedYear = parseInt(year as string);

    try {
        const startDate = new Date(selectedYear, selectedMonth - 1, 1);
        const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);

        // 1. PROFIT DATA (Budget - Material Expenses)
        const budgets = await Budget.find({
            "monthlyBudgets": {
                $elemMatch: {
                    month: selectedMonth,
                    year: selectedYear
                }
            }
        }).populate("project", "projectName projectNumber");

        let totalRevenue = 0;
        let totalExpenses = 0;
        const projectProfitData = [];

        for (const budget of budgets) {
            const project = budget.project as any;
            const monthlyBudgetAllocation = budget.monthlyBudgets.find(
                mb => mb.month === selectedMonth && mb.year === selectedYear
            );

            if (!monthlyBudgetAllocation) continue;

            totalRevenue += monthlyBudgetAllocation.allocatedAmount;

            const expenses = await Expense.find({
                project: budget.project,
                "materials.date": {
                    $gte: startDate,
                    $lte: endDate
                }
            });

            const monthlyMaterialExpense = expenses.reduce((total, expense) => {
                const materialCostForMonth = expense.materials
                    .filter(material => {
                        const materialDate = new Date(material.date);
                        return materialDate >= startDate && materialDate <= endDate;
                    })
                    .reduce((sum, material) => sum + material.amount, 0);
                return total + materialCostForMonth;
            }, 0);

            totalExpenses += monthlyMaterialExpense;

            projectProfitData.push({
                projectName: project.projectName,
                projectNumber: project.projectNumber,
                monthlyBudget: monthlyBudgetAllocation.allocatedAmount,
                monthlyMaterialExpense,
                profit: monthlyBudgetAllocation.allocatedAmount - monthlyMaterialExpense
            });
        }

        const profit = totalRevenue - totalExpenses;
        const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

        // 2. PAYROLL DATA
        const payrollCreationMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
        const payrollCreationYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
        const payrollStartDate = dayjs(`${payrollCreationYear}-${String(payrollCreationMonth).padStart(2, '0')}-01`)
            .startOf('month').toDate();
        const payrollEndDate = dayjs(`${payrollCreationYear}-${String(payrollCreationMonth).padStart(2, '0')}-01`)
            .endOf('month').toDate();

        const payrolls = await Payroll.find({
            createdAt: { $gte: payrollStartDate, $lte: payrollEndDate }
        }).populate('employee', 'firstName lastName');

        const totalPayroll = payrolls.reduce((sum, p) => sum + (p.net || 0), 0);
        const totalEmployees = payrolls.length;
        const averageSalary = totalEmployees > 0 ? totalPayroll / totalEmployees : 0;
        const totalOvertimeHours = payrolls.reduce((sum, p) => {
            const regularOT = p.calculationDetails?.attendanceSummary?.totalOvertimeHours || 0;
            const sundayOT = p.calculationDetails?.attendanceSummary?.sundayOvertimeHours || 0;
            return sum + regularOT + sundayOT;
        }, 0);

        // 3. PROJECT DATA
        const totalProjects = await Project.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate }
        });
        const activeProjects = await Project.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'project_closed'] }
        });

        // 4. INVOICE DATA
        const invoices = await Quotation.find({
            createdAt: { $gte: startDate, $lte: endDate }
        });
        const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + (inv.netAmount || 0), 0);
        const pendingInvoices = invoices.filter(inv => !inv.isApproved);
        const pendingInvoiceAmount = pendingInvoices.reduce((sum, inv) => sum + (inv.netAmount || 0), 0);

        const monthlyReport = {
            period: {
                month: selectedMonth,
                year: selectedYear,
                monthName: dayjs(`${selectedYear}-${selectedMonth}-01`).format('MMMM YYYY')
            },
            profit: {
                revenue: totalRevenue,
                expenses: totalExpenses,
                profit,
                profitMargin,
                projectsCount: budgets.length,
                projectBreakdown: projectProfitData
            },
            payroll: {
                totalPayroll,
                totalEmployees,
                averageSalary,
                overtimeHours: totalOvertimeHours
            },
            projects: {
                total: totalProjects,
                active: activeProjects
            },
            invoices: {
                total: invoices.length,
                totalAmount: totalInvoiceAmount,
                pending: pendingInvoices.length,
                pendingAmount: pendingInvoiceAmount
            }
        };

        if (exportType === 'excel') {
            return generateMonthlyReportExcel(monthlyReport, res);
        }

        return res.status(200).json(
            new ApiResponse(200, monthlyReport, "Monthly report fetched successfully")
        );
    } catch (error) {
        console.error("Error in getMonthlyReport:", error);
        throw new ApiError(500, "Failed to fetch monthly report");
    }
});

// Get Enhanced Yearly Report
export const getYearlyReport = asyncHandler(async (req: Request, res: Response) => {
    const { year, export: exportType } = req.query;

    if (!year) {
        throw new ApiError(400, "Year is required");
    }

    const selectedYear = parseInt(year as string);
    const currentYear = new Date().getFullYear();
    const isCurrentYear = selectedYear === currentYear;

    try {
        const yearStart = new Date(selectedYear, 0, 1);
        const yearEnd = isCurrentYear ? new Date() : new Date(selectedYear, 11, 31, 23, 59, 59);

        // Find all projects with activity in the selected year
        const projectsWithActivity = await Project.find({
            $or: [
                { workStartDate: { $gte: yearStart, $lte: yearEnd } },
                { createdAt: { $gte: yearStart, $lte: yearEnd } }
            ]
        }).populate('client', 'clientName');

        const projectYearlyData: ProjectYearlyData[] = [];

        for (const project of projectsWithActivity) {
            // Get Quotation
            const quotation = await Quotation.findOne({ project: project._id });

            // Get Estimation
            const estimation = await Estimation.findOne({ project: project._id });

            // Get LPO (PO)
            const lpo = await LPO.findOne({ project: project._id });

            // Get all expenses for this project in the year
            const expenses = await Expense.find({
                project: project._id,
                $or: [
                    { "materials.date": { $gte: yearStart, $lte: yearEnd } },
                    { "miscellaneous.date": { $gte: yearStart, $lte: yearEnd } }
                ]
            }).populate('laborDetails.workers.user laborDetails.drivers.user', 'firstName lastName');

            // Calculate material costs
            const materialCosts = expenses.reduce((total, expense) => {
                const yearMaterialCost = expense.materials
                    .filter(material => {
                        const materialDate = new Date(material.date);
                        return materialDate >= yearStart && materialDate <= yearEnd;
                    })
                    .reduce((sum, material) => sum + material.amount, 0);
                return total + yearMaterialCost;
            }, 0);

            // Calculate miscellaneous costs
            const miscellaneousCosts = expenses.reduce((total, expense) => {
                const yearMiscCost = expense.miscellaneous
                    .filter(misc => {
                        const miscDate = new Date(misc.date);
                        return miscDate >= yearStart && miscDate <= yearEnd;
                    })
                    .reduce((sum, misc) => sum + misc.total, 0);
                return total + yearMiscCost;
            }, 0);

            // Calculate labour costs (only workers and drivers assigned to project)
            const labourCosts = expenses.reduce((total, expense) => {
                const workersCost = expense.laborDetails.workers.reduce(
                    (sum, worker) => sum + worker.totalSalary,
                    0
                );
                const driversCost = expense.laborDetails.drivers.reduce(
                    (sum, driver) => sum + driver.totalSalary,
                    0
                );
                return total + workersCost + driversCost;
            }, 0);

            const totalExpenses = materialCosts + miscellaneousCosts + labourCosts;
            const quotationAmount = quotation?.netAmount || 0;
            const estimationAmount = estimation?.estimatedAmount || 0;
            const commission = estimation?.commissionAmount || 0;
            const profitLoss = quotationAmount - totalExpenses - commission;

            // Generate invoice number
            const invoiceNumber = `INV${project.projectNumber.slice(3, 20)}`;

            projectYearlyData.push({
                projectStartMonth: project.workStartDate
                    ? dayjs(project.workStartDate).format('MMMM YYYY')
                    : 'N/A',
                clientName: (project.client as any)?.clientName || 'N/A',
                quotationDate: quotation?.date
                    ? dayjs(quotation.date).format('DD/MM/YYYY')
                    : 'N/A',
                quotationNumber: quotation?.quotationNumber || 'N/A',
                poDate: lpo?.lpoDate
                    ? dayjs(lpo.lpoDate).format('DD/MM/YYYY')
                    : 'N/A',
                poNumber: lpo?.lpoNumber || 'N/A',
                grnNumber: project.grnNumber || 'N/A',
                invoiceNumber,
                estimationNumber: estimation?.estimationNumber || 'N/A',
                location: project.location || 'N/A',
                projectName: project.projectName,
                quotationAmount,
                estimationAmount,
                commission,
                labourCosts,
                materialCosts,
                miscellaneousCosts,
                totalExpenses,
                profitLoss,
                workStartDate: project.workStartDate
                    ? dayjs(project.workStartDate).format('DD/MM/YYYY')
                    : 'N/A',
                workEndDate: project.workEndDate
                    ? dayjs(project.workEndDate).format('DD/MM/YYYY')
                    : 'N/A',
                status: project.status,
                attentionPerson: project.attention || 'N/A'
            });
        }

        // Calculate totals
        const totalQuotationAmount = projectYearlyData.reduce((sum, p) => sum + p.quotationAmount, 0);
        const totalEstimationAmount = projectYearlyData.reduce((sum, p) => sum + p.estimationAmount, 0);
        const totalCommission = projectYearlyData.reduce((sum, p) => sum + p.commission, 0);
        const totalLabourCosts = projectYearlyData.reduce((sum, p) => sum + p.labourCosts, 0);
        const totalMaterialCosts = projectYearlyData.reduce((sum, p) => sum + p.materialCosts, 0);
        const totalMiscellaneousCosts = projectYearlyData.reduce((sum, p) => sum + p.miscellaneousCosts, 0);
        const totalExpensesSum = projectYearlyData.reduce((sum, p) => sum + p.totalExpenses, 0);
        const totalProfitLoss = projectYearlyData.reduce((sum, p) => sum + p.profitLoss, 0);

        const yearlyReport = {
            year: selectedYear,
            isCurrentYear,
            reportType: isCurrentYear ? 'Year to Date' : 'Full Year',
            summary: {
                totalProjects: projectYearlyData.length,
                totalQuotationAmount,
                totalEstimationAmount,
                totalCommission,
                totalLabourCosts,
                totalMaterialCosts,
                totalMiscellaneousCosts,
                totalExpenses: totalExpensesSum,
                totalProfitLoss,
                profitMargin: totalQuotationAmount > 0
                    ? ((totalProfitLoss / totalQuotationAmount) * 100).toFixed(2) + '%'
                    : '0%'
            },
            projects: projectYearlyData
        };

        if (exportType === 'excel') {
            return generateYearlyReportExcel(yearlyReport, res);
        }

        return res.status(200).json(
            new ApiResponse(200, yearlyReport, "Yearly report fetched successfully")
        );
    } catch (error) {
        console.error("Error in getYearlyReport:", error);
        throw new ApiError(500, "Failed to fetch yearly report");
    }
});

// Generate Enhanced Monthly Report Excel
const generateMonthlyReportExcel = async (data: any, res: Response) => {
    const workbook = new ExcelJS.Workbook();

    // ============ SHEET 1: SUMMARY ============
    const summarySheet = workbook.addWorksheet('Summary');

    // Title
    summarySheet.mergeCells('A1:D1');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = `Monthly Report - ${data.period.monthName}`;
    titleCell.font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
    };
    summarySheet.getRow(1).height = 35;

    summarySheet.addRow([]);

    // Financial Summary Header
    summarySheet.mergeCells('A3:D3');
    const financialHeader = summarySheet.getCell('A3');
    financialHeader.value = 'Financial Summary';
    financialHeader.font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    financialHeader.alignment = { horizontal: 'left', vertical: 'middle' };
    financialHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    summarySheet.getRow(3).height = 25;

    // Table headers
    const headerRow = summarySheet.addRow(['Category', 'Metric', 'Value', 'Unit']);
    headerRow.font = { bold: true, size: 11 };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' }
    };
    headerRow.height = 22;

    headerRow.eachCell((cell) => {
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    });

    // Financial data rows
    const financialData = [
        ['Profit', 'Revenue', data.profit.revenue, 'AED'],
        ['', 'Expenses', data.profit.expenses, 'AED'],
        ['', 'Profit', data.profit.profit, 'AED'],
        ['', 'Profit Margin', data.profit.profitMargin.toFixed(2), '%'],
        ['Payroll', 'Total Payroll', data.payroll.totalPayroll, 'AED'],
        ['', 'Employees', data.payroll.totalEmployees, 'Count'],
        ['', 'Average Salary', data.payroll.averageSalary.toFixed(2), 'AED'],
        ['Projects', 'Total', data.projects.total, 'Count'],
        ['', 'Active', data.projects.active, 'Count']
    ];

    financialData.forEach((rowData, index) => {
        const row = summarySheet.addRow(rowData);
        row.height = 20;
        row.alignment = { vertical: 'middle' };

        row.eachCell((cell, colNum) => {
            if (colNum === 3 && typeof cell.value === 'number') {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else {
                cell.alignment = { horizontal: colNum === 1 ? 'left' : 'center', vertical: 'middle' };
            }

            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
            };

            if (rowData[1] === 'Profit') {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: data.profit.profit >= 0 ? 'FFE2EFDA' : 'FFFCE4D6' }
                };
                if (colNum === 3) {
                    cell.font = { bold: true, color: { argb: data.profit.profit >= 0 ? 'FF375623' : 'FFC55A11' } };
                }
            }
        });
    });

    summarySheet.columns = [
        { width: 18 },
        { width: 25 },
        { width: 18 },
        { width: 10 }
    ];

    // ============ SHEET 2: PROJECT BREAKDOWN ============
    const projectSheet = workbook.addWorksheet('Project Breakdown');

    // Title
    projectSheet.mergeCells('A1:E1');
    const projectTitle = projectSheet.getCell('A1');
    projectTitle.value = `Project Profit Breakdown - ${data.period.monthName}`;
    projectTitle.font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
    projectTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    projectTitle.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
    };
    projectSheet.getRow(1).height = 35;

    projectSheet.addRow([]);

    // Headers
    const projectHeaderRow = projectSheet.addRow([
        'Project Name',
        'Project Number',
        'Monthly Budget',
        'Material Expense',
        'Profit'
    ]);

    projectHeaderRow.font = { bold: true, size: 11 };
    projectHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };
    projectHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    projectHeaderRow.height = 25;

    projectHeaderRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    });

    // Data rows
    let totalBudget = 0;
    let totalExpense = 0;
    let totalProfit = 0;

    data.profit.projectBreakdown.forEach((project: any, index: number) => {
        const row = projectSheet.addRow([
            project.projectName,
            project.projectNumber,
            project.monthlyBudget,
            project.monthlyMaterialExpense,
            project.profit
        ]);

        totalBudget += project.monthlyBudget;
        totalExpense += project.monthlyMaterialExpense;
        totalProfit += project.profit;

        row.height = 20;
        row.alignment = { vertical: 'middle' };

        row.eachCell((cell, colNum) => {
            if ([3, 4, 5].includes(colNum)) {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else {
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }

            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2' }
            };

            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
            };
        });

        // Color profit cell
        const profitCell = row.getCell(5);
        if (project.profit > 0) {
            profitCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE2EFDA' }
            };
            profitCell.font = { bold: true, color: { argb: 'FF375623' } };
        } else if (project.profit < 0) {
            profitCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFCE4D6' }
            };
            profitCell.font = { bold: true, color: { argb: 'FFC55A11' } };
        }
    });

    // Total row
    const totalRow = projectSheet.addRow([
        'TOTAL',
        '',
        totalBudget,
        totalExpense,
        totalProfit
    ]);

    totalRow.height = 25;
    totalRow.font = { bold: true, size: 11 };
    totalRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' }
    };

    totalRow.eachCell((cell, colNum) => {
        cell.alignment = { horizontal: colNum === 1 ? 'left' : 'right', vertical: 'middle' };
        if ([3, 4, 5].includes(colNum)) {
            cell.numFmt = '#,##0.00';
        }
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    });

    projectSheet.columns = [
        { width: 35 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 15 }
    ];

    const fileName = `monthly-report-${data.period.month}-${data.period.year}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
};

// Generate Enhanced Yearly Report Excel
const generateYearlyReportExcel = async (data: any, res: Response) => {
    const workbook = new ExcelJS.Workbook();

    // ============ SHEET 1: SUMMARY ============
    const summarySheet = workbook.addWorksheet('Summary');

    // Title - Using same style as monthly
    summarySheet.mergeCells('A1:D1');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = `Yearly Report - ${data.year}`;
    titleCell.font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
    };
    summarySheet.getRow(1).height = 35;

    summarySheet.addRow([]);

    // Financial Summary Header - Same blue as monthly
    summarySheet.mergeCells('A3:D3');
    const financialHeader = summarySheet.getCell('A3');
    financialHeader.value = 'Financial Summary';
    financialHeader.font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    financialHeader.alignment = { horizontal: 'left', vertical: 'middle' };
    financialHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    summarySheet.getRow(3).height = 25;

    // Table headers - Same style as monthly
    const headerRow = summarySheet.addRow(['Category', 'Metric', 'Value', 'Unit']);
    headerRow.font = { bold: true, size: 11 };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' }
    };
    headerRow.height = 22;

    headerRow.eachCell((cell) => {
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    });

    // Financial data rows - Consistent with monthly report
    const financialData = [
        ['Revenue', 'Quotation Amount', data.summary.totalQuotationAmount, 'AED'],
        ['', 'Estimation Amount', data.summary.totalEstimationAmount, 'AED'],
        ['', 'Total Commission', data.summary.totalCommission, 'AED'],
        ['', 'Total Expenses', data.summary.totalExpenses, 'AED'],
        ['Profit/Loss', 'Total Profit/Loss', data.summary.totalProfitLoss, 'AED'],
        ['', 'Profit Margin', data.summary.profitMargin, ''],
        ['Cost Breakdown', 'Labour Costs', data.summary.totalLabourCosts, 'AED'],
        ['', 'Material Costs', data.summary.totalMaterialCosts, 'AED'],
        ['', 'Miscellaneous Costs', data.summary.totalMiscellaneousCosts, 'AED'],
        ['Projects', 'Total Projects', data.summary.totalProjects, 'Count']
    ];

    financialData.forEach((rowData, index) => {
        const row = summarySheet.addRow(rowData);
        row.height = 20;
        row.alignment = { vertical: 'middle' };

        row.eachCell((cell, colNum) => {
            if (colNum === 3 && typeof cell.value === 'number') {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else {
                cell.alignment = { horizontal: colNum === 1 ? 'left' : 'center', vertical: 'middle' };
            }

            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
            };

            // Color coding for profit/loss
            if (rowData[1] === 'Total Profit/Loss') {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: data.summary.totalProfitLoss >= 0 ? 'FFE2EFDA' : 'FFFCE4D6' }
                };
                if (colNum === 3) {
                    cell.font = { bold: true, color: { argb: data.summary.totalProfitLoss >= 0 ? 'FF375623' : 'FFC55A11' } };
                }
            }
        });
    });

    summarySheet.columns = [
        { width: 18 },
        { width: 25 },
        { width: 18 },
        { width: 10 }
    ];

    // ============ SHEET 2: PROJECT DETAILS ============
    const detailsSheet = workbook.addWorksheet('Project Details');

    // Title - Same style as monthly
    detailsSheet.mergeCells('A1:W1');
    const detailsTitle = detailsSheet.getCell('A1');
    detailsTitle.value = `Project Details - ${data.year}`;
    detailsTitle.font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
    detailsTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    detailsTitle.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
    };
    detailsSheet.getRow(1).height = 35;

    detailsSheet.addRow([]);

    // Headers - Same blue as monthly
    const headers = [
        'Project Start Month',
        'Client Name',
        'Quotation Date',
        'Quotation Number',
        'PO Date',
        'PO Number',
        'GRN Number',
        'Invoice Number',
        'Estimation Number',
        'Location',
        'Project Name',
        'Quotation Amount',
        'Estimation Amount',
        'Commission',
        'Labour Costs',
        'Material Costs',
        'Miscellaneous Costs',
        'Total Expenses',
        'Profit/Loss',
        'Work Start Date',
        'Work End Date',
        'Status',
        'Attention Person'
    ];

    const headerRowDetails = detailsSheet.addRow(headers);
    headerRowDetails.height = 25;
    headerRowDetails.font = { bold: true, size: 11 };
    headerRowDetails.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRowDetails.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };

    headerRowDetails.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    });

    // Add data rows with alternating colors
    data.projects.forEach((project: ProjectYearlyData, index: number) => {
        const row = detailsSheet.addRow([
            project.projectStartMonth,
            project.clientName,
            project.quotationDate,
            project.quotationNumber,
            project.poDate,
            project.poNumber,
            project.grnNumber,
            project.invoiceNumber,
            project.estimationNumber,
            project.location,
            project.projectName,
            project.quotationAmount,
            project.estimationAmount,
            project.commission,
            project.labourCosts,
            project.materialCosts,
            project.miscellaneousCosts,
            project.totalExpenses,
            project.profitLoss,
            project.workStartDate,
            project.workEndDate,
            project.status,
            project.attentionPerson
        ]);

        row.height = 22;
        row.alignment = { vertical: 'middle', wrapText: true };

        // Alternating row colors - same as monthly
        const rowColor = index % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2';

        row.eachCell((cell, colNum) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: rowColor }
            };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
            };

            // Number formatting for currency columns
            if ([12, 13, 14, 15, 16, 17, 18, 19].includes(colNum)) {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            }
        });

        // Color code profit/loss cell - same as monthly
        const profitCell = row.getCell(19);
        if (project.profitLoss > 0) {
            profitCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE2EFDA' }
            };
            profitCell.font = { bold: true, color: { argb: 'FF375623' } };
        } else if (project.profitLoss < 0) {
            profitCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFCE4D6' }
            };
            profitCell.font = { bold: true, color: { argb: 'FFC55A11' } };
        }

        // Subtle status coloring
        const statusCell = row.getCell(22);
        statusCell.font = { bold: true };
    });

    // Add totals row - same style as monthly
    detailsSheet.addRow([]);
    const totalsRow = detailsSheet.addRow([
        '', '', '', '', '', '', '', '', '', '',
        'TOTALS',
        data.summary.totalQuotationAmount,
        data.summary.totalEstimationAmount,
        data.summary.totalCommission,
        data.summary.totalLabourCosts,
        data.summary.totalMaterialCosts,
        data.summary.totalMiscellaneousCosts,
        data.summary.totalExpenses,
        data.summary.totalProfitLoss,
        '', '', '', ''
    ]);

    totalsRow.height = 25;
    totalsRow.font = { bold: true, size: 11 };
    totalsRow.alignment = { horizontal: 'right', vertical: 'middle' };
    totalsRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' }
    };

    totalsRow.eachCell((cell, colNum) => {
        if ([12, 13, 14, 15, 16, 17, 18, 19].includes(colNum)) {
            cell.numFmt = '#,##0.00';
        }
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    });

    // Auto-fit columns
    detailsSheet.columns.forEach((column: any, index: number) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell: any) => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
                maxLength = columnLength;
            }
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 40);
    });

    // Freeze header rows
    detailsSheet.views = [
        { state: 'frozen', xSplit: 0, ySplit: 3 }
    ];

    const fileName = `yearly-report-${data.year}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
};