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

// Compound index to ensure uniqueness of month-year combination for a budget
monthlyBudgetSchema.index({ month: 1, year: 1 }, { unique: true });

const budgetSchema = new Schema<IBudget>(
    {
        project: {
            type: Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            unique: true,
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

// Pre-save hook to calculate total allocated
budgetSchema.pre<IBudget>("save", function (next) {
    // Calculate total allocated from monthly budgets
    this.totalAllocated = this.monthlyBudgets.reduce(
        (sum, month) => sum + month.allocatedAmount,
        0
    );

    next();
});

export const Budget = model<IBudget>("Budget", budgetSchema);