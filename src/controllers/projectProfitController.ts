import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Budget } from "../models/budgetModel";
import { Expense } from "../models/expenseModel";
import { Project } from "../models/projectModel";
import { LPO } from "../models/lpoModel";
import { Client } from "../models/clientModel";
import ExcelJS from "exceljs";

export interface ProjectProfitData {
  projectName: string;
  clientName: string;
  lpoNumber: string;
  workStartDate: string | null;
  workEndDate: string | null;
  monthlyBudget: number;
  monthlyMaterialExpense: number;
  profit: number;
  attention: string;
  grnStatus: string;
  grnNumber?: string;
  projectId: string;
  budgetPercentage: number; // NEW FIELD
  totalQuotationAmount: number; // NEW FIELD
}

export const getProjectProfitReport = asyncHandler(async (req: Request, res: Response) => {
  const { month, year, export: exportType, search, page = 1, limit = 10 } = req.query;

  if (!month || !year) {
    throw new ApiError(400, "Month and year are required");
  }

  const selectedMonth = parseInt(month as string);
  const selectedYear = parseInt(year as string);
  const pageNumber = parseInt(page as string);
  const limitNumber = parseInt(limit as string);

  if (selectedMonth < 1 || selectedMonth > 12) {
    throw new ApiError(400, "Invalid month. Must be between 1 and 12.");
  }

  if (selectedYear < 2000 || selectedYear > 2100) {
    throw new ApiError(400, "Invalid year. Must be between 2000 and 2100.");
  }

  // Build query for budgets
  const budgetQuery: any = {
    "monthlyBudgets": {
      $elemMatch: {
        month: selectedMonth,
        year: selectedYear
      }
    }
  };

  // Find all budgets that have allocations for the selected month
  const budgets = await Budget.find(budgetQuery)
    .populate("project", "projectName projectNumber workStartDate workEndDate attention grnNumber")
    .populate("quotation", "netAmount")
    .populate({
      path: "project",
      populate: {
        path: "client",
        select: "clientName"
      }
    });

  if (!budgets.length) {
    return res.status(200).json(
      new ApiResponse(200, {
        data: [],
        total: 0,
        page: pageNumber,
        limit: limitNumber,
        totalPages: 0,
        summary: {
          totalBudget: 0,
          totalExpense: 0,
          totalProfit: 0,
          totalProjects: 0
        }
      }, "No projects found with budget allocation for the selected month")
    );
  }

  const projectProfitData: any[] = [];

  for (const budget of budgets) {
    const project = budget.project as any;
    const quotation = budget.quotation as any;

    // Get monthly budget allocation
    const monthlyBudgetAllocation = budget.monthlyBudgets.find(
      mb => mb.month === selectedMonth && mb.year === selectedYear
    );

    if (!monthlyBudgetAllocation) continue;

    // Get client name
    const clientName = project.client?.clientName || "N/A";

    // Get LPO number
    const lpo = await LPO.findOne({ project: project._id });
    const lpoNumber = lpo?.lpoNumber || "N/A";

    // Calculate monthly material expenses
    const startDate = new Date(selectedYear, selectedMonth - 1, 1);
    const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);

    const expenses = await Expense.find({
      project: project._id,
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

    const profit = monthlyBudgetAllocation.allocatedAmount - monthlyMaterialExpense;

    // Determine GRN status
    const grnStatus = project.grnNumber ? "Received" : "Not Received";
    const grnNumber = project.grnNumber || undefined;

    // Calculate budget percentage (monthly budget vs total quotation amount)
    const budgetPercentage = quotation?.netAmount
      ? (monthlyBudgetAllocation.allocatedAmount / quotation.netAmount) * 100
      : 0;

    projectProfitData.push({
      projectName: project.projectName,
      clientName,
      lpoNumber,
      workStartDate: project.workStartDate || null,
      workEndDate: project.workEndDate || null,
      monthlyBudget: monthlyBudgetAllocation.allocatedAmount,
      monthlyMaterialExpense,
      profit,
      attention: project.attention || "N/A",
      grnStatus,
      grnNumber,
      projectId: project._id,
      budgetPercentage: parseFloat(budgetPercentage.toFixed(2)),
      totalQuotationAmount: quotation?.netAmount || 0
    });
  }

  // Apply search filter if search term is provided
  let filteredData = projectProfitData;
  if (search && typeof search === 'string' && search.trim() !== '') {
    const searchTerm = search.toLowerCase().trim();
    filteredData = projectProfitData.filter(item =>
      item.projectName.toLowerCase().includes(searchTerm) ||
      item.clientName.toLowerCase().includes(searchTerm) ||
      item.lpoNumber.toLowerCase().includes(searchTerm) ||
      item.attention.toLowerCase().includes(searchTerm)
    );
  }

  // Calculate SUMMARY based on FILTERED data (after search, before pagination)
  // This ensures summary reflects what the user is actually viewing
  const summary = {
    totalBudget: filteredData.reduce((sum, item) => sum + item.monthlyBudget, 0),
    totalExpense: filteredData.reduce((sum, item) => sum + item.monthlyMaterialExpense, 0),
    totalProfit: filteredData.reduce((sum, item) => sum + item.profit, 0),
    totalProjects: filteredData.length
  };

  // Apply pagination
  const total = filteredData.length;
  const totalPages = Math.ceil(total / limitNumber);
  const startIndex = (pageNumber - 1) * limitNumber;
  const endIndex = Math.min(startIndex + limitNumber, total);
  const paginatedData = filteredData.slice(startIndex, endIndex);

  // If export is requested, generate Excel file (without pagination)
  if (exportType === 'excel') {
    return generateExcelReport(filteredData, selectedMonth, selectedYear, summary, res);
  }

  return res.status(200).json(
    new ApiResponse(200, {
      data: paginatedData,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages,
      summary: {
        // Summary is based on ALL filtered results, not just the current page
        totalBudget: summary.totalBudget,
        totalExpense: summary.totalExpense,
        totalProfit: summary.totalProfit,
        totalProjects: summary.totalProjects
      }
    }, "Project profit report fetched successfully")
  );
});

const generateExcelReport = async (
  data: any[],
  month: number,
  year: number,
  summary: { totalBudget: number; totalExpense: number; totalProfit: number; totalProjects: number },
  res: Response
) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Project Profit Report');

    // Add title
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
    worksheet.mergeCells('A1:M1');
    worksheet.getCell('A1').value = `Project Profit Report - ${monthName} ${year}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Add summary row at the top
    worksheet.mergeCells('A2:M2');
    worksheet.getCell('A2').value = `Total Projects: ${summary.totalProjects} | Total Budget: AED ${summary.totalBudget.toFixed(2)} | Total Expense: AED ${summary.totalExpense.toFixed(2)} | Total Profit: AED ${summary.totalProfit.toFixed(2)}`;
    worksheet.getCell('A2').font = { bold: true };
    worksheet.getCell('A2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE4B5' }
    };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    // Add headers (added Budget Percentage column)
    const headers = [
      'Project Name',
      'Client Name',
      'LPO Number',
      'Work Start Date',
      'Work End Date',
      'Monthly Budget (AED)',
      'Material Expense (AED)',
      'Profit (AED)',
      'Budget %',
      'Attention',
      'GRN Status',
      'GRN Number'
    ];

    // Add header row (starting from row 3)
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };
    headerRow.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };

    // Add data rows
    data.forEach(item => {
      const row = worksheet.addRow([
        item.projectName,
        item.clientName,
        item.lpoNumber,
        item.workStartDate ? new Date(item.workStartDate).toLocaleDateString() : 'N/A',
        item.workEndDate ? new Date(item.workEndDate).toLocaleDateString() : 'N/A',
        item.monthlyBudget,
        item.monthlyMaterialExpense,
        item.profit,
        `${item.budgetPercentage}%`,
        item.attention,
        item.grnStatus,
        item.grnNumber || 'N/A'
      ]);

      // Style the row
      row.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };

      // Color code profit cells
      const profitCell = row.getCell(8); // Profit column
      if (item.profit > 0) {
        profitCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF90EE90' }
        };
      } else if (item.profit < 0) {
        profitCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFB6C1' }
        };
      }

      // Color code budget percentage
      const budgetPercentageCell = row.getCell(9);
      if (item.budgetPercentage > 100) {
        // Budget exceeds quotation amount
        budgetPercentageCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFB6C1' }
        };
        budgetPercentageCell.font = { color: { argb: 'FFFF0000' } };
      } else if (item.budgetPercentage > 80) {
        // High percentage
        budgetPercentageCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFB5' }
        };
      }

      // Color code GRN status
      const grnStatusCell = row.getCell(11); // GRN Status column
      if (item.grnStatus === 'Received') {
        grnStatusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF90EE90' }
        };
      } else {
        grnStatusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFB6C1' }
        };
      }
    });

    // Auto-fit columns
    worksheet.columns.forEach((column: any) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell: any) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 50);
    });

    // Add grand total row at the bottom
    const lastRow = worksheet.rowCount + 1;
    worksheet.addRow([]); // Empty row
    const totalRow = worksheet.addRow([
      'GRAND TOTAL',
      '',
      '',
      '',
      '',
      summary.totalBudget,
      summary.totalExpense,
      summary.totalProfit,
      '',
      '',
      '',
      ''
    ]);

    totalRow.font = { bold: true };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFA07A' }
    };

    // Set response headers for file download
    const fileName = `project-profit-report-${monthName}-${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Excel generation error:', error);
    throw new ApiError(500, 'Failed to generate Excel report');
  }
};