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
        progress: 100
    };

    if (client && client !== 'all') {
        projectQuery.client = client;
    }

    if (dateFrom || dateTo) {
        projectQuery.invoiceDate = {};
        if (dateFrom) {
            projectQuery.invoiceDate.$gte = new Date(dateFrom as string);
        }
        if (dateTo) {
            projectQuery.invoiceDate.$lte = new Date(dateTo as string);
        }
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

        // Add title
        worksheet.mergeCells('A1:U1');
        worksheet.getCell('A1').value = `Invoice Report - Completed Projects (100% Progress)`;
        worksheet.getCell('A1').font = { size: 16, bold: true };
        worksheet.getCell('A1').alignment = { horizontal: 'center' };

        // Add summary section
        worksheet.mergeCells('A3:E3');
        worksheet.getCell('A3').value = 'FINANCIAL SUMMARY';
        worksheet.getCell('A3').font = { bold: true, size: 12 };
        worksheet.getCell('A3').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F81BD' }
        };
        worksheet.getCell('A3').font = { color: { argb: 'FFFFFFFF' }, bold: true };

        // Summary data with clear labels
        const summaryData = [
            ['Total Projects:', summary.totalProjects, '', '', ''],
            ['Total NET Amount (with VAT):', summary.totalNetAmount, '', 'VAT Amount:', summary.totalVATAmount],
            ['Total Amount (without VAT):', summary.totalAmountWithoutVAT, '', 'Due Amount:', summary.totalDueAmount],
            ['Expired Projects:', summary.expiredProjects, '', 'Active Projects:', summary.activeProjects],
            ['Projects with Remarks:', summary.projectsWithRemarks, '', 'VAT Rate:', '5%']
        ];

        summaryData.forEach(([label1, value1, spacer, label2, value2], index) => {
            const row = 4 + index;
            worksheet.getCell(`A${row}`).value = label1;
            worksheet.getCell(`B${row}`).value = value1;

            if (typeof value1 === 'number') {
                worksheet.getCell(`B${row}`).numFmt = '#,##0.00';
            }

            if (label2 && value2 !== undefined) {
                worksheet.getCell(`D${row}`).value = label2;
                worksheet.getCell(`E${row}`).value = value2;

                if (typeof value2 === 'number') {
                    worksheet.getCell(`E${row}`).numFmt = '#,##0.00';
                }
            }
        });

        // Style summary cells
        for (let i = 3; i <= 8; i++) {
            const row = worksheet.getRow(i);
            row.height = 25;
            if (i > 3) {
                row.getCell(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF2F2F2' }
                };
                if (row.getCell(4).value) {
                    row.getCell(4).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF2F2F2' }
                    };
                }
            }
        }

        // Highlight due amount row
        worksheet.getCell('E6').font = { bold: true, color: { argb: 'FFFF0000' } };
        worksheet.getCell('E6').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFE4B5' }
        };

        // Add headers with clear labels
        const headers = [
            'Project Number',
            'Project Name',
            'Client Name',
            'Invoice Date',
            'GRN Number',
            'NET Amount (AED)',        // WITH VAT
            'Amount (AED)',            // WITHOUT VAT (NET - VAT)
            'VAT Amount (AED)',
            'Due Amount (AED)',        // If expired
            'Invoice Remarks',
            'Payment Terms (Days)',
            'Due Date',
            'Payment Status',
            'LPO Number',
            'LPO Date',
            'Work Start Date',
            'Work End Date',
            'Project Status',
            'Remaining Days',
            'Days Status',
            'VAT %'
        ];

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
        data.forEach((item, index) => {
            const dueAmount = item.isExpired ? item.netAmount : 0;
            const vatPercentage = item.netAmount > 0 ?
                Math.round((item.vatAmount / (item.netAmount - item.vatAmount)) * 100) : 0;

            const row = worksheet.addRow([
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

            // Style the row
            row.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };

            // Format currency cells
            [6, 7, 8, 9].forEach(colIndex => {
                const cell = row.getCell(colIndex);
                cell.numFmt = '#,##0.00';
            });

            // Color code based on status
            if (item.isExpired) {
                // Red for expired projects
                [9, 12, 19].forEach(colIndex => {
                    const cell = row.getCell(colIndex);
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFF0000' }
                    };
                    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
                });

                // Highlight due amount cell
                const dueAmountCell = row.getCell(9);
                dueAmountCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFF0000' }
                };
                dueAmountCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };

            } else if (item.remainingPaymentDays <= 7) {
                // Yellow for due within 7 days
                const paymentStatusCell = row.getCell(13);
                paymentStatusCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFF00' }
                };
            }

            // Style remarks column
            const remarksCell = row.getCell(10);
            if (item.invoiceRemarks && item.invoiceRemarks.trim().length > 0) {
                remarksCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFE0' }
                };
                remarksCell.alignment = { wrapText: true };
            }

            // Format date cells
            [4, 12, 15, 16].forEach(colIndex => {
                const cell = row.getCell(colIndex);
                cell.numFmt = 'dd/mm/yyyy';
            });

            // Highlight NET Amount (with VAT) - slightly different background
            const netAmountCell = row.getCell(6);
            netAmountCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE6F3FF' }
            };
            netAmountCell.font = { bold: true };
        });

        // Set column widths
        const columnWidths = [
            15,  // Project Number
            25,  // Project Name
            20,  // Client Name
            15,  // Invoice Date
            15,  // GRN Number
            18,  // NET Amount (with VAT)
            18,  // Amount (without VAT)
            15,  // VAT Amount
            15,  // Due Amount
            30,  // Invoice Remarks
            15,  // Payment Terms
            15,  // Due Date
            18,  // Payment Status
            15,  // LPO Number
            15,  // LPO Date
            15,  // Work Start Date
            15,  // Work End Date
            20,  // Project Status
            15,  // Remaining Days
            15,  // Days Status
            10   // VAT %
        ];

        columnWidths.forEach((width, index) => {
            worksheet.getColumn(index + 1).width = width;
        });

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