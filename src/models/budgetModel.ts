// models/budgetModel.ts

import { Document, Schema, model, Types } from "mongoose";
import { IProject } from "./projectModel";
import { IQuotation } from "./quotationModel";

export interface IMonthlyBudget {
    month: number; // 1-12
    year: number;
    allocatedAmount: number;
}

export interface IBudget extends Document {
    project: Types.ObjectId | IProject;
    quotation: Types.ObjectId | IQuotation;
    totalQuotationAmount: number; // From quotation
    monthlyBudgets: IMonthlyBudget[];
    totalAllocated: number; // Sum of all monthly allocations
    createdBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

const monthlyBudgetSchema = new Schema<IMonthlyBudget>({
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    allocatedAmount: { type: Number, required: true, min: 0 },
});

// IMPORTANT: The unique index on the sub-document schema has been REMOVED.
// It was causing a global uniqueness constraint, meaning no two projects
// could have a budget for the same month/year (e.g., Nov 2025).
// Uniqueness for a single project's budget is now handled in the controller.
// monthlyBudgetSchema.index({ month: 1, year: 1 }, { unique: true }); // <-- THIS LINE WAS REMOVED

const budgetSchema = new Schema<IBudget>(
    {
        project: {
            type: Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            unique: true, // This is correct: one budget per project
        },
        quotation: {
            type: Schema.Types.ObjectId,
            ref: "Quotation",
            required: true,
        },
        totalQuotationAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        monthlyBudgets: [monthlyBudgetSchema],
        totalAllocated: {
            type: Number,
            default: 0,
            min: 0,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    { timestamps: true }
);

// Pre-save hook to calculate total allocated amount automatically
budgetSchema.pre<IBudget>("save", function (next) {
    this.totalAllocated = this.monthlyBudgets.reduce(
        (sum, month) => sum + month.allocatedAmount,
        0
    );
    next();
});

export const Budget = model<IBudget>("Budget", budgetSchema);