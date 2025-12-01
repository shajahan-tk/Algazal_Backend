// controllers/budgetController.ts

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

    // --- APPLICATION-LEVEL VALIDATION FOR DUPLICATES ---
    // This ensures that a single project cannot have duplicate month-year entries in a single request.
    const seenMonthYears = new Set<string>();
    for (const budget of monthlyBudgets) {
        const key = `${budget.month}-${budget.year}`;
        if (seenMonthYears.has(key)) {
            throw new ApiError(400, `Duplicate month-year combination found in request: Month ${budget.month}, Year ${budget.year}`);
        }
        seenMonthYears.add(key);
    }

    const budgetDoc: any = await Budget.findOne({ project: projectId });
    const quotation = await Quotation.findOne({ project: projectId });
    if (!budgetDoc) {
        throw new ApiError(404, "Budget not found for this project");
    }

    // Validate that total allocation doesn't exceed quotation amount
    const totalAllocation = monthlyBudgets.reduce((sum: number, month: IMonthlyBudget) => sum + month.allocatedAmount, 0);
    if (totalAllocation > quotation?.netAmount!) {
        throw new ApiError(400, `Total allocation (${totalAllocation}) exceeds the quotation amount (${quotation?.netAmount})`);
    }

    // Process each monthly budget from the request
    const updatedMonthlyBudgets: IMonthlyBudget[] = [];

    for (const newMonthBudget of monthlyBudgets) {
        // Validate month and year
        if (newMonthBudget.month < 1 || newMonthBudget.month > 12) {
            throw new ApiError(400, `Invalid month: ${newMonthBudget.month}. Must be between 1 and 12.`);
        }

        if (newMonthBudget.year < 2000 || newMonthBudget.year > 2100) {
            throw new ApiError(400, `Invalid year: ${newMonthBudget.year}. Must be between 2000 and 2100.`);
        }

        // Add the validated month budget to our new array
        updatedMonthlyBudgets.push({
            month: newMonthBudget.month,
            year: newMonthBudget.year,
            allocatedAmount: newMonthBudget.allocatedAmount,
        });
    }

    // --- CORE FIX ---
    // Replace the entire monthlyBudgets array with the new one from the request.
    // This ensures that any months removed in the UI are also removed from the database.
    budgetDoc.monthlyBudgets = updatedMonthlyBudgets;
    await budgetDoc.save();

    return res
        .status(200)
        .json(new ApiResponse(200, budgetDoc, "Monthly budgets updated successfully"));
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