import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import ExcelJS from "exceljs";
import { Project } from "../models/projectModel";
import { Client, IClient } from "../models/clientModel";
import { Quotation } from "../models/quotationModel";
import { LPO } from "../models/lpoModel";
import dayjs from "dayjs";

export interface InvoiceReportData {
    projectId: string;
    projectNumber: string; // NEW: Added project number
    projectName: string;
    projectDescription: string;
    clientName: string;
    grnNumber?: string;
    quotationAmount: number;
    grnUpdatedDate?: string;
    lpoNumber: string;
    lpoDate: string;
    today: string;
    remainingPaymentDays: number;
    remainingDaysForPayment: string;
    projectStatus: string;
    progress: number;
    workStartDate?: string;
    workEndDate?: string;
}

// Helper function to calculate remaining days for payment
function getDaysLeft(validUntil?: Date): string {
    if (!validUntil) return "N/A";

    const today = new Date();

    // Calculate difference in ms
    const diffTime = validUntil.getTime() - today.getTime();

    // Convert ms → days
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return "Expired";
    if (diffDays === 0) return "Today";

    return `${diffDays} days left`;
}

export const getInvoiceReport = asyncHandler(async (req: Request, res: Response) => {
    const {
        export: exportType,
        search,
        page = 1,
        limit = 10,
        client,
        dateFrom,
        dateTo
    } = req.query;

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);

    // Build base query - only projects that are 100% completed
    const projectQuery: any = {
        progress: 100
    };

    // Add search filters
    if (client && client !== 'all') {
        projectQuery.client = client;
    }

    if (dateFrom || dateTo) {
        projectQuery.workEndDate = {};
        if (dateFrom) {
            projectQuery.workEndDate.$gte = new Date(dateFrom as string);
        }
        if (dateTo) {
            projectQuery.workEndDate.$lte = new Date(dateTo as string);
        }
    }

    // Find all completed projects
    const projects = await Project.find(projectQuery)
        .populate<{ client: IClient }>("client", "clientName")
        .sort({ workEndDate: -1, createdAt: -1 });

    if (!projects.length) {
        return res.status(200).json(
            new ApiResponse(200, {
                data: [],
                total: 0,
                page: pageNumber,
                limit: limitNumber,
                totalPages: 0
            }, "No completed projects found")
        );
    }

    const invoiceReportData: InvoiceReportData[] = [];

    for (const project of projects) {
        const clientName = project.client?.clientName || "N/A";

        // Get quotation data
        const quotation = await Quotation.findOne({ project: project._id });
        const quotationAmount = quotation?.netAmount || 0;

        // Get LPO data
        const lpo = await LPO.findOne({ project: project._id });
        const lpoNumber = lpo?.lpoNumber || "N/A";
        const lpoDate = lpo?.lpoDate ? new Date(lpo.lpoDate).toISOString().split('T')[0] : "N/A";

        // Calculate today's date
        const today = new Date();

        // Calculate remaining days for payment using your getDaysLeft function
        let remainingDaysForPayment = "N/A";
        if (quotation?.validUntil) {
            // Use the same logic as your getDaysLeft function
            const diffTime = quotation.validUntil.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays < 0) {
                remainingDaysForPayment = "Expired";
            } else if (diffDays === 0) {
                remainingDaysForPayment = "Today";
            } else {
                remainingDaysForPayment = `${diffDays} days left`;
            }
        }

        // Calculate payment due date for internal use (30 days after completion)
        const workEndDate = project.workEndDate ? new Date(project.workEndDate) : today;
        const paymentDueDate = new Date(workEndDate);
        paymentDueDate.setDate(paymentDueDate.getDate() + 30);
        const remainingPaymentDays = Math.max(0,
            Math.ceil((paymentDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        );

        invoiceReportData.push({
            projectId: project._id.toString(),
            projectNumber: project.projectNumber || "N/A", // Added project number
            projectName: project.projectName,
            projectDescription: project.projectDescription || "No description",
            clientName,
            grnNumber: project.grnNumber,
            quotationAmount,
            grnUpdatedDate: project.grnNumber ? project.updatedAt?.toISOString().split('T')[0] : undefined,
            lpoNumber,
            lpoDate,
            today: today.toISOString().split('T')[0],
            remainingPaymentDays, // Numeric value for calculations
            remainingDaysForPayment, // String display value using your function
            projectStatus: project.status,
            progress: project.progress,
            workStartDate: project.workStartDate ? project.workStartDate.toISOString().split('T')[0] : undefined,
            workEndDate: project.workEndDate ? project.workEndDate.toISOString().split('T')[0] : undefined,
        });
    }

    // Apply search filter if search term is provided
    let filteredData = invoiceReportData;
    if (search && typeof search === 'string' && search.trim() !== '') {
        const searchTerm = search.toLowerCase().trim();
        filteredData = invoiceReportData.filter(item =>
            item.projectName.toLowerCase().includes(searchTerm) ||
            item.projectNumber.toLowerCase().includes(searchTerm) ||
            item.clientName.toLowerCase().includes(searchTerm) ||
            item.lpoNumber.toLowerCase().includes(searchTerm) ||
            item.grnNumber?.toLowerCase().includes(searchTerm) ||
            item.projectDescription.toLowerCase().includes(searchTerm)
        );
    }

    // Apply pagination
    const total = filteredData.length;
    const totalPages = Math.ceil(total / limitNumber);
    const startIndex = (pageNumber - 1) * limitNumber;
    const endIndex = Math.min(startIndex + limitNumber, total);
    const paginatedData = filteredData.slice(startIndex, endIndex);

    // If export is requested, generate Excel file (without pagination)
    if (exportType === 'excel') {
        return generateInvoiceExcelReport(filteredData, res);
    }

    return res.status(200).json(
        new ApiResponse(200, {
            data: paginatedData,
            total,
            page: pageNumber,
            limit: limitNumber,
            totalPages
        }, "Invoice report fetched successfully")
    );
});

