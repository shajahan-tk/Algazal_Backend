import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { EmployeeExpense } from "../models/employeeExpenseModel";
import { IUser, User } from "../models/userModel";
import ExcelJS from "exceljs";
import { Types } from "mongoose";

export const createEmployeeExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      employee,
      designation,
      country,
      basicSalary,
      allowance,
      twoYearSalary,
      perYearExpenses,
      perMonthExpenses,
      perDayExpenses,
      totalExpensesPerPerson,
      visaExpenses,
      twoYearUniform,
      shoes,
      twoYearAccommodation,
      sewaBills,
      dewaBills,
      insurance,
      transport,
      water,
      thirdPartyLiabilities,
      fairmontCertificate,
      leaveSalary,
      ticket,
      gratuity,
      customExpenses
    } = req.body;

    // Validate required fields
    if (!employee || !designation || !country || basicSalary === undefined) {
      throw new ApiError(400, "Required fields are missing");
    }

    // Check if employee exists
    const employeeExists = await User.findById(employee);
    if (!employeeExists) {
      throw new ApiError(404, "Employee not found");
    }

    // Calculate total salary if not provided
    const totalSalary = basicSalary + (allowance || 0);

    const expenseRecord = await EmployeeExpense.create({
      employee,
      designation,
      country,
      basicSalary,
      allowance: allowance || 0,
      totalSalary,
      twoYearSalary,
      perYearExpenses,
      perMonthExpenses,
      perDayExpenses,
      totalExpensesPerPerson,
      visaExpenses,
      twoYearUniform,
      shoes,
      twoYearAccommodation,
      sewaBills,
      dewaBills,
      insurance,
      transport,
      water,
      thirdPartyLiabilities,
      fairmontCertificate,
      leaveSalary,
      ticket,
      gratuity,
      customExpenses: customExpenses || [],
      createdBy: req.user?.userId
    });

    res.status(201).json(
      new ApiResponse(201, expenseRecord, "Employee expense record created successfully")
    );
  }
);

export const getEmployeeExpenses = asyncHandler(
  async (req: Request, res: Response) => {
    const { 
      employee, 
      designation, 
      country, 
      minSalary, 
      maxSalary,
      startDate,
      endDate,
      month,
      year,
      page = 1, 
      limit = 10 
    } = req.query;

    const filter: any = {};
    
    // Basic filters
    if (employee) filter.employee = employee;
    if (designation) filter.designation = { $regex: designation as string, $options: "i" };
    if (country) filter.country = { $regex: country as string, $options: "i" };
    
    // Salary range filter
    if (minSalary || maxSalary) {
      filter.totalSalary = {};
      if (minSalary) filter.totalSalary.$gte = Number(minSalary);
      if (maxSalary) filter.totalSalary.$lte = Number(maxSalary);
    }

    // Date range filter (takes precedence over year/month)
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    } else {
      // Year filter
      if (year) {
        const yearNum = parseInt(year as string);
        if (isNaN(yearNum)) {
          throw new ApiError(400, "Invalid year value");
        }
        filter.createdAt = {
          $gte: new Date(yearNum, 0, 1),
          $lte: new Date(yearNum + 1, 0, 1),
        };
      }

      // Month filter (works with year filter)
      if (month) {
        const monthNum = parseInt(month as string);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          throw new ApiError(400, "Invalid month value (1-12)");
        }

        if (!filter.createdAt) {
          // If no year specified, use current year
          const currentYear = new Date().getFullYear();
          filter.createdAt = {
            $gte: new Date(currentYear, monthNum - 1, 1),
            $lt: new Date(currentYear, monthNum, 1),
          };
        } else {
          // Adjust existing year filter to specific month
          const startDate = new Date(filter.createdAt.$gte);
          startDate.setMonth(monthNum - 1);
          startDate.setDate(1);

          const endDate = new Date(startDate);
          endDate.setMonth(monthNum);

          filter.createdAt.$gte = startDate;
          filter.createdAt.$lte = endDate;
        }
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await EmployeeExpense.countDocuments(filter);

    const expenses = await EmployeeExpense.find(filter)
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .populate("employee", "firstName lastName email")
      .populate("createdBy", "firstName lastName");

    res.status(200).json(
      new ApiResponse(
        200,
        {
          expenses,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
            hasNextPage: Number(page) * Number(limit) < total,
            hasPreviousPage: Number(page) > 1,
          },
        },
        "Employee expenses retrieved successfully"
      )
    );
  }
);

export const getEmployeeExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const expense = await EmployeeExpense.findById(id)
      .populate("employee", "firstName lastName email designation salary")
      .populate("createdBy", "firstName lastName");

    if (!expense) {
      throw new ApiError(404, "Employee expense record not found");
    }

    res.status(200).json(
      new ApiResponse(200, expense, "Employee expense retrieved successfully")
    );
  }
);

