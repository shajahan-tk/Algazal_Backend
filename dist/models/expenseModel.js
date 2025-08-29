"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Expense = void 0;
const mongoose_1 = require("mongoose");
const expenseSchema = new mongoose_1.Schema({
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    materials: [
        {
            description: { type: String, required: true },
            date: { type: Date, required: true, default: Date.now },
            invoiceNo: { type: String, required: true },
            amount: { type: Number, required: true, min: 0 },
            supplierName: { type: String, required: false },
            supplierMobile: { type: String, required: false },
            supplierEmail: { type: String, required: false },
            documentUrl: { type: String, required: false },
            documentKey: { type: String, required: false },
        },
    ],
    totalMaterialCost: { type: Number, default: 0 },
    miscellaneous: [
        {
            description: { type: String, required: true },
            quantity: { type: Number, required: true, min: 0 },
            unitPrice: { type: Number, required: true, min: 0 },
            total: { type: Number, required: true, min: 0 },
        },
    ],
    totalMiscellaneousCost: { type: Number, default: 0 },
    laborDetails: {
        workers: [
            {
                user: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
                daysPresent: { type: Number, required: true, min: 0 },
                dailySalary: { type: Number, required: true, min: 0 },
                totalSalary: { type: Number, required: true, min: 0 },
            },
        ],
        driver: {
            user: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
            daysPresent: { type: Number, required: true, min: 0 },
            dailySalary: { type: Number, required: true, min: 0 },
            totalSalary: { type: Number, required: true, min: 0 },
        },
        totalLaborCost: { type: Number, default: 0 },
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });
expenseSchema.pre("save", function (next) {
    this.totalMaterialCost = this.materials.reduce((sum, material) => sum + material.amount, 0);
    this.totalMiscellaneousCost = this.miscellaneous.reduce((sum, misc) => sum + misc.total, 0);
    const workersTotal = this.laborDetails.workers.reduce((sum, worker) => sum + worker.totalSalary, 0);
    const driverTotal = this.laborDetails.driver.totalSalary;
    this.laborDetails.totalLaborCost = workersTotal + driverTotal;
    next();
});
exports.Expense = (0, mongoose_1.model)("Expense", expenseSchema);
//# sourceMappingURL=expenseModel.js.map