const generateInvoiceExcelReport = async (
    data: InvoiceReportData[],
    res: Response
) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Invoice Report');

        // Add title
        worksheet.mergeCells('A1:K1');
        worksheet.getCell('A1').value = `Invoice Report - Completed Projects (100% Progress)`;
        worksheet.getCell('A1').font = { size: 16, bold: true };
        worksheet.getCell('A1').alignment = { horizontal: 'center' };

        // Add generation date
        worksheet.mergeCells('A2:K2');
        worksheet.getCell('A2').value = `Generated on: ${new Date().toLocaleDateString()} | Total Projects: ${data.length}`;
        worksheet.getCell('A2').font = { size: 10, italic: true };
        worksheet.getCell('A2').alignment = { horizontal: 'center' };

        // Updated headers - Removed "Payment Due Date", Added "Project Number"
        const headers = [
            'Project Number', // NEW: Added project number
            'Project Name',
            'Project Description',
            'Client Name',
            'GRN Number',
            'Quotation Amount (AED)',
            'GRN Updated Date',
            'LPO Number',
            'LPO Date',
            "Today's Date",
            'Remaining Days for Payment', // Removed "Payment Due Date"
            'Amount Received Date',  // Empty column for manual entry
            'Amount 1 (AED)',        // Empty column for manual entry
            'Amount 2 (AED)',        // Empty column for manual entry
            'Amount 3 (AED)'         // Empty column for manual entry
        ];

        // Add header row
        const headerRow = worksheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F81BD' }
        };
        headerRow.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        headerRow.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };

        // Add data rows
        data.forEach(item => {
            const row = worksheet.addRow([
                item.projectNumber, // Added project number
                item.projectName,
                item.projectDescription,
                item.clientName,
                item.grnNumber || 'N/A',
                item.quotationAmount,
                item.grnUpdatedDate || 'N/A',
                item.lpoNumber,
                item.lpoDate,
                item.today,
                item.remainingDaysForPayment, // Removed paymentDueDate
                '', // Amount Received Date - Empty for manual entry
                '', // Amount 1 - Empty for manual entry
                '', // Amount 2 - Empty for manual entry
                ''  // Amount 3 - Empty for manual entry
            ]);

            // Style the row
            row.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };

            // Color code remaining days for payment column
            const remainingDaysCell = row.getCell(11); // Remaining Days for Payment column (now column 11)
            const cellValue = item.remainingDaysForPayment.toLowerCase();

            if (cellValue.includes('expired')) {
                remainingDaysCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFF0000' }
                };
                remainingDaysCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            } else if (cellValue.includes('today')) {
                remainingDaysCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFF00' }
                };
            } else {
                // Extract number of days from string like "5 days left"
                const daysMatch = cellValue.match(/\d+/);
                if (daysMatch) {
                    const days = parseInt(daysMatch[0]);
                    if (days <= 7) {
                        remainingDaysCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFFFF00' }
                        };
                    }
                }
            }

            // Style the empty columns for manual entry (light gray background)
            for (let i = 12; i <= 15; i++) {
                const cell = row.getCell(i);
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF2F2F2' }
                };
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            }

            // Format currency cells
            const quotationCell = row.getCell(6); // Quotation Amount is now column 6
            quotationCell.numFmt = '#,##0.00';

            // Format amount cells
            for (let i = 13; i <= 15; i++) {
                const cell = row.getCell(i);
                cell.numFmt = '#,##0.00';
            }

            // Format date cells (updated column indices)
            [7, 9, 10, 12].forEach(colIndex => {
                const cell = row.getCell(colIndex);
                cell.numFmt = 'dd/mm/yyyy';
            });
        });

        // Set column widths (updated for new column order)
        const columnWidths: Record<number, number> = {
            1: 15,  // Project Number
            2: 25,  // Project Name
            3: 30,  // Project Description
            4: 20,  // Client Name
            5: 15,  // GRN Number
            6: 18,  // Quotation Amount
            7: 18,  // GRN Updated Date
            8: 15,  // LPO Number
            9: 15,  // LPO Date
            10: 15, // Today's Date
            11: 22, // Remaining Days for Payment
            12: 20, // Amount Received Date
            13: 15, // Amount 1
            14: 15, // Amount 2
            15: 15, // Amount 3
        };

        Object.entries(columnWidths).forEach(([colIndex, width]) => {
            worksheet.getColumn(parseInt(colIndex)).width = width;
        });

        // Add summary section
        worksheet.addRow([]); // Empty row

        const totalQuotation = data.reduce((sum, item) => sum + item.quotationAmount, 0);
        const expiredProjects = data.filter(item =>
            item.remainingDaysForPayment.toLowerCase().includes('expired')
        ).length;
        const dueTodayProjects = data.filter(item =>
            item.remainingDaysForPayment.toLowerCase().includes('today')
        ).length;

        // Calculate projects with days left <= 7
        const dueSoonProjects = data.filter(item => {
            if (item.remainingDaysForPayment.toLowerCase().includes('days left')) {
                const daysMatch = item.remainingDaysForPayment.match(/\d+/);
                if (daysMatch) {
                    const days = parseInt(daysMatch[0]);
                    return days <= 7;
                }
            }
            return false;
        }).length;

        const onTrackProjects = data.length - expiredProjects - dueTodayProjects - dueSoonProjects;

        // Summary row (updated column indices)
        const summaryRow = worksheet.addRow([
            'SUMMARY',
            '',
            '',
            '',
            '',
            totalQuotation,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            ''
        ]);

        summaryRow.font = { bold: true };
        summaryRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFE4B5' }
        };

        // Statistics row (updated column indices)
        const statsRow = worksheet.addRow([
            'STATISTICS',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            `Expired: ${expiredProjects}`,
            `Due Today: ${dueTodayProjects}`,
            `Due Soon (≤7 days): ${dueSoonProjects}`,
            `On Track: ${onTrackProjects}`
        ]);

        statsRow.font = { bold: true };
        statsRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE6F2FF' }
        };

        // Add note about empty columns
        worksheet.addRow([]);
        const noteRow = worksheet.addRow([
            'NOTE:',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            'Remaining Days calculated based on quotation valid until date',
            'Columns 12-15 are for',
            'manual entry of',
            'payment details',
            ''
        ]);

        noteRow.font = { italic: true, size: 10 };
        noteRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF0F0F0' }
        };

        // Set response headers for file download
        const fileName = `invoice-report-completed-projects-${new Date().toISOString().split('T')[0]}.xlsx`;

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

// Get clients for filter dropdown
export const getClientsForFilter = asyncHandler(async (req: Request, res: Response) => {
    const clients = await Client.find()
        .select('_id clientName')
        .sort({ clientName: 1 });

    return res.status(200).json(
        new ApiResponse(200, clients, "Clients fetched successfully")
    );
});