import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import {
  Expense,
  IDriverLabor,
  IMaterialItem,
  IMiscellaneousExpense,
  IWorkerLabor,
} from "../models/expenseModel";
import { IProject, Project } from "../models/projectModel";
import { Attendance } from "../models/attendanceModel";
import { Types } from "mongoose";
import { deleteFileFromS3, uploadExpenseDocument } from "../utils/uploadConf";
import { Quotation } from "../models/quotationModel";
import { Estimation } from "../models/estimationModel";
import puppeteer from "puppeteer";
import { IUser } from "../models/userModel";

interface PopulatedUser {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  profileImage?: string;
  salary?: number;
}

interface MaterialInput {
  description: string;
  date?: Date;
  invoiceNo: string;
  amount: number;
  supplierName?: string;
  supplierMobile?: string;
  supplierEmail?: string;
  documentUrl?: string;
  documentKey?: string;
}

interface MiscellaneousInput {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface WorkerLabor {
  user: Types.ObjectId;
  firstName: string;
  lastName: string;
  profileImage?: string;
  daysPresent: number;
  dailySalary: number;
  totalSalary: number;
}

interface DriverLabor {
  user: Types.ObjectId;
  firstName: string;
  lastName: string;
  profileImage?: string;
  daysPresent: number;
  dailySalary: number;
  totalSalary: number;
}

const calculateLaborDetails = async (projectId: string) => {
  const project = await Project.findById(projectId)
    .populate<{ assignedWorkers: PopulatedUser[] }>(
      "assignedWorkers",
      "firstName lastName profileImage salary"
    )
    .populate<{ assignedDriver: PopulatedUser }>(
      "assignedDriver",
      "firstName lastName profileImage salary"
    );

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  const workersToProcess = project.assignedWorkers || [];
  const workerIds = workersToProcess.map((worker) => worker._id);

  const workerAttendanceRecords = await Attendance.find({
    project: projectId,
    present: true,
    user: { $in: workerIds },
  }).populate<{ user: PopulatedUser }>("user", "firstName lastName");

  const workerDaysMap = new Map<string, number>();
  workerAttendanceRecords.forEach((record) => {
    const userIdStr = record.user._id.toString();
    workerDaysMap.set(userIdStr, (workerDaysMap.get(userIdStr) || 0) + 1);
  });

  const projectAttendanceDates = await Attendance.aggregate([
    {
      $match: {
        project: new Types.ObjectId(projectId),
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
    totalSalary:
      (workerDaysMap.get(worker._id.toString()) || 0) * (worker.salary || 0),
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
        user: new Types.ObjectId(),
        firstName: "No",
        lastName: "Driver",
        daysPresent: 0,
        dailySalary: 0,
        totalSalary: 0,
      };

  const totalLaborCost =
    workers.reduce((sum, worker) => sum + worker.totalSalary, 0) +
    driver.totalSalary;

  return {
    workers,
    driver,
    totalLaborCost,
  };
};

export const getProjectLaborData = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      const laborData = await calculateLaborDetails(projectId);
      res
        .status(200)
        .json(
          new ApiResponse(200, laborData, "Labor data fetched successfully")
        );
    } catch (error) {
      throw new ApiError(500, "Failed to fetch labor data");
    }
  }
);

async function processMaterialsWithFiles(
  materials: MaterialInput[],
  files: Express.Multer.File[],
  prefix: string,
  existingMaterials: IMaterialItem[] = []
) {
  const fileMap = new Map<number, Express.Multer.File>();
  files.forEach((file) => {
    const indexMatch = file.originalname.match(new RegExp(`${prefix}(\\d+)`));
    if (indexMatch) {
      fileMap.set(parseInt(indexMatch[1], 10), file);
    }
  });

  return await Promise.all(
    materials.map(async (material, index) => {
      const processedMaterial: any = { ...material };

      // If a new file is uploaded for this material index
      if (fileMap.has(index)) {
        try {
          // Delete old file if it exists
          if (existingMaterials[index]?.documentKey) {
            await deleteFileFromS3(existingMaterials[index].documentKey!);
          }

          // Upload new file
          const uploadResult = await uploadExpenseDocument(fileMap.get(index)!);
          if (uploadResult.success) {
            processedMaterial.documentUrl = uploadResult.uploadData?.url;
            processedMaterial.documentKey = uploadResult.uploadData?.key;
          }
        } catch (uploadError) {
          console.error(
            `File upload error for material ${index}:`,
            uploadError
          );
          throw new ApiError(500, `Failed to upload document for material ${index + 1}`);
        }
      } else if (existingMaterials[index]?.documentKey) {
        // Preserve existing file if no new file is uploaded
        processedMaterial.documentUrl = existingMaterials[index].documentUrl;
        processedMaterial.documentKey = existingMaterials[index].documentKey;
      }

      return processedMaterial;
    })
  );
}

export const createExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      throw new ApiError(401, "Unauthorized");
    }

    if (!req.body.materials || !req.body.miscellaneous) {
      throw new ApiError(400, "Materials and miscellaneous data are required");
    }

    let materials: MaterialInput[];
    let miscellaneous: MiscellaneousInput[];
    try {
      materials =
        typeof req.body.materials === "string"
          ? JSON.parse(req.body.materials)
          : req.body.materials;
      miscellaneous =
        typeof req.body.miscellaneous === "string"
          ? JSON.parse(req.body.miscellaneous)
          : req.body.miscellaneous;
    } catch (err) {
      throw new ApiError(
        400,
        "Invalid JSON format for materials or miscellaneous"
      );
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    const materialFiles = files?.materialFiles ? [...files.materialFiles] : [];

    try {
      const laborDetails = await calculateLaborDetails(projectId);

      const processedMaterials = await processMaterialsWithFiles(
        materials,
        materialFiles,
        "material-"
      );

      const expense = await Expense.create({
        project: projectId,
        materials: processedMaterials,
        miscellaneous,
        laborDetails,
        createdBy: new Types.ObjectId(userId),
      });

      return res
        .status(201)
        .json(new ApiResponse(201, expense, "Expense created successfully"));
    } catch (error: any) {
      console.error("Expense creation error:", error);
      const status = error instanceof ApiError ? error.statusCode : 500;
      const message =
        error instanceof Error ? error.message : "Failed to create expense";
      throw new ApiError(status, message);
    }
  }
);

