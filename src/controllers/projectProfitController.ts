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
      $or: [
        { "materials.date": { $gte: startDate, $lte: endDate } },
        { "miscellaneous.date": { $gte: startDate, $lte: endDate } }
      ]
    });

    const monthlyMaterialExpense = expenses.reduce((total, expense) => {
      const materialCostForMonth = expense.materials
        .filter(material => {
          const materialDate = new Date(material.date);
          return materialDate >= startDate && materialDate <= endDate;
        })
        .reduce((sum, material) => sum + material.amount, 0);

      const miscCostForMonth = expense.miscellaneous
        .filter(misc => {
          const miscDate = new Date(misc.date);
          return miscDate >= startDate && miscDate <= endDate;
        })
        .reduce((sum, misc) => sum + misc.total, 0);

      return total + materialCostForMonth + miscCostForMonth;
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

    // Add title with blue background (matching payroll Excel)
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' }).toUpperCase();
    worksheet.mergeCells('A1:M1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `PROJECT PROFIT REPORT - ${monthName} ${year}`;
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2c5aa0' } // Same blue as payroll Excel
    };
    worksheet.getRow(1).height = 30;

    // Add summary row at the top
    worksheet.mergeCells('A2:M2');
    const summaryCell = worksheet.getCell('A2');
    summaryCell.value = `Total Projects: ${summary.totalProjects} | Total Budget: AED ${summary.totalBudget.toFixed(2)} | Total Expense: AED ${summary.totalExpense.toFixed(2)} | Total Profit: AED ${summary.totalProfit.toFixed(2)}`;
    summaryCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' } // Different shade of blue
    };
    summaryCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(2).height = 25;

    // Add empty row
    worksheet.addRow([]);

    // Add headers with blue background (added Budget Percentage column)
    const headers = [
      'S/NO',
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

    // Add header row (starting from row 4)
    const headerRow = worksheet.addRow(headers);
    headerRow.height = 25;
    headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2c5aa0' } // Same blue as title
    };

    // Apply border to header
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    });

    // Add data rows with S/NO
    data.forEach((item, index) => {
      const row = worksheet.addRow([
        index + 1,
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

      row.height = 22;
      row.alignment = { vertical: 'middle' };

      // Alternate row colors
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

        // Format numbers for currency columns
        if ([7, 8, 9].includes(colNum)) {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (colNum === 1) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colNum === 10) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });

      // Color code profit cells
      const profitCell = row.getCell(9); // Profit column
      if (item.profit > 0) {
        profitCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2EFDA' }
        };
        profitCell.font = { bold: true, color: { argb: 'FF375623' } };
      } else if (item.profit < 0) {
        profitCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFCE4D6' }
        };
        profitCell.font = { bold: true, color: { argb: 'FFC55A11' } };
      }

      // Color code budget percentage
      const budgetPercentageCell = row.getCell(10);
      if (item.budgetPercentage > 100) {
        // Budget exceeds quotation amount
        budgetPercentageCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFCE4D6' }
        };
        budgetPercentageCell.font = { bold: true, color: { argb: 'FFC55A11' } };
      } else if (item.budgetPercentage > 80) {
        // High percentage
        budgetPercentageCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF9E6' }
        };
        budgetPercentageCell.font = { bold: true, color: { argb: 'FF856404' } };
      }

      // Color code GRN status
      const grnStatusCell = row.getCell(12); // GRN Status column
      if (item.grnStatus === 'Received') {
        grnStatusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2EFDA' }
        };
        grnStatusCell.font = { bold: true, color: { argb: 'FF375623' } };
      } else {
        grnStatusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFCE4D6' }
        };
        grnStatusCell.font = { bold: true, color: { argb: 'FFC55A11' } };
      }
    });

    // Add totals row (yellow background like payroll Excel)
    worksheet.addRow([]);
    const totalsRow = worksheet.addRow([
      '',
      'TOTALS',
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

    totalsRow.height = 25;
    totalsRow.font = { bold: true, size: 11 };
    totalsRow.alignment = { horizontal: 'right', vertical: 'middle' };
    totalsRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFEB3B' } // Yellow like payroll Excel
    };

    totalsRow.eachCell((cell, colNum) => {
      if ([7, 8, 9].includes(colNum)) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (colNum === 2) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }

      cell.border = {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    });

    // Color profit total cell
    const profitTotalCell = totalsRow.getCell(9);
    if (summary.totalProfit >= 0) {
      profitTotalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFC6E0B4' }
      };
      profitTotalCell.font = { bold: true, color: { argb: 'FF375623' } };
    } else {
      profitTotalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8CBAD' }
      };
      profitTotalCell.font = { bold: true, color: { argb: 'FFC55A11' } };
    }

    // Set column widths
    worksheet.columns = [
      { width: 8 },    // S/NO
      { width: 30 },   // Project Name
      { width: 25 },   // Client Name
      { width: 15 },   // LPO Number
      { width: 15 },   // Work Start Date
      { width: 15 },   // Work End Date
      { width: 18 },   // Monthly Budget (AED)
      { width: 18 },   // Material Expense (AED)
      { width: 15 },   // Profit (AED)
      { width: 12 },   // Budget %
      { width: 20 },   // Attention
      { width: 15 },   // GRN Status
      { width: 15 }    // GRN Number
    ];

    // Add signature section (matching payroll Excel)
    const signatureStartRow = worksheet.lastRow!.number + 2;

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
    worksheet.addRow([]);

    // Add footer text (matching payroll Excel)
    const footerRow = worksheet.addRow({});
    worksheet.mergeCells(`A${footerRow.number}:M${footerRow.number}`);
    const footerCell = worksheet.getCell(`A${footerRow.number}`);
    footerCell.value = 'This report is generated using AGATS software';
    footerCell.font = { italic: true, size: 10, color: { argb: 'FF808080' } };
    footerCell.alignment = { vertical: 'middle', horizontal: 'center' };
    footerRow.height = 20;

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