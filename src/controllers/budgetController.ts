import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Budget, IMonthlyBudget } from "../models/budgetModel";
import { Project } from "../models/projectModel";
import { Quotation } from "../models/quotationModel";
import { Types } from "mongoose";

// Create a budget for a project
export const createBudget = asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    // Check if project exists
    const project = await Project.findById(projectId);
    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    // Check if quotation exists for this project
    const quotation = await Quotation.findOne({ project: projectId });
    if (!quotation) {
        throw new ApiError(404, "Quotation not found for this project");
    }

    // Check if budget already exists
    const existingBudget = await Budget.findOne({ project: projectId });
    if (existingBudget) {
        throw new ApiError(400, "Budget already exists for this project");
    }

    // Create budget with no monthly allocations initially
    const budget = await Budget.create({
        project: projectId,
        quotation: quotation._id,
        totalQuotationAmount: quotation.netAmount,
        monthlyBudgets: [],
        createdBy: new Types.ObjectId(userId),
    });

    return res
        .status(201)
        .json(new ApiResponse(201, budget, "Budget created successfully"));
});

// Get budget for a project
export const getProjectBudget = asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const budget = await Budget.findOne({ project: projectId })
        .populate("project", "projectName projectNumber")
        .populate("quotation", "netAmount")
        .populate("createdBy", "firstName lastName");

    if (!budget) {
        throw new ApiError(404, "Budget not found for this project");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, budget, "Budget fetched successfully"));
});

// Add or update monthly budget allocations
export const updateMonthlyBudgets = asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { monthlyBudgets } = req.body;

    if (!monthlyBudgets || !Array.isArray(monthlyBudgets)) {
        throw new ApiError(400, "Valid monthly budgets array is required");
    }

    const budget: any = await Budget.findOne({ project: projectId });
    const quotation = await Quotation.findOne({ project: projectId });
    if (!budget) {
        throw new ApiError(404, "Budget not found for this project");
    }

    // Validate that total allocation doesn't exceed quotation amount
    const totalAllocation = monthlyBudgets.reduce((sum: number, month: IMonthlyBudget) => sum + month.allocatedAmount, 0);
    if (totalAllocation > quotation?.netAmount!) {
        throw new ApiError(400, `Total allocation (${totalAllocation}) exceeds the quotation amount (${quotation?.netAmount})`);
    }

    // Process each monthly budget
    const updatedMonthlyBudgets: IMonthlyBudget[] = [];

    for (const newMonthBudget of monthlyBudgets) {
        // Validate month and year
        if (newMonthBudget.month < 1 || newMonthBudget.month > 12) {
            throw new ApiError(400, `Invalid month: ${newMonthBudget.month}. Must be between 1 and 12.`);
        }

        if (newMonthBudget.year < 2000 || newMonthBudget.year > 2100) {
            throw new ApiError(400, `Invalid year: ${newMonthBudget.year}. Must be between 2000 and 2100.`);
        }

        // Check if this month-year already exists in the budget
        const existingMonthIndex = budget.monthlyBudgets.findIndex(
            (month: any) => month.month === newMonthBudget.month && month.year === newMonthBudget.year
        );

        if (existingMonthIndex >= 0) {
            // Update existing month budget
            updatedMonthlyBudgets.push({
                month: newMonthBudget.month,
                year: newMonthBudget.year,
                allocatedAmount: newMonthBudget.allocatedAmount,
            });
        } else {
            // Add new month budget
            updatedMonthlyBudgets.push({
                month: newMonthBudget.month,
                year: newMonthBudget.year,
                allocatedAmount: newMonthBudget.allocatedAmount,
            });
        }
    }

    // Keep any existing month budgets that weren't in the update
    for (const existingMonth of budget.monthlyBudgets) {
        const isInUpdate = monthlyBudgets.some(
            month => month.month === existingMonth.month && month.year === existingMonth.year
        );

        if (!isInUpdate) {
            updatedMonthlyBudgets.push(existingMonth.toObject());
        }
    }

    // Update budget with new monthly budgets
    budget.monthlyBudgets = updatedMonthlyBudgets;
    await budget.save();

    return res
        .status(200)
        .json(new ApiResponse(200, budget, "Monthly budgets updated successfully"));
});

// Delete a monthly budget allocation
export const deleteMonthlyBudget = asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { month, year } = req.body;

    if (!month || !year) {
        throw new ApiError(400, "Month and year are required");
    }

    const budget = await Budget.findOne({ project: projectId });
    if (!budget) {
        throw new ApiError(404, "Budget not found for this project");
    }

    // Find and remove the monthly budget
    const monthIndex = budget.monthlyBudgets.findIndex(
        m => m.month === month && m.year === year
    );

    if (monthIndex === -1) {
        throw new ApiError(404, "Monthly budget not found");
    }

    // Remove the monthly budget
    budget.monthlyBudgets.splice(monthIndex, 1);
    await budget.save();

    return res
        .status(200)
        .json(new ApiResponse(200, budget, "Monthly budget deleted successfully"));
});