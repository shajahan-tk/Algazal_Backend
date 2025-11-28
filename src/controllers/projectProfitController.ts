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

interface ProjectProfitData {
  projectName: string;
  clientName: string;
  lpoNumber: string;
  workStartDate: Date | null;
  workEndDate: Date | null;
  monthlyBudget: number;
  monthlyMaterialExpense: number;
  profit: number;
  attention: string;
  grnStatus: string; // "Received" or "Not Received"
  grnNumber?: string;
  projectId: string;
}

export const getProjectProfitReport = asyncHandler(async (req: Request, res: Response) => {
  const { month, year, export: exportType, search } = req.query;

  if (!month || !year) {
    throw new ApiError(400, "Month and year are required");
  }

  const selectedMonth = parseInt(month as string);
  const selectedYear = parseInt(year as string);

  if (selectedMonth < 1 || selectedMonth > 12) {
    throw new ApiError(400, "Invalid month. Must be between 1 and 12.");
  }

  if (selectedYear < 2000 || selectedYear > 2100) {
    throw new ApiError(400, "Invalid year. Must be between 2000 and 2100.");
  }

  // Find all budgets that have allocations for the selected month
  const budgets = await Budget.find({
    "monthlyBudgets": {
      $elemMatch: {
        month: selectedMonth,
        year: selectedYear
      }
    }
  })
    .populate("project", "projectName projectNumber workStartDate workEndDate attention grnNumber")
    .populate("quotation", "netAmount");

  if (!budgets.length) {
    return res.status(200).json(
      new ApiResponse(200, [], "No projects found with budget allocation for the selected month")
    );
  }

  const projectProfitData: ProjectProfitData[] = [];

  for (const budget of budgets) {
    const project = budget.project as any;

    // Get monthly budget allocation
    const monthlyBudgetAllocation = budget.monthlyBudgets.find(
      mb => mb.month === selectedMonth && mb.year === selectedYear
    );

    if (!monthlyBudgetAllocation) continue;

    // Get client name
    const projectWithClient = await Project.findById(project._id).populate("client", "clientName");
    const clientName = (projectWithClient?.client as any)?.clientName || "N/A";

    // Get LPO number
    const lpo = await LPO.findOne({ project: project._id });
    const lpoNumber = lpo?.lpoNumber || "N/A";

    // Calculate monthly material expenses
    const startDate = new Date(selectedYear, selectedMonth - 1, 1);
    const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59); // End of month

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

  // If export is requested, generate Excel file
  if (exportType === 'excel') {
    return generateExcelReport(filteredData, selectedMonth, selectedYear, res);
  }

  return res.status(200).json(
    new ApiResponse(200, filteredData, "Project profit report fetched successfully")
  );
});

const generateExcelReport = async (
  data: ProjectProfitData[],
  month: number,
  year: number,
  res: Response
) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Project Profit Report');

    // Add title
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
    worksheet.mergeCells('A1:K1');
    worksheet.getCell('A1').value = `Project Profit Report - ${monthName} ${year}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Add headers
    const headers = [
      'Project Name',
      'Client Name',
      'LPO Number',
      'Work Start Date',
      'Work End Date',
      'Monthly Budget (AED)',
      'Material Expense (AED)',
      'Profit (AED)',
      'Attention',
      'GRN Status',
      'GRN Number'
    ];

    // Add header row
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' } // Light purple background
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
          fgColor: { argb: 'FF90EE90' } // Light green for profit
        };
      } else if (item.profit < 0) {
        profitCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFB6C1' } // Light red for loss
        };
      }

      // Color code GRN status
      const grnStatusCell = row.getCell(10); // GRN Status column
      if (item.grnStatus === 'Received') {
        grnStatusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF90EE90' } // Light green for received
        };
      } else {
        grnStatusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFB6C1' } // Light red for not received
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

    // Add summary row
    const totalBudget = data.reduce((sum, item) => sum + item.monthlyBudget, 0);
    const totalExpense = data.reduce((sum, item) => sum + item.monthlyMaterialExpense, 0);
    const totalProfit = data.reduce((sum, item) => sum + item.profit, 0);

    worksheet.addRow([]); // Empty row
    const summaryRow = worksheet.addRow([
      'TOTAL',
      '',
      '',
      '',
      '',
      totalBudget,
      totalExpense,
      totalProfit,
      '',
      '',
      ''
    ]);

    summaryRow.font = { bold: true };
    summaryRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE4B5' } // Light orange background
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