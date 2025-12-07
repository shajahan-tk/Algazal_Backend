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
    quotationNetAmount: number;      // With VAT
    quotationWithoutVat: number;     // Without VAT
    vatAmount: number;               // VAT amount
    estimationAmount: number;
    commission: number;
    labourCosts: number;
    materialCosts: number;
    miscellaneousCosts: number;
    totalExpenses: number;
    profitLossWithoutVat: number;    // Profit calculation WITHOUT VAT
    profitLossWithVat: number;       // Profit calculation WITH VAT
    workStartDate: string;
    workEndDate: string;
    attentionPerson: string;
}

// Get Monthly Report with Project Profit (Only projects with LPO)
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

        // Get projects that have LPOs
        const projectsWithLPO = await LPO.aggregate([
            {
                $match: {
                    lpoDate: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: "$project"
                }
            }
        ]);

        const projectIdsWithLPO = projectsWithLPO.map(p => p._id);

        // 1. PROFIT DATA (Budget - Material Expenses) - Only for projects with LPO
        const budgets = await Budget.find({
            "monthlyBudgets": {
                $elemMatch: {
                    month: selectedMonth,
                    year: selectedYear
                }
            },
            "project": { $in: projectIdsWithLPO } // Only projects with LPO
        }).populate("project", "projectName projectNumber");

        let totalRevenueNet = 0;      // With VAT
        let totalRevenueWithoutVat = 0; // Without VAT
        let totalVatAmount = 0;       // VAT amount
        let totalExpenses = 0;
        const projectProfitData = [];

        for (const budget of budgets) {
            const project = budget.project as any;
            const monthlyBudgetAllocation = budget.monthlyBudgets.find(
                mb => mb.month === selectedMonth && mb.year === selectedYear
            );

            if (!monthlyBudgetAllocation) continue;

            // Get quotation for this project to get VAT details
            const quotation: any = await Quotation.findOne({ project: budget.project });

            let projectNetAmount = monthlyBudgetAllocation.allocatedAmount;
            let projectWithoutVat = monthlyBudgetAllocation.allocatedAmount;
            let projectVatAmount = 0;

            if (quotation) {
                // Assuming quotation has vatAmount field or we can calculate it
                // If netAmount includes VAT and there's a vatRate field
                if (quotation.netAmount && quotation.vatRate) {
                    const vatRate = quotation.vatRate / 100;
                    projectWithoutVat = quotation.netAmount / (1 + vatRate);
                    projectVatAmount = quotation.netAmount - projectWithoutVat;
                } else if (quotation.netAmount && quotation.withoutVatAmount) {
                    // If quotation already has separate fields
                    projectWithoutVat = quotation.withoutVatAmount;
                    projectVatAmount = quotation.netAmount - quotation.withoutVatAmount;
                }
                projectNetAmount = quotation.netAmount || monthlyBudgetAllocation.allocatedAmount;
            }

            totalRevenueNet += projectNetAmount;
            totalRevenueWithoutVat += projectWithoutVat;
            totalVatAmount += projectVatAmount;

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

            // Calculate profit both ways
            const profitWithVat = projectNetAmount - monthlyMaterialExpense;
            const profitWithoutVat = projectWithoutVat - monthlyMaterialExpense;

            projectProfitData.push({
                projectName: project.projectName,
                projectNumber: project.projectNumber,
                monthlyBudgetNet: projectNetAmount,           // With VAT
                monthlyBudgetWithoutVat: projectWithoutVat,   // Without VAT
                vatAmount: projectVatAmount,                  // VAT amount
                monthlyMaterialExpense,
                profitWithVat,
                profitWithoutVat
            });
        }

        const profitNet = totalRevenueNet - totalExpenses;           // Profit with VAT
        const profitWithoutVat = totalRevenueWithoutVat - totalExpenses; // Profit without VAT
        const profitMarginNet = totalRevenueNet > 0 ? (profitNet / totalRevenueNet) * 100 : 0;
        const profitMarginWithoutVat = totalRevenueWithoutVat > 0 ? (profitWithoutVat / totalRevenueWithoutVat) * 100 : 0;

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

        // 3. PROJECT DATA - Only projects with LPO
        const totalProjects = await Project.countDocuments({
            _id: { $in: projectIdsWithLPO }, // Only projects with LPO
            createdAt: { $gte: startDate, $lte: endDate }
        });

        const activeProjects = await Project.countDocuments({
            _id: { $in: projectIdsWithLPO }, // Only projects with LPO
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'project_closed'] }
        });

        // 4. INVOICE DATA - Only for projects with LPO
        const invoices = await Quotation.find({
            createdAt: { $gte: startDate, $lte: endDate },
            project: { $in: projectIdsWithLPO } // Only for projects with LPO
        });

        const totalInvoiceNetAmount = invoices.reduce((sum: number, inv: any) => sum + (inv.netAmount || 0), 0);
        const totalInvoiceWithoutVat = invoices.reduce((sum: number, inv: any) => {
            if (inv.withoutVatAmount) {
                return sum + inv.withoutVatAmount;
            }
            // Calculate without VAT if not stored
            if (inv.vatRate && inv.netAmount) {
                const vatRate = inv.vatRate / 100;
                return sum + (inv.netAmount / (1 + vatRate));
            }
            return sum + (inv.netAmount || 0);
        }, 0);
        const totalInvoiceVatAmount = invoices.reduce((sum, inv) => {
            if (inv.vatAmount) {
                return sum + inv.vatAmount;
            }
            return sum + (totalInvoiceNetAmount - totalInvoiceWithoutVat);
        }, 0);

        const pendingInvoices = invoices.filter(inv => !inv.isApproved);
        const pendingInvoiceNetAmount = pendingInvoices.reduce((sum, inv) => sum + (inv.netAmount || 0), 0);

        const monthlyReport = {
            period: {
                month: selectedMonth,
                year: selectedYear,
                monthName: dayjs(`${selectedYear}-${selectedMonth}-01`).format('MMMM YYYY')
            },
            revenue: {
                netAmount: totalRevenueNet,           // With VAT
                withoutVat: totalRevenueWithoutVat,   // Without VAT (for calculations)
                vatAmount: totalVatAmount,            // VAT amount
                expenses: totalExpenses,
                profitNet,                           // Profit with VAT
                profitWithoutVat,                    // Profit without VAT (for internal use)
                profitMarginNet: profitMarginNet.toFixed(2),
                profitMarginWithoutVat: profitMarginWithoutVat.toFixed(2),
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
                netAmount: totalInvoiceNetAmount,     // With VAT
                withoutVat: totalInvoiceWithoutVat,   // Without VAT
                vatAmount: totalInvoiceVatAmount,     // VAT amount
                pending: pendingInvoices.length,
                pendingNetAmount: pendingInvoiceNetAmount
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

// Get Enhanced Yearly Report (Only projects with LPO)
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

        // Get all projects that have LPOs in the selected year
        const projectsWithLPO = await LPO.aggregate([
            {
                $match: {
                    lpoDate: { $gte: yearStart, $lte: yearEnd }
                }
            },
            {
                $group: {
                    _id: "$project"
                }
            }
        ]);

        const projectIdsWithLPO = projectsWithLPO.map(p => p._id);

        // Find all projects with LPOs that have activity in the selected year
        const projectsWithActivity = await Project.find({
            _id: { $in: projectIdsWithLPO }, // Only projects with LPOs
            $or: [
                { workStartDate: { $gte: yearStart, $lte: yearEnd } },
                { createdAt: { $gte: yearStart, $lte: yearEnd } }
            ]
        }).populate('client', 'clientName');

        const projectYearlyData: ProjectYearlyData[] = [];

        for (const project of projectsWithActivity) {
            // Get Quotation
            const quotation: any = await Quotation.findOne({ project: project._id });

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

            // Quotation amounts with VAT separation
            const quotationNetAmount = quotation?.netAmount || 0;
            let quotationWithoutVat = quotation?.netAmount || 0;
            let vatAmount = 0;

            if (quotation) {
                if (quotation.withoutVatAmount) {
                    quotationWithoutVat = quotation.withoutVatAmount;
                    vatAmount = quotationNetAmount - quotationWithoutVat;
                } else if (quotation.vatRate && quotationNetAmount) {
                    const vatRate = quotation.vatRate / 100;
                    quotationWithoutVat = quotationNetAmount / (1 + vatRate);
                    vatAmount = quotationNetAmount - quotationWithoutVat;
                }
            }

            const estimationAmount = estimation?.estimatedAmount || 0;
            const commission = estimation?.commissionAmount || 0;

            // Calculate profit both ways
            const profitLossWithoutVat = quotationWithoutVat - totalExpenses - commission;  // Without VAT
            const profitLossWithVat = quotationNetAmount - totalExpenses - commission;      // With VAT

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
                quotationNetAmount,
                quotationWithoutVat,
                vatAmount,
                estimationAmount,
                commission,
                labourCosts,
                materialCosts,
                miscellaneousCosts,
                totalExpenses,
                profitLossWithoutVat,    // For internal calculations
                profitLossWithVat,       // For financial reporting
                workStartDate: project.workStartDate
                    ? dayjs(project.workStartDate).format('DD/MM/YYYY')
                    : 'N/A',
                workEndDate: project.workEndDate
                    ? dayjs(project.workEndDate).format('DD/MM/YYYY')
                    : 'N/A',
                attentionPerson: project.attention || 'N/A'
            });
        }

        // Calculate totals
        const totalQuotationNetAmount = projectYearlyData.reduce((sum, p) => sum + p.quotationNetAmount, 0);
        const totalQuotationWithoutVat = projectYearlyData.reduce((sum, p) => sum + p.quotationWithoutVat, 0);
        const totalVatAmount = projectYearlyData.reduce((sum, p) => sum + p.vatAmount, 0);
        const totalEstimationAmount = projectYearlyData.reduce((sum, p) => sum + p.estimationAmount, 0);
        const totalCommission = projectYearlyData.reduce((sum, p) => sum + p.commission, 0);
        const totalLabourCosts = projectYearlyData.reduce((sum, p) => sum + p.labourCosts, 0);
        const totalMaterialCosts = projectYearlyData.reduce((sum, p) => sum + p.materialCosts, 0);
        const totalMiscellaneousCosts = projectYearlyData.reduce((sum, p) => sum + p.miscellaneousCosts, 0);
        const totalExpensesSum = projectYearlyData.reduce((sum, p) => sum + p.totalExpenses, 0);
        const totalProfitLossWithoutVat = projectYearlyData.reduce((sum, p) => sum + p.profitLossWithoutVat, 0);
        const totalProfitLossWithVat = projectYearlyData.reduce((sum, p) => sum + p.profitLossWithVat, 0);

        const yearlyReport = {
            year: selectedYear,
            isCurrentYear,
            reportType: isCurrentYear ? 'Year to Date' : 'Full Year',
            summary: {
                totalProjects: projectYearlyData.length,
                totalQuotationNetAmount,      // With VAT
                totalQuotationWithoutVat,     // Without VAT
                totalVatAmount,               // VAT amount
                totalEstimationAmount,
                totalCommission,
                totalLabourCosts,
                totalMaterialCosts,
                totalMiscellaneousCosts,
                totalExpenses: totalExpensesSum,
                totalProfitLossWithoutVat,    // Profit without VAT (for internal use)
                totalProfitLossWithVat,       // Profit with VAT (for reporting)
                profitMarginWithoutVat: totalQuotationWithoutVat > 0
                    ? ((totalProfitLossWithoutVat / totalQuotationWithoutVat) * 100).toFixed(2) + '%'
                    : '0%',
                profitMarginWithVat: totalQuotationNetAmount > 0
                    ? ((totalProfitLossWithVat / totalQuotationNetAmount) * 100).toFixed(2) + '%'
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

// Generate Enhanced Monthly Report Excel with VAT separation
const generateMonthlyReportExcel = async (data: any, res: Response) => {
    const workbook = new ExcelJS.Workbook();

    // ============ SHEET 1: SUMMARY ============
    const summarySheet = workbook.addWorksheet('Summary');

    // Title
    summarySheet.mergeCells('A1:E1');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = `Monthly Report - ${data.period.monthName} (Projects with LPO Only)`;
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
    summarySheet.mergeCells('A3:E3');
    const financialHeader = summarySheet.getCell('A3');
    financialHeader.value = 'Financial Summary (With VAT Separation)';
    financialHeader.font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    financialHeader.alignment = { horizontal: 'left', vertical: 'middle' };
    financialHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    summarySheet.getRow(3).height = 25;

    // Table headers
    const headerRow = summarySheet.addRow(['Category', 'Metric', 'With VAT', 'Without VAT', 'VAT Amount']);
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

    // Financial data rows with VAT separation
    const financialData = [
        ['Revenue', 'Amount', data.revenue.netAmount, data.revenue.withoutVat, data.revenue.vatAmount],
        ['Profit', 'Amount', data.revenue.profitNet, data.revenue.profitWithoutVat, '-'],
        ['Profit', 'Margin', data.revenue.profitMarginNet + '%', data.revenue.profitMarginWithoutVat + '%', '-'],
        ['Invoices', 'Total Amount', data.invoices.netAmount, data.invoices.withoutVat, data.invoices.vatAmount],
        ['', 'Pending Amount', data.invoices.pendingNetAmount, '-', '-']
    ];

    financialData.forEach((rowData, index) => {
        const row = summarySheet.addRow(rowData);
        row.height = 20;
        row.alignment = { vertical: 'middle' };

        row.eachCell((cell, colNum) => {
            if ([3, 4, 5].includes(colNum) && typeof cell.value === 'number') {
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

            // Color coding for profit rows
            if (rowData[1] === 'Amount' && rowData[0] === 'Profit') {
                if (colNum === 3) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: data.revenue.profitNet >= 0 ? 'FFE2EFDA' : 'FFFCE4D6' }
                    };
                    cell.font = { bold: true, color: { argb: data.revenue.profitNet >= 0 ? 'FF375623' : 'FFC55A11' } };
                } else if (colNum === 4) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: data.revenue.profitWithoutVat >= 0 ? 'FFE2EFDA' : 'FFFCE4D6' }
                    };
                    cell.font = { bold: true, color: { argb: data.revenue.profitWithoutVat >= 0 ? 'FF375623' : 'FFC55A11' } };
                }
            }
        });
    });

    summarySheet.columns = [
        { width: 18 },
        { width: 20 },
        { width: 18 },
        { width: 18 },
        { width: 15 }
    ];

    // ============ SHEET 2: PROJECT BREAKDOWN WITH VAT ============
    const projectSheet = workbook.addWorksheet('Project Breakdown');

    // Title
    projectSheet.mergeCells('A1:G1');
    const projectTitle = projectSheet.getCell('A1');
    projectTitle.value = `Project Profit Breakdown - ${data.period.monthName} (With VAT Separation)`;
    projectTitle.font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
    projectTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    projectTitle.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
    };
    projectSheet.getRow(1).height = 35;

    projectSheet.addRow([]);

    // Headers with VAT separation
    const projectHeaderRow = projectSheet.addRow([
        'Project Name',
        'Project Number',
        'Budget (Net)',
        'Budget (Without VAT)',
        'VAT Amount',
        'Material Expense',
        'Profit (Without VAT)'
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
    let totalBudgetNet = 0;
    let totalBudgetWithoutVat = 0;
    let totalVatAmount = 0;
    let totalExpense = 0;
    let totalProfitWithoutVat = 0;

    data.revenue.projectBreakdown.forEach((project: any, index: number) => {
        const row = projectSheet.addRow([
            project.projectName,
            project.projectNumber,
            project.monthlyBudgetNet,
            project.monthlyBudgetWithoutVat,
            project.vatAmount,
            project.monthlyMaterialExpense,
            project.profitWithoutVat  // Using without VAT for calculations
        ]);

        totalBudgetNet += project.monthlyBudgetNet;
        totalBudgetWithoutVat += project.monthlyBudgetWithoutVat;
        totalVatAmount += project.vatAmount;
        totalExpense += project.monthlyMaterialExpense;
        totalProfitWithoutVat += project.profitWithoutVat;

        row.height = 20;
        row.alignment = { vertical: 'middle' };

        row.eachCell((cell, colNum) => {
            if ([3, 4, 5, 6, 7].includes(colNum)) {
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

        // Color profit cell (using without VAT for calculations)
        const profitCell = row.getCell(7);
        if (project.profitWithoutVat > 0) {
            profitCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE2EFDA' }
            };
            profitCell.font = { bold: true, color: { argb: 'FF375623' } };
        } else if (project.profitWithoutVat < 0) {
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
        totalBudgetNet,
        totalBudgetWithoutVat,
        totalVatAmount,
        totalExpense,
        totalProfitWithoutVat
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
        if ([3, 4, 5, 6, 7].includes(colNum)) {
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
        { width: 30 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 15 },
        { width: 18 },
        { width: 18 }
    ];

    const fileName = `monthly-report-${data.period.month}-${data.period.year}-with-vat.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
};

// Generate Enhanced Yearly Report Excel with VAT separation
const generateYearlyReportExcel = async (data: any, res: Response) => {
    const workbook = new ExcelJS.Workbook();

    // ============ SHEET 1: SUMMARY WITH VAT ============
    const summarySheet = workbook.addWorksheet('Summary');

    // Title
    summarySheet.mergeCells('A1:E1');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = `Yearly Report - ${data.year} (With VAT Separation)`;
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
    summarySheet.mergeCells('A3:E3');
    const financialHeader = summarySheet.getCell('A3');
    financialHeader.value = 'Financial Summary (With VAT Separation)';
    financialHeader.font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    financialHeader.alignment = { horizontal: 'left', vertical: 'middle' };
    financialHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    summarySheet.getRow(3).height = 25;

    // Table headers with VAT columns
    const headerRow = summarySheet.addRow(['Category', 'Metric', 'With VAT', 'Without VAT', 'VAT Amount']);
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

    // Financial data rows with VAT separation
    const financialData = [
        ['Revenue', 'Quotation Amount', data.summary.totalQuotationNetAmount, data.summary.totalQuotationWithoutVat, data.summary.totalVatAmount],
        ['Revenue', 'Estimation Amount', data.summary.totalEstimationAmount, data.summary.totalEstimationAmount, '-'],
        ['Costs', 'Total Expenses', '-', data.summary.totalExpenses, '-'],
        ['Costs', 'Total Commission', '-', data.summary.totalCommission, '-'],
        ['Profit/Loss', 'With VAT', data.summary.totalProfitLossWithVat, '-', '-'],
        ['Profit/Loss', 'Without VAT', '-', data.summary.totalProfitLossWithoutVat, '-'],
        ['Profit/Loss', 'Margin With VAT', data.summary.profitMarginWithVat, '-', '-'],
        ['Profit/Loss', 'Margin Without VAT', '-', data.summary.profitMarginWithoutVat, '-']
    ];

    financialData.forEach((rowData, index) => {
        const row = summarySheet.addRow(rowData);
        row.height = 20;
        row.alignment = { vertical: 'middle' };

        row.eachCell((cell, colNum) => {
            if ([3, 4, 5].includes(colNum) && typeof cell.value === 'number') {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else if (cell.value === '-') {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else {
                cell.alignment = { horizontal: colNum === 1 ? 'left' : 'center', vertical: 'middle' };
            }

            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
            };

            // Color coding for profit/loss rows
            if (rowData[0] === 'Profit/Loss' && rowData[1] === 'With VAT' && colNum === 3) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: data.summary.totalProfitLossWithVat >= 0 ? 'FFE2EFDA' : 'FFFCE4D6' }
                };
                cell.font = { bold: true, color: { argb: data.summary.totalProfitLossWithVat >= 0 ? 'FF375623' : 'FFC55A11' } };
            } else if (rowData[0] === 'Profit/Loss' && rowData[1] === 'Without VAT' && colNum === 4) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: data.summary.totalProfitLossWithoutVat >= 0 ? 'FFE2EFDA' : 'FFFCE4D6' }
                };
                cell.font = { bold: true, color: { argb: data.summary.totalProfitLossWithoutVat >= 0 ? 'FF375623' : 'FFC55A11' } };
            }
        });
    });

    summarySheet.columns = [
        { width: 18 },
        { width: 20 },
        { width: 18 },
        { width: 18 },
        { width: 15 }
    ];

    // ============ SHEET 2: PROJECT DETAILS WITH VAT ============
    const detailsSheet = workbook.addWorksheet('Project Details');

    // Title
    detailsSheet.mergeCells('A1:X1');
    const detailsTitle = detailsSheet.getCell('A1');
    detailsTitle.value = `Project Details - ${data.year} (With VAT Separation)`;
    detailsTitle.font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
    detailsTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    detailsTitle.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
    };
    detailsSheet.getRow(1).height = 35;

    detailsSheet.addRow([]);

    // Headers with VAT separation (Status field removed)
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
        'Quotation Net Amount',      // With VAT
        'Quotation Without VAT',     // Without VAT
        'VAT Amount',
        'Estimation Amount',
        'Commission',
        'Labour Costs',
        'Material Costs',
        'Miscellaneous Costs',
        'Total Expenses',
        'Profit/Loss With VAT',      // Profit with VAT
        'Profit/Loss Without VAT',   // Profit without VAT (for calculations)
        'Work Start Date',
        'Work End Date',
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

    // Add data rows with alternating colors (Status field removed)
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
            project.quotationNetAmount,
            project.quotationWithoutVat,
            project.vatAmount,
            project.estimationAmount,
            project.commission,
            project.labourCosts,
            project.materialCosts,
            project.miscellaneousCosts,
            project.totalExpenses,
            project.profitLossWithVat,
            project.profitLossWithoutVat,  // For calculations
            project.workStartDate,
            project.workEndDate,
            project.attentionPerson
        ]);

        row.height = 22;
        row.alignment = { vertical: 'middle', wrapText: true };

        // Alternating row colors
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
            if ([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].includes(colNum)) {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            }
        });

        // Color code profit/loss cells
        const profitWithVatCell = row.getCell(21);
        if (project.profitLossWithVat > 0) {
            profitWithVatCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE2EFDA' }
            };
            profitWithVatCell.font = { bold: true, color: { argb: 'FF375623' } };
        } else if (project.profitLossWithVat < 0) {
            profitWithVatCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFCE4D6' }
            };
            profitWithVatCell.font = { bold: true, color: { argb: 'FFC55A11' } };
        }

        const profitWithoutVatCell = row.getCell(22);
        if (project.profitLossWithoutVat > 0) {
            profitWithoutVatCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE2EFDA' }
            };
            profitWithoutVatCell.font = { bold: true, color: { argb: 'FF375623' } };
        } else if (project.profitLossWithoutVat < 0) {
            profitWithoutVatCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFCE4D6' }
            };
            profitWithoutVatCell.font = { bold: true, color: { argb: 'FFC55A11' } };
        }
    });

    // Add totals row (Status field removed)
    detailsSheet.addRow([]);
    const totalsRow = detailsSheet.addRow([
        '', '', '', '', '', '', '', '', '', '',
        'TOTALS',
        data.summary.totalQuotationNetAmount,
        data.summary.totalQuotationWithoutVat,
        data.summary.totalVatAmount,
        data.summary.totalEstimationAmount,
        data.summary.totalCommission,
        data.summary.totalLabourCosts,
        data.summary.totalMaterialCosts,
        data.summary.totalMiscellaneousCosts,
        data.summary.totalExpenses,
        data.summary.totalProfitLossWithVat,
        data.summary.totalProfitLossWithoutVat,  // For calculations
        '', '', ''
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
        if ([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].includes(colNum)) {
            cell.numFmt = '#,##0.00';
        }
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    });

    // Color profit totals
    const profitWithVatTotalCell = totalsRow.getCell(21);
    if (data.summary.totalProfitLossWithVat >= 0) {
        profitWithVatTotalCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFC6E0B4' }
        };
        profitWithVatTotalCell.font = { bold: true, color: { argb: 'FF375623' } };
    } else {
        profitWithVatTotalCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8CBAD' }
        };
        profitWithVatTotalCell.font = { bold: true, color: { argb: 'FFC55A11' } };
    }

    const profitWithoutVatTotalCell = totalsRow.getCell(22);
    if (data.summary.totalProfitLossWithoutVat >= 0) {
        profitWithoutVatTotalCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFC6E0B4' }
        };
        profitWithoutVatTotalCell.font = { bold: true, color: { argb: 'FF375623' } };
    } else {
        profitWithoutVatTotalCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8CBAD' }
        };
        profitWithoutVatTotalCell.font = { bold: true, color: { argb: 'FFC55A11' } };
    }

    // Auto-fit columns
    detailsSheet.columns.forEach((column: any, index: number) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell: any) => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
                maxLength = columnLength;
            }
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 30);
    });

    // Freeze header rows
    detailsSheet.views = [
        { state: 'frozen', xSplit: 0, ySplit: 3 }
    ];

    const fileName = `yearly-report-${data.year}-with-vat.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
};