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
    projectNumber: string;
    projectName: string;
    projectDescription: string;
    clientName: string;
    grnNumber?: string;
    quotationAmount: number;
    vatAmount: number;
    netAmount: number;
    amountWithoutVAT: number;
    invoiceRemarks?: string; // Added invoice remarks
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
    invoiceDate?: string;
    paymentTermsDays: number;
    dueDate?: string;
}

// Function to extract payment days from terms and conditions
const extractPaymentDays = (termsAndConditions: string[]): number => {
    if (!termsAndConditions || termsAndConditions.length < 2) {
        return 30; // Default to 30 days if not found
    }

    const secondTerm = termsAndConditions[1];

    // Look for numbers in the string with patterns like:
    // "30 days", "60 days", "90 days", "30", "60", "90", "net 30", "net 60"
    const matches = secondTerm.match(/\b(\d+)\s*(?:days?)?\b/i);

    if (matches && matches[1]) {
        const days = parseInt(matches[1], 10);
        // Common payment terms: 30, 60, 90 days
        return [30, 60, 90, 120].includes(days) ? days : 30;
    }

    return 30; // Default to 30 days if no number found
};

// Function to calculate days left until payment is due from invoice date
const getDaysLeftFromInvoiceDate = (invoiceDate?: Date, paymentDays: number = 30): {
    daysLeft: number;
    message: string; // Either "Expired" or "X days left"
    dueDate?: Date;
} => {
    if (!invoiceDate) {
        return {
            daysLeft: 0,
            message: `Invoice date not set`,
            dueDate: undefined
        };
    }

    const invoice = new Date(invoiceDate);
    if (isNaN(invoice.getTime())) {
        return {
            daysLeft: 0,
            message: "Invalid invoice date",
            dueDate: undefined
        };
    }

    // Calculate due date by adding payment days to invoice date
    const dueDate = new Date(invoice);
    dueDate.setDate(dueDate.getDate() + paymentDays);

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    dueDate.setHours(0, 0, 0, 0); // Normalize to start of day

    // Calculate difference in ms
    const diffTime = dueDate.getTime() - today.getTime();

    // Convert ms → days
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let message = "";
    if (diffDays < 0) {
        message = "Expired";
    } else {
        message = `${diffDays} days left`;
    }

    return {
        daysLeft: diffDays,
        message: message,
        dueDate: dueDate
    };
};

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
        const netAmount = quotation?.netAmount || 0;
        const vatAmount = quotation?.vatAmount || 0;

        // Calculate amount without VAT for profit calculation
        const amountWithoutVAT = netAmount - vatAmount;

        // Get LPO data
        const lpo = await LPO.findOne({ project: project._id });
        const lpoNumber = lpo?.lpoNumber || "N/A";
        const lpoDate = lpo?.lpoDate ? new Date(lpo.lpoDate).toISOString().split('T')[0] : "N/A";

        // Calculate today's date
        const today = new Date();

        // Extract payment terms days from quotation
        const paymentTermsDays = quotation?.termsAndConditions ?
            extractPaymentDays(quotation.termsAndConditions) : 30;

        // Calculate payment due date based on invoice date + payment terms
        const daysLeftInfo = getDaysLeftFromInvoiceDate(
            project.invoiceDate,
            paymentTermsDays
        );

        invoiceReportData.push({
            projectId: project._id.toString(),
            projectNumber: project.projectNumber || "N/A",
            projectName: project.projectName,
            projectDescription: project.projectDescription || "No description",
            clientName,
            grnNumber: project.grnNumber,
            quotationAmount: amountWithoutVAT,
            vatAmount: vatAmount,
            netAmount: netAmount,
            amountWithoutVAT: amountWithoutVAT,
            invoiceRemarks: project.invoiceRemarks || "", // Added remarks
            grnUpdatedDate: project.grnNumber ? project.updatedAt?.toISOString().split('T')[0] : undefined,
            lpoNumber,
            lpoDate,
            today: today.toISOString().split('T')[0],
            remainingPaymentDays: daysLeftInfo.daysLeft,
            remainingDaysForPayment: daysLeftInfo.message,
            projectStatus: project.status,
            progress: project.progress,
            workStartDate: project.workStartDate ? project.workStartDate.toISOString().split('T')[0] : undefined,
            workEndDate: project.workEndDate ? project.workEndDate.toISOString().split('T')[0] : undefined,
            invoiceDate: project.invoiceDate ? project.invoiceDate.toISOString().split('T')[0] : undefined,
            paymentTermsDays: paymentTermsDays,
            dueDate: daysLeftInfo.dueDate ? daysLeftInfo.dueDate.toISOString().split('T')[0] : undefined,
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
        worksheet.mergeCells('A1:N1');
        worksheet.getCell('A1').value = `Invoice Report - Completed Projects (100% Progress)`;
        worksheet.getCell('A1').font = { size: 16, bold: true };
        worksheet.getCell('A1').alignment = { horizontal: 'center' };

        // Add generation date
        worksheet.mergeCells('A2:N2');
        worksheet.getCell('A2').value = `Generated on: ${new Date().toLocaleDateString()} | Total Projects: ${data.length}`;
        worksheet.getCell('A2').font = { size: 10, italic: true };
        worksheet.getCell('A2').alignment = { horizontal: 'center' };

        // Updated headers with Remarks column
        const headers = [
            'Project Number',
            'Project Name',
            'Project Description',
            'Client Name',
            'GRN Number',
            'Quotation Amount (AED)', // NET amount without VAT
            'VAT Amount (AED)',
            'NET Amount (AED)',
            'Invoice Remarks', // NEW: Added remarks column
            'Invoice Date',
            'Payment Terms (Days)',
            'Due Date',
            'GRN Updated Date',
            'LPO Number',
            'LPO Date',
            "Today's Date",
            'Payment Status',
            'Amount Received Date',
            'Amount 1 (AED)',
            'Amount 2 (AED)',
            'Amount 3 (AED)'
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
                item.projectNumber,
                item.projectName,
                item.projectDescription,
                item.clientName,
                item.grnNumber || 'N/A',
                item.amountWithoutVAT,
                item.vatAmount,
                item.netAmount,
                item.invoiceRemarks || 'No remarks', // Remarks column
                item.invoiceDate || 'Not set',
                item.paymentTermsDays,
                item.dueDate || 'N/A',
                item.grnUpdatedDate || 'N/A',
                item.lpoNumber,
                item.lpoDate,
                item.today,
                item.remainingDaysForPayment, // "Expired" or "X days left"
                '', // Amount Received Date
                '', // Amount 1
                '', // Amount 2
                ''  // Amount 3
            ]);

            // Style the row
            row.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };

            // Color code payment status column (column 17)
            const paymentStatusCell = row.getCell(17);
            const cellValue = item.remainingDaysForPayment.toLowerCase();

            if (cellValue.includes('expired')) {
                paymentStatusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFF0000' }
                };
                paymentStatusCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            } else if (cellValue.includes('days left')) {
                // Extract number of days
                const daysMatch = cellValue.match(/\d+/);
                if (daysMatch) {
                    const days = parseInt(daysMatch[0]);
                    if (days <= 7) {
                        paymentStatusCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFFFF00' }
                        };
                    } else if (days <= 30) {
                        paymentStatusCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FF90EE90' }
                        };
                    }
                }
            }

            // Color code due date if expired
            const dueDateCell = row.getCell(12);
            if (cellValue.includes('expired')) {
                dueDateCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFF0000' }
                };
                dueDateCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            }

            // Style remarks column (light yellow background)
            const remarksCell = row.getCell(9);
            if (item.invoiceRemarks && item.invoiceRemarks.trim().length > 0) {
                remarksCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFE0' } // Light yellow
                };
            }

            // Style the empty columns for manual entry
            for (let i = 18; i <= 21; i++) {
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
            [6, 7, 8, 19, 20, 21].forEach(colIndex => {
                const cell = row.getCell(colIndex);
                cell.numFmt = '#,##0.00';
            });

            // Format date cells
            [10, 12, 13, 14, 15, 16, 18].forEach(colIndex => {
                const cell = row.getCell(colIndex);
                cell.numFmt = 'dd/mm/yyyy';
            });

            // Auto wrap text for remarks column
            remarksCell.alignment = { wrapText: true };
        });

        // Set column widths
        const columnWidths: Record<number, number> = {
            1: 15,  // Project Number
            2: 25,  // Project Name
            3: 30,  // Project Description
            4: 20,  // Client Name
            5: 15,  // GRN Number
            6: 20,  // Quotation Amount (without VAT)
            7: 15,  // VAT Amount
            8: 15,  // NET Amount
            9: 30,  // Invoice Remarks
            10: 15, // Invoice Date
            11: 15, // Payment Terms (Days)
            12: 15, // Due Date
            13: 18, // GRN Updated Date
            14: 15, // LPO Number
            15: 15, // LPO Date
            16: 15, // Today's Date
            17: 18, // Payment Status
            18: 20, // Amount Received Date
            19: 15, // Amount 1
            20: 15, // Amount 2
            21: 15, // Amount 3
        };

        Object.entries(columnWidths).forEach(([colIndex, width]) => {
            worksheet.getColumn(parseInt(colIndex)).width = width;
        });

        // Add summary section
        worksheet.addRow([]); // Empty row

        const totalQuotationWithoutVAT = data.reduce((sum, item) => sum + item.amountWithoutVAT, 0);
        const totalVAT = data.reduce((sum, item) => sum + item.vatAmount, 0);
        const totalNET = data.reduce((sum, item) => sum + item.netAmount, 0);

        // Count projects with remarks
        const projectsWithRemarks = data.filter(item =>
            item.invoiceRemarks && item.invoiceRemarks.trim().length > 0
        ).length;

        // Count projects by payment status
        const expiredProjects = data.filter(item =>
            item.remainingDaysForPayment.toLowerCase().includes('expired')
        ).length;
        const activeProjects = data.length - expiredProjects;

        // Financial summary row
        const summaryRow1 = worksheet.addRow([
            'FINANCIAL SUMMARY',
            '',
            '',
            '',
            '',
            totalQuotationWithoutVAT,
            totalVAT,
            totalNET,
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
            '',
            '',
            ''
        ]);

        summaryRow1.font = { bold: true };
        summaryRow1.font = { color: { argb: 'FF000000' }, bold: true };
        summaryRow1.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFE4B5' }
        };

        // Payment status and remarks summary
        const summaryRow2 = worksheet.addRow([
            'PROJECT SUMMARY',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            `Projects with Remarks: ${projectsWithRemarks}`,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            `Expired: ${expiredProjects}`,
            `Active: ${activeProjects}`,
            '',
            '',
            ''
        ]);

        summaryRow2.font = { bold: true };
        summaryRow2.font = { color: { argb: 'FF000000' }, bold: true };
        summaryRow2.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE6F2FF' }
        };

        // Add notes
        worksheet.addRow([]);
        const noteRow1 = worksheet.addRow([
            'NOTES:',
            '',
            '',
            '',
            '',
            '1. Quotation Amount = NET - VAT (for profit calculation)',
            '2. Payment Terms extracted from quotation terms',
            '3. Due Date = Invoice Date + Payment Terms Days',
            '4. Remarks column shows invoice remarks if available',
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
            '',
            ''
        ]);

        noteRow1.font = { italic: true, size: 10, color: { argb: 'FF0000FF' } };
        noteRow1.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF0F0F0' }
        };

        // Set response headers for file download
        const fileName = `invoice-report-${new Date().toISOString().split('T')[0]}.xlsx`;

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