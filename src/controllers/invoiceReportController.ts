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
    netAmount: number;           // AMOUNT WITH VAT (Final amount)
    vatAmount: number;           // VAT Amount
    amountWithoutVAT: number;    // NET Amount - VAT Amount
    invoiceRemarks?: string;
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
    isExpired: boolean;
}

const extractPaymentDays = (termsAndConditions: string[]): number => {
    if (!termsAndConditions || termsAndConditions.length < 2) {
        return 30;
    }

    const secondTerm = termsAndConditions[1];
    const matches = secondTerm.match(/\b(\d+)\s*(?:days?)?\b/i);

    if (matches && matches[1]) {
        const days = parseInt(matches[1], 10);
        return [30, 60, 90, 120].includes(days) ? days : 30;
    }

    return 30;
};

const getDaysLeftFromInvoiceDate = (invoiceDate?: Date, paymentDays: number = 30): {
    daysLeft: number;
    message: string;
    dueDate?: Date;
    isExpired: boolean;
} => {
    if (!invoiceDate) {
        return {
            daysLeft: 0,
            message: `Invoice date not set`,
            dueDate: undefined,
            isExpired: false
        };
    }

    const invoice = new Date(invoiceDate);
    if (isNaN(invoice.getTime())) {
        return {
            daysLeft: 0,
            message: "Invalid invoice date",
            dueDate: undefined,
            isExpired: false
        };
    }

    const dueDate = new Date(invoice);
    dueDate.setDate(dueDate.getDate() + paymentDays);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let message = "";
    let isExpired = false;

    if (diffDays < 0) {
        message = "Expired";
        isExpired = true;
    } else {
        message = `${diffDays} days left`;
        isExpired = false;
    }

    return {
        daysLeft: diffDays,
        message: message,
        dueDate: dueDate,
        isExpired: isExpired
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

    const projectQuery: any = {
        progress: 100,
        invoiceDate: { $exists: true, $ne: null } // Only include projects with invoice date
    };

    if (client && client !== 'all') {
        projectQuery.client = client;
    }

    if (dateFrom || dateTo) {
        projectQuery.invoiceDate.$gte = dateFrom ? new Date(dateFrom as string) : undefined;
        projectQuery.invoiceDate.$lte = dateTo ? new Date(dateTo as string) : undefined;

        // Clean up if undefined values
        if (!dateFrom) delete projectQuery.invoiceDate.$gte;
        if (!dateTo) delete projectQuery.invoiceDate.$lte;
    }

    const projects = await Project.find(projectQuery)
        .populate<{ client: IClient }>("client", "clientName")
        .sort({ invoiceDate: -1, createdAt: -1 });

    if (!projects.length) {
        return res.status(200).json(
            new ApiResponse(200, {
                data: [],
                total: 0,
                page: pageNumber,
                limit: limitNumber,
                totalPages: 0,
                summary: {
                    totalProjects: 0,
                    totalNetAmount: 0,           // Total NET Amount (with VAT)
                    totalAmountWithoutVAT: 0,    // Total Amount (without VAT)
                    totalVATAmount: 0,           // Total VAT Amount
                    totalDueAmount: 0,           // Total Due Amount (expired NET amounts)
                    expiredProjects: 0,
                    activeProjects: 0,
                    projectsWithRemarks: 0
                }
            }, "No completed projects found")
        );
    }

    const invoiceReportData: InvoiceReportData[] = [];
    let totalNetAmount = 0;           // Total NET Amount (with VAT)
    let totalAmountWithoutVAT = 0;    // Total Amount (without VAT)
    let totalVATAmount = 0;           // Total VAT Amount
    let totalDueAmount = 0;           // Total Due Amount
    let expiredProjects = 0;
    let activeProjects = 0;
    let projectsWithRemarks = 0;

    for (const project of projects) {
        const clientName = project.client?.clientName || "N/A";

        const quotation = await Quotation.findOne({ project: project._id });
        const netAmount = quotation?.netAmount || 0;           // AMOUNT WITH VAT
        const vatAmount = quotation?.vatAmount || 0;           // VAT Amount
        const amountWithoutVAT = netAmount - vatAmount;        // NET Amount - VAT Amount

        const lpo = await LPO.findOne({ project: project._id });
        const lpoNumber = lpo?.lpoNumber || "N/A";
        const lpoDate = lpo?.lpoDate ? new Date(lpo.lpoDate).toISOString().split('T')[0] : "N/A";

        const today = new Date();

        const paymentTermsDays = quotation?.termsAndConditions ?
            extractPaymentDays(quotation.termsAndConditions) : 30;

        const daysLeftInfo = getDaysLeftFromInvoiceDate(
            project.invoiceDate,
            paymentTermsDays
        );

        // Calculate due amount (if expired, add to due amount)
        let dueAmount = 0;
        if (daysLeftInfo.isExpired) {
            dueAmount = netAmount;  // Use NET Amount (with VAT) for due amount
            totalDueAmount += dueAmount;
            expiredProjects++;
        } else {
            activeProjects++;
        }

        // Check if project has remarks
        if (project.invoiceRemarks && project.invoiceRemarks.trim().length > 0) {
            projectsWithRemarks++;
        }

        // Add to totals
        totalNetAmount += netAmount;
        totalAmountWithoutVAT += amountWithoutVAT;
        totalVATAmount += vatAmount;

        invoiceReportData.push({
            projectId: project._id.toString(),
            projectNumber: project.projectNumber || "N/A",
            projectName: project.projectName,
            projectDescription: project.projectDescription || "No description",
            clientName,
            grnNumber: project.grnNumber,
            netAmount: netAmount,                     // AMOUNT WITH VAT
            vatAmount: vatAmount,                     // VAT Amount
            amountWithoutVAT: amountWithoutVAT,       // NET Amount - VAT Amount
            invoiceRemarks: project.invoiceRemarks || "",
            grnUpdatedDate: project.invoiceDate ? project.invoiceDate.toISOString().split('T')[0] : undefined,
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
            isExpired: daysLeftInfo.isExpired,
        });
    }

    let filteredData = invoiceReportData;
    if (search && typeof search === 'string' && search.trim() !== '') {
        const searchTerm = search.toLowerCase().trim();
        filteredData = invoiceReportData.filter(item =>
            item.projectName.toLowerCase().includes(searchTerm) ||
            item.projectNumber.toLowerCase().includes(searchTerm) ||
            item.clientName.toLowerCase().includes(searchTerm) ||
            item.lpoNumber.toLowerCase().includes(searchTerm) ||
            item.grnNumber?.toLowerCase().includes(searchTerm) ||
            item.projectDescription.toLowerCase().includes(searchTerm) ||
            item.invoiceRemarks?.toLowerCase().includes(searchTerm)
        );
    }

    // Recalculate summary for filtered data
    const filteredTotalNetAmount = filteredData.reduce((sum, item) => sum + item.netAmount, 0);
    const filteredTotalAmountWithoutVAT = filteredData.reduce((sum, item) => sum + item.amountWithoutVAT, 0);
    const filteredTotalVATAmount = filteredData.reduce((sum, item) => sum + item.vatAmount, 0);
    const filteredTotalDueAmount = filteredData.reduce((sum, item) => sum + (item.isExpired ? item.netAmount : 0), 0);
    const filteredExpiredProjects = filteredData.filter(item => item.isExpired).length;
    const filteredActiveProjects = filteredData.length - filteredExpiredProjects;
    const filteredProjectsWithRemarks = filteredData.filter(item =>
        item.invoiceRemarks && item.invoiceRemarks.trim().length > 0
    ).length;

    const total = filteredData.length;
    const totalPages = Math.ceil(total / limitNumber);
    const startIndex = (pageNumber - 1) * limitNumber;
    const endIndex = Math.min(startIndex + limitNumber, total);
    const paginatedData = filteredData.slice(startIndex, endIndex);

    const summary = {
        totalProjects: total,
        totalNetAmount: filteredTotalNetAmount,           // Total NET Amount (with VAT)
        totalAmountWithoutVAT: filteredTotalAmountWithoutVAT,  // Total Amount (without VAT)
        totalVATAmount: filteredTotalVATAmount,           // Total VAT Amount
        totalDueAmount: filteredTotalDueAmount,           // Total Due Amount (expired NET amounts)
        expiredProjects: filteredExpiredProjects,
        activeProjects: filteredActiveProjects,
        projectsWithRemarks: filteredProjectsWithRemarks
    };

    if (exportType === 'excel') {
        return generateInvoiceExcelReport(filteredData, summary, res);
    }

    return res.status(200).json(
        new ApiResponse(200, {
            data: paginatedData,
            total,
            page: pageNumber,
            limit: limitNumber,
            totalPages,
            summary
        }, "Invoice report fetched successfully")
    );
});