export const getProjectExpenses = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const total = await Expense.countDocuments({ project: projectId });

    const expenses = await Expense.find({ project: projectId })
      .populate(
        "laborDetails.workers.user",
        "firstName lastName profileImage salary"
      )
      .populate(
        "laborDetails.driver.user",
        "firstName lastName profileImage salary"
      )
      .populate("createdBy", "firstName lastName")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const expensesWithDownloadUrls = expenses.map((expense) => ({
      ...expense.toObject(),
      materials: expense.materials.map((material) => ({
        ...material,
        documentDownloadUrl: material.documentKey
          ? `${req.protocol}://${req.get("host")}/api/expenses/document/${
              material.documentKey
            }`
          : null,
      })),
    }));

    res.status(200).json(
      new ApiResponse(
        200,
        {
          expenses: expensesWithDownloadUrls,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
        "Expenses fetched successfully"
      )
    );
  }
);

export const getExpenseById = asyncHandler(
  async (req: Request, res: Response) => {
    const { expenseId } = req.params;

    const expense = await Expense.findById(expenseId)
      .populate(
        "laborDetails.workers.user",
        "firstName lastName profileImage salary"
      )
      .populate(
        "laborDetails.driver.user",
        "firstName lastName profileImage salary"
      )
      .populate("createdBy", "firstName lastName")
      .populate("project", "projectName projectNumber");

    if (!expense) {
      throw new ApiError(404, "Expense not found");
    }

    const estimation = await Estimation.findOne({ project: expense.project });

    const expenseWithDownloadUrls = {
      ...expense.toObject(),
      materials: expense.materials.map((material) => ({
        ...material,
        documentDownloadUrl: material.documentKey
          ? `${req.protocol}://${req.get("host")}/api/expenses/document/${
              material.documentKey
            }`
          : null,
      })),
      quotation: await Quotation.findOne({ project: expense.project }).select(
        "netAmount"
      ),
      commissionAmount: estimation?.commissionAmount || 0,
    };

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          expenseWithDownloadUrls,
          "Expense fetched successfully"
        )
      );
  }
);

