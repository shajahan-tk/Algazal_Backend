"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankReport = void 0;
const mongoose_1 = require("mongoose");
const bankAttachmentSchema = new mongoose_1.Schema({
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    filePath: { type: String, required: true },
});
const bankReportSchema = new mongoose_1.Schema({
    reportType: {
        type: String,
        required: true,
        enum: ["adib", "expense"],
    },
    reportDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    remarks: { type: String, trim: true },
    attachments: [bankAttachmentSchema],
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    // ADIB Report Fields
    category: { type: mongoose_1.Schema.Types.ObjectId, ref: "Category" },
    shop: { type: mongoose_1.Schema.Types.ObjectId, ref: "Shop" },
    // Expense Report Fields
    description: { type: String, trim: true },
}, { timestamps: true });
// Indexes
bankReportSchema.index({ reportType: 1 });
bankReportSchema.index({ reportDate: -1 });
bankReportSchema.index({ amount: 1 });
bankReportSchema.index({ createdBy: 1 });
bankReportSchema.index({ category: 1 });
bankReportSchema.index({ shop: 1 });
exports.BankReport = (0, mongoose_1.model)("BankReport", bankReportSchema);
//# sourceMappingURL=bankModel.js.map