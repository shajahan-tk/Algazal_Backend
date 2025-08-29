"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeExpense = void 0;
const mongoose_1 = require("mongoose");
const customExpenseSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 }
});
const employeeExpenseSchema = new mongoose_1.Schema({
    employee: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    designation: { type: String, required: true },
    country: { type: String, required: true },
    basicSalary: { type: Number, required: true, min: 0 },
    allowance: { type: Number, required: true, min: 0 },
    totalSalary: { type: Number, required: true, min: 0 },
    twoYearSalary: { type: Number, required: true, min: 0 },
    perYearExpenses: { type: Number, required: true, min: 0 },
    perMonthExpenses: { type: Number, required: true, min: 0 },
    perDayExpenses: { type: Number, required: true, min: 0 },
    totalExpensesPerPerson: { type: Number, required: true, min: 0 },
    visaExpenses: { type: Number, required: true, min: 0 },
    twoYearUniform: { type: Number, required: true, min: 0 },
    shoes: { type: Number, required: true, min: 0 },
    twoYearAccommodation: { type: Number, required: true, min: 0 },
    sewaBills: { type: Number, required: true, min: 0 },
    dewaBills: { type: Number, required: true, min: 0 },
    insurance: { type: Number, required: true, min: 0 },
    transport: { type: Number, required: true, min: 0 },
    water: { type: Number, required: true, min: 0 },
    thirdPartyLiabilities: { type: Number, required: true, min: 0 },
    fairmontCertificate: { type: Number, required: true, min: 0 },
    leaveSalary: { type: Number, required: true, min: 0 },
    ticket: { type: Number, required: true, min: 0 },
    gratuity: { type: Number, required: true, min: 0 },
    customExpenses: [customExpenseSchema],
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
}, { timestamps: true });
// Indexes for better query performance
employeeExpenseSchema.index({ employee: 1 });
employeeExpenseSchema.index({ designation: 1 });
employeeExpenseSchema.index({ country: 1 });
employeeExpenseSchema.index({ createdAt: -1 });
// Middleware to calculate derived fields before saving
employeeExpenseSchema.pre("save", function (next) {
    // Calculate total salary if not provided
    if (this.isModified("basicSalary") || this.isModified("allowance")) {
        this.totalSalary = this.basicSalary + this.allowance;
    }
    // You can add more automatic calculations here if needed
    next();
});
exports.EmployeeExpense = (0, mongoose_1.model)("EmployeeExpense", employeeExpenseSchema);
//# sourceMappingURL=employeeExpenseModel.js.map