export const updateExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { expenseId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      throw new ApiError(401, "Unauthorized");
    }

    if (!req.body.materials || !req.body.miscellaneous) {
      throw new ApiError(400, "Materials and miscellaneous data are required");
    }

    let materials: MaterialInput[];
    let miscellaneous: MiscellaneousInput[];
    try {
      materials =
        typeof req.body.materials === "string"
          ? JSON.parse(req.body.materials)
          : req.body.materials;
      miscellaneous =
        typeof req.body.miscellaneous === "string"
          ? JSON.parse(req.body.miscellaneous)
          : req.body.miscellaneous;
    } catch (err) {
      throw new ApiError(
        400,
        "Invalid JSON format for materials or miscellaneous"
      );
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    const materialFiles = files?.files ? [...files.files] : [];

    const existingExpense = await Expense.findById(expenseId);
    if (!existingExpense) {
      throw new ApiError(404, "Expense not found");
    }

    try {
      const laborDetails = await calculateLaborDetails(
        existingExpense.project.toString()
      );

      // Process materials with files
      const processedMaterials = await processMaterialsWithFiles(
        materials,
        materialFiles,
        "material-",
        existingExpense.materials // Pass existing materials to handle file preservation
      );

      const updatedExpense = await Expense.findByIdAndUpdate(
        expenseId,
        {
          materials: processedMaterials,
          miscellaneous,
          laborDetails,
          updatedAt: new Date(),
        },
        { new: true }
      )
        .populate(
          "laborDetails.workers.user",
          "firstName lastName profileImage salary"
        )
        .populate(
          "laborDetails.driver.user",
          "firstName lastName profileImage salary"
        )
        .populate("createdBy", "firstName lastName")
        .populate("project", "projectName projectNumber");

      return res
        .status(200)
        .json(new ApiResponse(200, updatedExpense, "Expense updated successfully"));
    } catch (error: any) {
      console.error("Expense update error:", error);
      const status = error instanceof ApiError ? error.statusCode : 500;
      const message =
        error instanceof Error ? error.message : "Failed to update expense";
      throw new ApiError(status, message);
    }
  }
);

export const deleteExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { expenseId } = req.params;

    const expense = await Expense.findById(expenseId);
    if (!expense) {
      throw new ApiError(404, "Expense not found");
    }

    await Promise.all([
      ...expense.materials.map(async (material) => {
        if (material.documentKey) {
          await deleteFileFromS3(material.documentKey);
        }
      }),
    ]);

    await Expense.findByIdAndDelete(expenseId);

    res
      .status(200)
      .json(new ApiResponse(200, null, "Expense deleted successfully"));
  }
);

export const getExpenseSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const expenses = await Expense.find({ project: projectId });
    const estimation = await Estimation.findOne({ project: projectId });

    const summary = {
      totalMaterialCost: expenses.reduce(
        (sum, e) => sum + e.totalMaterialCost,
        0
      ),
      totalMiscellaneousCost: expenses.reduce(
        (sum, e) => sum + (e.totalMiscellaneousCost || 0),
        0
      ),
      totalLaborCost: expenses.reduce(
        (sum, e) => sum + e.laborDetails.totalLaborCost,
        0
      ),
      workersCost: expenses.reduce(
        (sum, e) =>
          sum +
          e.laborDetails.workers.reduce((wSum, w) => wSum + w.totalSalary, 0),
        0
      ),
      driverCost: expenses.reduce(
        (sum, e) => sum + e.laborDetails.driver.totalSalary,
        0
      ),
      commissionAmount: estimation?.commissionAmount || 0,
      totalExpenses: expenses.reduce(
        (sum, e) =>
          sum +
          e.totalMaterialCost +
          (e.totalMiscellaneousCost || 0) +
          e.laborDetails.totalLaborCost,
        0
      ),
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, summary, "Expense summary fetched successfully")
      );
  }
);