export const updateEmployeeExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    const expense = await EmployeeExpense.findById(id);
    if (!expense) {
      throw new ApiError(404, "Employee expense record not found");
    }

    // Recalculate total salary if basicSalary or allowance is updated
    if (updateData.basicSalary || updateData.allowance) {
      updateData.totalSalary = 
        (updateData.basicSalary || expense.basicSalary) + 
        (updateData.allowance || expense.allowance);
    }

    const updatedExpense = await EmployeeExpense.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    )
      .populate("employee", "firstName lastName email")
      .populate("createdBy", "firstName lastName");

    res.status(200).json(
      new ApiResponse(200, updatedExpense, "Employee expense updated successfully")
    );
  }
);

export const deleteEmployeeExpense = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const expense = await EmployeeExpense.findByIdAndDelete(id);
    if (!expense) {
      throw new ApiError(404, "Employee expense record not found");
    }

    res.status(200).json(
      new ApiResponse(200, null, "Employee expense deleted successfully")
    );
  }
);

export const exportEmployeeExpensesToExcel = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      // Fetch all expenses with populated employee data
      const expenses = await EmployeeExpense.find({})
        .sort({ createdAt: -1 })
        .populate<{ employee: IUser }>("employee", "firstName lastName")
        .lean();

      if (expenses.length === 0) {
        throw new ApiError(404, "No employee expenses found");
      }

      // Create workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Employee Expenses");

      // Define all columns except excluded fields
      worksheet.columns = [
        { header: "SNO", key: "sno", width: 5 },
        { header: "Employee", key: "employee", width: 25 },
        { header: "Designation", key: "designation", width: 20 },
        { header: "Country", key: "country", width: 15 },
        { header: "Basic Salary", key: "basicSalary", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Allowance", key: "allowance", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Total Salary", key: "totalSalary", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "2 Year Salary", key: "twoYearSalary", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Per Year Expenses", key: "perYearExpenses", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Per Month Expenses", key: "perMonthExpenses", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Per Day Expenses", key: "perDayExpenses", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Total Expenses", key: "totalExpensesPerPerson", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Visa Expenses", key: "visaExpenses", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "2 Year Uniform", key: "twoYearUniform", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Shoes", key: "shoes", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "2 Year Accommodation", key: "twoYearAccommodation", width: 20, style: { numFmt: "#,##0.00" }},
        { header: "SEWA Bills", key: "sewaBills", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "DEWA Bills", key: "dewaBills", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Insurance", key: "insurance", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Transport", key: "transport", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Water", key: "water", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "3rd Party Liabilities", key: "thirdPartyLiabilities", width: 20, style: { numFmt: "#,##0.00" }},
        { header: "Fairmont Certificate", key: "fairmontCertificate", width: 20, style: { numFmt: "#,##0.00" }},
        { header: "Leave Salary", key: "leaveSalary", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Ticket", key: "ticket", width: 15, style: { numFmt: "#,##0.00" }},
        { header: "Gratuity", key: "gratuity", width: 15, style: { numFmt: "#,##0.00" }},
        { 
          header: "Custom Expenses", 
          key: "customExpenses", 
          width: 30,
          style: { alignment: { wrapText: true } } // Allow text wrapping
        }
      ];

      // Add data rows
      expenses.forEach((expense, index) => {
        const rowData = {
          sno: index + 1,
          employee: expense.employee 
            ? `${expense.employee.firstName} ${expense.employee.lastName}`
            : 'N/A',
          designation: expense.designation,
          country: expense.country,
          basicSalary: expense.basicSalary,
          allowance: expense.allowance,
          totalSalary: expense.totalSalary,
          twoYearSalary: expense.twoYearSalary,
          perYearExpenses: expense.perYearExpenses,
          perMonthExpenses: expense.perMonthExpenses,
          perDayExpenses: expense.perDayExpenses,
          totalExpensesPerPerson: expense.totalExpensesPerPerson,
          visaExpenses: expense.visaExpenses,
          twoYearUniform: expense.twoYearUniform,
          shoes: expense.shoes,
          twoYearAccommodation: expense.twoYearAccommodation,
          sewaBills: expense.sewaBills,
          dewaBills: expense.dewaBills,
          insurance: expense.insurance,
          transport: expense.transport,
          water: expense.water,
          thirdPartyLiabilities: expense.thirdPartyLiabilities,
          fairmontCertificate: expense.fairmontCertificate,
          leaveSalary: expense.leaveSalary,
          ticket: expense.ticket,
          gratuity: expense.gratuity,
          customExpenses: expense.customExpenses
            ? expense.customExpenses.map(ce => `${ce.name}: ${ce.amount}`).join('\n')
            : 'None'
        };

        worksheet.addRow(rowData);
      });

      // Style header row
      worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD3D3D3" },
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });

      // Auto-size columns for better visibility
      worksheet.columns.forEach(column => {
        if (column.width) {
          const headerLength = column.header ? column.header.length : 0;
          column.width = Math.max(column.width, headerLength + 2);
        }
      });

      // Set response headers
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=employee_expenses_${new Date().toISOString().split("T")[0]}.xlsx`
      );

      // Write to response
      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      console.error("Error exporting employee expenses:", error);
      throw new ApiError(500, "Failed to generate Excel export");
    }
  }
);