const generateInvoiceExcelReport = async (
    data: InvoiceReportData[],
    summary: any,
    res: Response
) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Invoice Report');

        // Define constants for column counts
        const TOTAL_COLUMNS = 22; // From A to V (22 columns)
        const LAST_COLUMN_LETTER = 'V';

        // Add title with blue background (matching payroll Excel)
        worksheet.mergeCells(`A1:${LAST_COLUMN_LETTER}1`);
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'INVOICE REPORT - COMPLETED PROJECTS (100% PROGRESS)';
        titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        titleCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2c5aa0' } // Same blue as payroll Excel
        };
        worksheet.getRow(1).height = 30;

        // Add summary section with matching styling
        worksheet.mergeCells(`A3:${LAST_COLUMN_LETTER}3`);
        const summaryTitleCell = worksheet.getCell('A3');
        summaryTitleCell.value = 'FINANCIAL SUMMARY (WITH VAT SEPARATION)';
        summaryTitleCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        summaryTitleCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        summaryTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(3).height = 25;

        // Summary data with clear labels and proper alignment
        const summaryData = [
            ['Total Projects:', summary.totalProjects, '', 'Expired Projects:', summary.expiredProjects, '', 'Active Projects:', summary.activeProjects],
            ['NET Amount (With VAT):', summary.totalNetAmount, '', 'Amount (Without VAT):', summary.totalAmountWithoutVAT, '', 'VAT Amount:', summary.totalVATAmount],
            ['Due Amount (Expired):', summary.totalDueAmount, '', 'Projects with Remarks:', summary.projectsWithRemarks, '', 'VAT Rate:', '5%']
        ];

        summaryData.forEach((rowData, rowIndex) => {
            const rowNumber = 4 + rowIndex;
            const row = worksheet.addRow(rowData);
            row.height = 22;

            // Limit to our defined columns
            for (let i = 1; i <= Math.min(TOTAL_COLUMNS, rowData.length); i++) {
                const cell = row.getCell(i);

                if (i % 2 === 1) {
                    // Label cells
                    cell.font = { bold: true };
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: rowIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2' }
                    };
                } else if (i % 2 === 0 && i !== 3 && i !== 6) {
                    // Value cells (skip empty cells)
                    if (typeof cell.value === 'number') {
                        cell.numFmt = '#,##0.00';
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    }
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: rowIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2' }
                    };
                }

                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                    left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                    bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                    right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
                };
            }
        });

        // Highlight due amount row
        const dueAmountCell = worksheet.getCell('B6');
        dueAmountCell.font = { bold: true, color: { argb: 'FFC55A11' } };
        dueAmountCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFCE4D6' }
        };

        // Add empty row
        worksheet.addRow([]);

        // Add headers with S/NO column and blue background
        const headers = [
            'S/NO',
            'PROJECT NUMBER',
            'PROJECT NAME',
            'CLIENT NAME',
            'INVOICE DATE',
            'GRN NUMBER',
            'NET AMOUNT (AED)',        // WITH VAT
            'AMOUNT WITHOUT VAT (AED)', // WITHOUT VAT (NET - VAT)
            'VAT AMOUNT (AED)',
            'DUE AMOUNT (AED)',        // If expired
            'INVOICE REMARKS',
            'PAYMENT TERMS (DAYS)',
            'DUE DATE',
            'PAYMENT STATUS',
            'LPO NUMBER',
            'LPO DATE',
            'WORK START DATE',
            'WORK END DATE',
            'PROJECT STATUS',
            'REMAINING DAYS',
            'DAYS STATUS',
            'VAT %'
        ];

        const headerRow = worksheet.addRow(headers);
        headerRow.height = 25;
        headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

        // Apply fill only to cells A-V (not infinite)
        for (let i = 1; i <= TOTAL_COLUMNS; i++) {
            const cell = headerRow.getCell(i);
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF2c5aa0' }
            };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF000000' } },
                left: { style: 'thin', color: { argb: 'FF000000' } },
                bottom: { style: 'thin', color: { argb: 'FF000000' } },
                right: { style: 'thin', color: { argb: 'FF000000' } }
            };
        }

        // Add data rows with S/NO
        let totalNetAmount = 0;
        let totalAmountWithoutVAT = 0;
        let totalVATAmount = 0;
        let totalDueAmount = 0;

        data.forEach((item, index) => {
            const dueAmount = item.isExpired ? item.netAmount : 0;
            const vatPercentage = item.netAmount > 0 ?
                Math.round((item.vatAmount / (item.netAmount - item.vatAmount)) * 100) : 0;

            const row = worksheet.addRow([
                index + 1,
                item.projectNumber,
                item.projectName,
                item.clientName,
                item.invoiceDate || 'Not set',
                item.grnNumber || 'N/A',
                item.netAmount,                     // WITH VAT
                item.amountWithoutVAT,              // WITHOUT VAT (NET - VAT)
                item.vatAmount,                     // VAT Amount
                dueAmount,                          // Due Amount if expired
                item.invoiceRemarks || 'No remarks',
                item.paymentTermsDays,
                item.dueDate || 'N/A',
                item.remainingDaysForPayment,
                item.lpoNumber,
                item.lpoDate,
                item.workStartDate || 'N/A',
                item.workEndDate || 'N/A',
                item.projectStatus,
                Math.abs(item.remainingPaymentDays),
                item.isExpired ? 'Expired' : 'Active',
                `${vatPercentage}%`
            ]);

            // Add to totals
            totalNetAmount += item.netAmount;
            totalAmountWithoutVAT += item.amountWithoutVAT;
            totalVATAmount += item.vatAmount;
            totalDueAmount += dueAmount;

            row.height = 22;

            // Alternate row colors
            const rowColor = index % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2';

            for (let i = 1; i <= TOTAL_COLUMNS; i++) {
                const cell = row.getCell(i);
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

                // Center align serial number
                if (i === 1) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                }

                // Format currency cells and align right
                if ([7, 8, 9, 10].includes(i)) {
                    cell.numFmt = '#,##0.00';
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                }

                // Align numeric columns right
                if ([12, 20].includes(i)) {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                }
            }

            // Color code based on status
            if (item.isExpired) {
                // Red/Orange for expired projects
                const daysStatusCell = row.getCell(21);
                daysStatusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFCE4D6' }
                };
                daysStatusCell.font = { bold: true, color: { argb: 'FFC55A11' } };

                // Highlight due amount cell
                const dueAmountCell = row.getCell(10);
                dueAmountCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFCE4D6' }
                };
                dueAmountCell.font = { bold: true, color: { argb: 'FFC55A11' } };

                // Highlight payment status
                const paymentStatusCell = row.getCell(14);
                paymentStatusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFCE4D6' }
                };
                paymentStatusCell.font = { bold: true, color: { argb: 'FFC55A11' } };

            } else if (item.remainingPaymentDays <= 7) {
                // Yellow for due within 7 days
                const daysStatusCell = row.getCell(21);
                daysStatusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFF9E6' }
                };
                daysStatusCell.font = { bold: true, color: { argb: 'FF856404' } };
            }

            // Style remarks column
            const remarksCell = row.getCell(11);
            if (item.invoiceRemarks && item.invoiceRemarks.trim().length > 0) {
                remarksCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE8F4FD' }
                };
                remarksCell.alignment = { wrapText: true };
            }

            // Highlight NET Amount (with VAT) - different background
            const netAmountCell = row.getCell(7);
            netAmountCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE8F4FD' }
            };
            netAmountCell.font = { bold: true };
        });

        // Add totals row (yellow background like payroll Excel)
        const totalsRowNumber = data.length + 9; // 1 title + 3 summary rows + 1 empty + 1 header + data.length
        const totalsRowData = Array(TOTAL_COLUMNS).fill('');
        totalsRowData[1] = 'TOTALS'; // Column B
        totalsRowData[6] = totalNetAmount; // Column G
        totalsRowData[7] = totalAmountWithoutVAT; // Column H
        totalsRowData[8] = totalVATAmount; // Column I
        totalsRowData[9] = totalDueAmount; // Column J

        const totalsRow = worksheet.addRow(totalsRowData);
        totalsRow.height = 25;
        totalsRow.font = { bold: true, size: 11 };

        // Apply yellow background only to relevant cells, not entire infinite row
        const relevantTotalCells = [1, 2, 7, 8, 9, 10]; // A, B, G, H, I, J

        for (let i = 1; i <= TOTAL_COLUMNS; i++) {
            const cell = totalsRow.getCell(i);

            // Apply yellow background only to relevant cells
            if (relevantTotalCells.includes(i)) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFEB3B' }
                };
            } else {
                // White background for other cells
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFFF' }
                };
            }

            // Format currency cells
            if ([7, 8, 9, 10].includes(i)) {
                cell.numFmt = '#,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else if (i === 2) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            }

            cell.border = {
                top: { style: 'medium', color: { argb: 'FF000000' } },
                left: { style: 'thin', color: { argb: 'FF000000' } },
                bottom: { style: 'medium', color: { argb: 'FF000000' } },
                right: { style: 'thin', color: { argb: 'FF000000' } }
            };
        }

        // Color the due amount total cell (Column J)
        const dueAmountTotalCell = totalsRow.getCell(10);
        if (totalDueAmount > 0) {
            dueAmountTotalCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF8CBAD' }
            };
            dueAmountTotalCell.font = { bold: true, color: { argb: 'FFC55A11' } };
        }

        // Set column widths - Set widths for all columns explicitly
        const columnWidths = [
            8,   // A: S/NO
            15,  // B: Project Number
            25,  // C: Project Name
            20,  // D: Client Name
            15,  // E: Invoice Date
            15,  // F: GRN Number
            18,  // G: NET Amount (with VAT)
            20,  // H: Amount (without VAT)
            15,  // I: VAT Amount
            15,  // J: Due Amount
            30,  // K: Invoice Remarks
            18,  // L: Payment Terms
            15,  // M: Due Date
            18,  // N: Payment Status
            15,  // O: LPO Number
            15,  // P: LPO Date
            15,  // Q: Work Start Date
            15,  // R: Work End Date
            20,  // S: Project Status
            15,  // T: Remaining Days
            15,  // U: Days Status
            10   // V: VAT %
        ];

        columnWidths.forEach((width, index) => {
            worksheet.getColumn(index + 1).width = width;
        });

        // Add signature section (matching payroll Excel)
        const signatureStartRow = totalsRowNumber + 2;

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
        worksheet.mergeCells(`A${footerRow.number}:${LAST_COLUMN_LETTER}${footerRow.number}`);
        const footerCell = worksheet.getCell(`A${footerRow.number}`);
        footerCell.value = 'This report is generated using AGATS software';
        footerCell.font = { italic: true, size: 10, color: { argb: 'FF808080' } };
        footerCell.alignment = { vertical: 'middle', horizontal: 'center' };
        footerRow.height = 20;

        // Set response headers
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

export const getClientsForFilter = asyncHandler(async (req: Request, res: Response) => {
    const clients = await Client.find()
        .select('_id clientName')
        .sort({ clientName: 1 });

    return res.status(200).json(
        new ApiResponse(200, clients, "Clients fetched successfully")
    );
});