export const generateExpensePdf = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    interface PopulatedExpense extends Document {
      project: {
        projectName: string;
        projectNumber: string;
      };
      materials: {
        description: string;
        date: Date;
        invoiceNo: string;
        amount: number;
        supplierName?: string;
        supplierMobile?: string;
        supplierEmail?: string;
        documentUrl?: string;
      }[];
      totalMaterialCost: number;
      miscellaneous: {
        description: string;
        quantity: number;
        unitPrice: number;
        total: number;
      }[];
      totalMiscellaneousCost: number;
      laborDetails: {
        workers: {
          user: {
            firstName: string;
            lastName: string;
          };
          daysPresent: number;
          dailySalary: number;
          totalSalary: number;
        }[];
        driver: {
          user: {
            firstName: string;
            lastName: string;
          };
          daysPresent: number;
          dailySalary: number;
          totalSalary: number;
        };
        totalLaborCost: number;
      };
      createdBy: {
        firstName: string;
        lastName: string;
      };
      createdAt?: Date;
      updatedAt?: Date;
    }

    const expense = (await Expense.findById(id)
      .populate<{ project: { projectName: string; projectNumber: string } }>(
        "project",
        "projectName projectNumber"
      )
      .populate<{ createdBy: { firstName: string; lastName: string } }>(
        "createdBy",
        "firstName lastName"
      )
      .populate("laborDetails.workers.user", "firstName lastName")
      .populate(
        "laborDetails.driver.user",
        "firstName lastName"
      )) as unknown as PopulatedExpense;

    if (!expense) {
      throw new ApiError(404, "Expense not found");
    }

    const quotation = await Quotation.findOne({ project: expense.project });
    const estimation = await Estimation.findOne({ project: expense.project });

    const formatDate = (dateString: string | Date) => {
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
    const totalExpense =
      totalMaterialCost + totalMiscellaneousCost + totalLaborCost;
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
        <div class="project-info">${expense.project.projectName} (${
      expense.project.projectNumber
    })</div>
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
              .map(
                (material, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${material.description}</td>
                <td>${formatDate(material.date)}</td>
                <td>${material.invoiceNo}</td>
                <td>${material.supplierName || "N/A"}</td>
                <td>${material.supplierMobile || "N/A"}</td>
                <td class="text-right">${material.amount.toFixed(2)}</td>
              </tr>
            `
              )
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
              .map(
                (item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${item.description}</td>
                <td>${item.quantity}</td>
                <td>${item.unitPrice.toFixed(2)}</td>
                <td class="text-right">${item.total.toFixed(2)}</td>
              </tr>
            `
              )
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
              <td class="text-right">${expense.laborDetails.driver.totalSalary.toFixed(
                2
              )}</td>
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
            ${
              quotation
                ? `
              <tr>
                <td>Project Quotation Amount</td>
                <td class="text-right">${quotationAmount.toFixed(2)}</td>
              </tr>
              ${
                commissionAmount > 0
                  ? `<tr>
                      <td>Commission Amount</td>
                      <td class="text-right">${commissionAmount.toFixed(2)}</td>
                    </tr>`
                  : ""
              }
              <tr class="total-row">
                <td>${profit >= 0 ? "PROFIT" : "LOSS"}</td>
                <td class="text-right">${profit.toFixed(
                  2
                )} (${profitPercentage.toFixed(2)}%)</td>
              </tr>
            `
                : ""
            }
          </tbody>
        </table>
      </div>

      <div class="footer">
        <p>Generated on ${formatDate(new Date())} by ${
      expense.createdBy.firstName
    } ${expense.createdBy.lastName}</p>
      </div>
    </body>
    </html>
    `;

    const browser = await puppeteer.launch({
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
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=expense-report-${expense.project.projectNumber}.pdf`
      );
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      throw new ApiError(500, "Failed to generate PDF");
    } finally {
      await browser.close();
    }
  }
);
