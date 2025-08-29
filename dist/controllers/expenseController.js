"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateExpensePdf = exports.getExpenseSummary = exports.deleteExpense = exports.updateExpense = exports.getExpenseById = exports.getProjectExpenses = exports.createExpense = exports.getProjectLaborData = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const expenseModel_1 = require("../models/expenseModel");
const projectModel_1 = require("../models/projectModel");
const attendanceModel_1 = require("../models/attendanceModel");
const mongoose_1 = require("mongoose");
const uploadConf_1 = require("../utils/uploadConf");
const quotationModel_1 = require("../models/quotationModel");
const estimationModel_1 = require("../models/estimationModel");
const puppeteer_1 = __importDefault(require("puppeteer"));
const calculateLaborDetails = async (projectId) => {
    const project = await projectModel_1.Project.findById(projectId)
        .populate("assignedWorkers", "firstName lastName profileImage salary")
        .populate("assignedDriver", "firstName lastName profileImage salary");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    const workersToProcess = project.assignedWorkers || [];
    const workerIds = workersToProcess.map((worker) => worker._id);
    const workerAttendanceRecords = await attendanceModel_1.Attendance.find({
        project: projectId,
        present: true,
        user: { $in: workerIds },
    }).populate("user", "firstName lastName");
    const workerDaysMap = new Map();
    workerAttendanceRecords.forEach((record) => {
        const userIdStr = record.user._id.toString();
        workerDaysMap.set(userIdStr, (workerDaysMap.get(userIdStr) || 0) + 1);
    });
    const projectAttendanceDates = await attendanceModel_1.Attendance.aggregate([
        {
            $match: {
                project: new mongoose_1.Types.ObjectId(projectId),
                present: true,
            },
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$date" },
                },
            },
        },
        {
            $count: "uniqueDates",
        },
    ]);
    const driverDaysPresent = projectAttendanceDates[0]?.uniqueDates || 0;
    const workers = workersToProcess.map((worker) => ({
        user: worker._id,
        firstName: worker.firstName,
        lastName: worker.lastName,
        profileImage: worker.profileImage,
        daysPresent: workerDaysMap.get(worker._id.toString()) || 0,
        dailySalary: worker.salary || 0,
        totalSalary: (workerDaysMap.get(worker._id.toString()) || 0) * (worker.salary || 0),
    }));
    const driver = project.assignedDriver
        ? {
            user: project.assignedDriver._id,
            firstName: project.assignedDriver.firstName,
            lastName: project.assignedDriver.lastName,
            profileImage: project.assignedDriver.profileImage,
            daysPresent: driverDaysPresent,
            dailySalary: project.assignedDriver.salary || 0,
            totalSalary: driverDaysPresent * (project.assignedDriver.salary || 0),
        }
        : {
            user: new mongoose_1.Types.ObjectId(),
            firstName: "No",
            lastName: "Driver",
            daysPresent: 0,
            dailySalary: 0,
            totalSalary: 0,
        };
    const totalLaborCost = workers.reduce((sum, worker) => sum + worker.totalSalary, 0) +
        driver.totalSalary;
    return {
        workers,
        driver,
        totalLaborCost,
    };
};
exports.getProjectLaborData = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    try {
        const laborData = await calculateLaborDetails(projectId);
        res
            .status(200)
            .json(new apiHandlerHelpers_1.ApiResponse(200, laborData, "Labor data fetched successfully"));
    }
    catch (error) {
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to fetch labor data");
    }
});
async function processMaterialsWithFiles(materials, files, prefix) {
    const fileMap = new Map();
    files.forEach((file) => {
        const indexMatch = file.originalname.match(new RegExp(`${prefix}(\\d+)`));
        if (indexMatch) {
            fileMap.set(parseInt(indexMatch[1], 10), file);
        }
    });
    return await Promise.all(materials.map(async (material, index) => {
        const processedMaterial = { ...material };
        if (fileMap.has(index)) {
            try {
                const uploadResult = await (0, uploadConf_1.uploadExpenseDocument)(fileMap.get(index));
                if (uploadResult.success) {
                    processedMaterial.documentUrl = uploadResult.uploadData?.url;
                    processedMaterial.documentKey = uploadResult.uploadData?.key;
                }
            }
            catch (uploadError) {
                console.error(`File upload error for material ${index}:`, uploadError);
            }
        }
        return processedMaterial;
    }));
}
exports.createExpense = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const userId = req.user?.userId;
    if (!userId) {
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized");
    }
    if (!req.body.materials || !req.body.miscellaneous) {
        throw new apiHandlerHelpers_2.ApiError(400, "Materials and miscellaneous data are required");
    }
    let materials;
    let miscellaneous;
    try {
        materials =
            typeof req.body.materials === "string"
                ? JSON.parse(req.body.materials)
                : req.body.materials;
        miscellaneous =
            typeof req.body.miscellaneous === "string"
                ? JSON.parse(req.body.miscellaneous)
                : req.body.miscellaneous;
    }
    catch (err) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid JSON format for materials or miscellaneous");
    }
    const files = req.files;
    const materialFiles = files?.materialFiles ? [...files.materialFiles] : [];
    try {
        const laborDetails = await calculateLaborDetails(projectId);
        const processedMaterials = await processMaterialsWithFiles(materials, materialFiles, "material-");
        const expense = await expenseModel_1.Expense.create({
            project: projectId,
            materials: processedMaterials,
            miscellaneous,
            laborDetails,
            createdBy: new mongoose_1.Types.ObjectId(userId),
        });
        return res
            .status(201)
            .json(new apiHandlerHelpers_1.ApiResponse(201, expense, "Expense created successfully"));
    }
    catch (error) {
        console.error("Expense creation error:", error);
        const status = error instanceof apiHandlerHelpers_2.ApiError ? error.statusCode : 500;
        const message = error instanceof Error ? error.message : "Failed to create expense";
        throw new apiHandlerHelpers_2.ApiError(status, message);
    }
});
exports.getProjectExpenses = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const total = await expenseModel_1.Expense.countDocuments({ project: projectId });
    const expenses = await expenseModel_1.Expense.find({ project: projectId })
        .populate("laborDetails.workers.user", "firstName lastName profileImage salary")
        .populate("laborDetails.driver.user", "firstName lastName profileImage salary")
        .populate("createdBy", "firstName lastName")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    const expensesWithDownloadUrls = expenses.map((expense) => ({
        ...expense.toObject(),
        materials: expense.materials.map((material) => ({
            ...material,
            documentDownloadUrl: material.documentKey
                ? `${req.protocol}://${req.get("host")}/api/expenses/document/${material.documentKey}`
                : null,
        })),
    }));
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        expenses: expensesWithDownloadUrls,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Expenses fetched successfully"));
});
exports.getExpenseById = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { expenseId } = req.params;
    const expense = await expenseModel_1.Expense.findById(expenseId)
        .populate("laborDetails.workers.user", "firstName lastName profileImage salary")
        .populate("laborDetails.driver.user", "firstName lastName profileImage salary")
        .populate("createdBy", "firstName lastName")
        .populate("project", "projectName projectNumber");
    if (!expense) {
        throw new apiHandlerHelpers_2.ApiError(404, "Expense not found");
    }
    const estimation = await estimationModel_1.Estimation.findOne({ project: expense.project });
    const expenseWithDownloadUrls = {
        ...expense.toObject(),
        materials: expense.materials.map((material) => ({
            ...material,
            documentDownloadUrl: material.documentKey
                ? `${req.protocol}://${req.get("host")}/api/expenses/document/${material.documentKey}`
                : null,
        })),
        quotation: await quotationModel_1.Quotation.findOne({ project: expense.project }).select("netAmount"),
        commissionAmount: estimation?.commissionAmount || 0,
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, expenseWithDownloadUrls, "Expense fetched successfully"));
});
exports.updateExpense = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { expenseId } = req.params;
    const { materials, miscellaneous } = req.body;
    const files = req.files;
    if (!materials ||
        !Array.isArray(materials) ||
        !miscellaneous ||
        !Array.isArray(miscellaneous)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Materials and miscellaneous arrays are required");
    }
    const existingExpense = await expenseModel_1.Expense.findById(expenseId);
    if (!existingExpense) {
        throw new apiHandlerHelpers_2.ApiError(404, "Expense not found");
    }
    const laborDetails = await calculateLaborDetails(existingExpense.project.toString());
    // Process materials with documents
    const processedMaterials = await Promise.all(materials.map(async (material, index) => {
        const materialData = {
            description: material.description,
            date: material.date || new Date(),
            invoiceNo: material.invoiceNo,
            amount: material.amount,
            supplierName: material.supplierName || "",
            supplierMobile: material.supplierMobile || "",
            supplierEmail: material.supplierEmail || "",
        };
        if (files?.materialFiles?.[index]) {
            if (existingExpense.materials[index]?.documentKey) {
                await (0, uploadConf_1.deleteFileFromS3)(existingExpense.materials[index].documentKey);
            }
            const uploadResult = await (0, uploadConf_1.uploadExpenseDocument)(files.materialFiles[index]);
            if (!uploadResult.success) {
                throw new apiHandlerHelpers_2.ApiError(500, `Failed to upload document for material item ${index + 1}`);
            }
            materialData.documentUrl = uploadResult.uploadData?.url;
            materialData.documentKey = uploadResult.uploadData?.key;
        }
        else if (existingExpense.materials[index]?.documentKey) {
            materialData.documentUrl =
                existingExpense.materials[index].documentUrl;
            materialData.documentKey =
                existingExpense.materials[index].documentKey;
        }
        return materialData;
    }));
    const updatedExpense = await expenseModel_1.Expense.findByIdAndUpdate(expenseId, {
        materials: processedMaterials,
        miscellaneous,
        laborDetails,
        updatedAt: new Date(),
    }, { new: true })
        .populate("laborDetails.workers.user", "firstName lastName profileImage salary")
        .populate("laborDetails.driver.user", "firstName lastName profileImage salary")
        .populate("createdBy", "firstName lastName");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedExpense, "Expense updated successfully"));
});
exports.deleteExpense = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { expenseId } = req.params;
    const expense = await expenseModel_1.Expense.findById(expenseId);
    if (!expense) {
        throw new apiHandlerHelpers_2.ApiError(404, "Expense not found");
    }
    await Promise.all([
        ...expense.materials.map(async (material) => {
            if (material.documentKey) {
                await (0, uploadConf_1.deleteFileFromS3)(material.documentKey);
            }
        }),
    ]);
    await expenseModel_1.Expense.findByIdAndDelete(expenseId);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Expense deleted successfully"));
});
exports.getExpenseSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const expenses = await expenseModel_1.Expense.find({ project: projectId });
    const estimation = await estimationModel_1.Estimation.findOne({ project: projectId });
    const summary = {
        totalMaterialCost: expenses.reduce((sum, e) => sum + e.totalMaterialCost, 0),
        totalMiscellaneousCost: expenses.reduce((sum, e) => sum + (e.totalMiscellaneousCost || 0), 0),
        totalLaborCost: expenses.reduce((sum, e) => sum + e.laborDetails.totalLaborCost, 0),
        workersCost: expenses.reduce((sum, e) => sum +
            e.laborDetails.workers.reduce((wSum, w) => wSum + w.totalSalary, 0), 0),
        driverCost: expenses.reduce((sum, e) => sum + e.laborDetails.driver.totalSalary, 0),
        commissionAmount: estimation?.commissionAmount || 0,
        totalExpenses: expenses.reduce((sum, e) => sum +
            e.totalMaterialCost +
            (e.totalMiscellaneousCost || 0) +
            e.laborDetails.totalLaborCost, 0),
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, summary, "Expense summary fetched successfully"));
});
exports.generateExpensePdf = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const expense = (await expenseModel_1.Expense.findById(id)
        .populate("project", "projectName projectNumber")
        .populate("createdBy", "firstName lastName")
        .populate("laborDetails.workers.user", "firstName lastName")
        .populate("laborDetails.driver.user", "firstName lastName"));
    if (!expense) {
        throw new apiHandlerHelpers_2.ApiError(404, "Expense not found");
    }
    const quotation = await quotationModel_1.Quotation.findOne({ project: expense.project });
    const estimation = await estimationModel_1.Estimation.findOne({ project: expense.project });
    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    };
    const totalMaterialCost = expense.totalMaterialCost;
    const totalMiscellaneousCost = expense.totalMiscellaneousCost || 0;
    const totalLaborCost = expense.laborDetails.totalLaborCost;
    const totalExpense = totalMaterialCost + totalMiscellaneousCost + totalLaborCost;
    const quotationAmount = quotation?.netAmount || 0;
    const commissionAmount = estimation?.commissionAmount || 0;
    const profit = quotationAmount - totalExpense - commissionAmount;
    const profitPercentage = quotationAmount
        ? (profit / quotationAmount) * 100
        : 0;
    let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <style type="text/css">
        @page {
          size: A4;
          margin: 1cm;
        }
        body {
          font-family: 'Arial', sans-serif;
          font-size: 10pt;
          line-height: 1.4;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .header {
          text-align: center;
          margin-bottom: 15px;
        }
        .logo {
          height: 70px;
          width: auto;
        }
        .document-title {
          font-size: 14pt;
          font-weight: bold;
          margin: 5px 0;
        }
        .project-info {
          font-size: 11pt;
          margin-bottom: 10px;
        }
        .section {
          margin-bottom: 15px;
          page-break-inside: avoid;
        }
        .section-title {
          font-size: 11pt;
          font-weight: bold;
          padding: 5px 0;
          margin: 10px 0 5px 0;
          border-bottom: 1px solid #ddd;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
          page-break-inside: avoid;
        }
        th {
          background-color: #f5f5f5;
          font-weight: bold;
          padding: 6px 8px;
          text-align: left;
          border: 1px solid #ddd;
        }
        td {
          padding: 6px 8px;
          border: 1px solid #ddd;
          vertical-align: top;
        }
        .total-row {
          font-weight: bold;
        }
        .text-right {
          text-align: right;
        }
        .footer {
          margin-top: 20px;
          font-size: 9pt;
          color: #777;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg" alt="Company Logo">
        <div class="document-title">EXPENSE REPORT</div>
        <div class="project-info">${expense.project.projectName} (${expense.project.projectNumber})</div>
      </div>

      <div class="section">
        <div class="section-title">MATERIAL EXPENSES</div>
        <table>
          <thead>
            <tr>
              <th width="5%">No.</th>
              <th width="25%">Description</th>
              <th width="12%">Date</th>
              <th width="15%">Invoice No</th>
              <th width="18%">Supplier Name</th>
              <th width="15%">Supplier Mobile</th>
              <th width="10%" class="text-right">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${expense.materials
        .map((material, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${material.description}</td>
                <td>${formatDate(material.date)}</td>
                <td>${material.invoiceNo}</td>
                <td>${material.supplierName || "N/A"}</td>
                <td>${material.supplierMobile || "N/A"}</td>
                <td class="text-right">${material.amount.toFixed(2)}</td>
              </tr>
            `)
        .join("")}
            <tr class="total-row">
              <td colspan="6">TOTAL MATERIAL COST</td>
              <td class="text-right">${totalMaterialCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">MISCELLANEOUS EXPENSES</div>
        <table>
          <thead>
            <tr>
              <th width="5%">No.</th>
              <th width="40%">Description</th>
              <th width="15%">Qty</th>
              <th width="15%">Unit Price</th>
              <th width="25%" class="text-right">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${expense.miscellaneous
        .map((item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${item.description}</td>
                <td>${item.quantity}</td>
                <td>${item.unitPrice.toFixed(2)}</td>
                <td class="text-right">${item.total.toFixed(2)}</td>
              </tr>
            `)
        .join("")}
            <tr class="total-row">
              <td colspan="4">TOTAL MISCELLANEOUS COST</td>
              <td class="text-right">${totalMiscellaneousCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">LABOR DETAILS</div>
        <table>
          <thead>
            <tr>
              <th width="5%">No.</th>
              <th width="65%">Description</th>
              <th width="30%" class="text-right">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Technicians Expenses</td>
              <td class="text-right">${expense.laborDetails.workers
        .reduce((sum, worker) => sum + worker.totalSalary, 0)
        .toFixed(2)}</td>
            </tr>
            <tr>
              <td>2</td>
              <td>Driver Expenses</td>
              <td class="text-right">${expense.laborDetails.driver.totalSalary.toFixed(2)}</td>
            </tr>
            <tr class="total-row">
              <td colspan="2">TOTAL LABOR COST</td>
              <td class="text-right">${totalLaborCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">SUMMARY</div>
        <table>
          <tbody>
            <tr>
              <td>Total Material Cost</td>
              <td class="text-right">${totalMaterialCost.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Total Miscellaneous Cost</td>
              <td class="text-right">${totalMiscellaneousCost.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Total Labor Cost</td>
              <td class="text-right">${totalLaborCost.toFixed(2)}</td>
            </tr>
            <tr class="total-row">
              <td>TOTAL EXPENSES</td>
              <td class="text-right">${totalExpense.toFixed(2)}</td>
            </tr>
            ${quotation
        ? `
              <tr>
                <td>Project Quotation Amount</td>
                <td class="text-right">${quotationAmount.toFixed(2)}</td>
              </tr>
              ${commissionAmount > 0
            ? `<tr>
                      <td>Commission Amount</td>
                      <td class="text-right">${commissionAmount.toFixed(2)}</td>
                    </tr>`
            : ""}
              <tr class="total-row">
                <td>${profit >= 0 ? "PROFIT" : "LOSS"}</td>
                <td class="text-right">${profit.toFixed(2)} (${profitPercentage.toFixed(2)}%)</td>
              </tr>
            `
        : ""}
          </tbody>
        </table>
      </div>

      <div class="footer">
        <p>Generated on ${formatDate(new Date())} by ${expense.createdBy.firstName} ${expense.createdBy.lastName}</p>
      </div>
    </body>
    </html>
    `;
    const browser = await puppeteer_1.default.launch({
        headless: "shell",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, {
            waitUntil: ["load", "networkidle0", "domcontentloaded"],
            timeout: 30000,
        });
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "1cm",
                right: "1cm",
                bottom: "1cm",
                left: "1cm",
            },
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=expense-report-${expense.project.projectNumber}.pdf`);
        res.send(pdfBuffer);
    }
    catch (error) {
        console.error("PDF generation error:", error);
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to generate PDF");
    }
    finally {
        await browser.close();
    }
});
//# sourceMappingURL=expenseController.js.map