"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectProfit = void 0;
const mongoose_1 = require("mongoose");
const attachmentSchema = new mongoose_1.Schema({
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    filePath: { type: String, required: true },
});
const projectProfitSchema = new mongoose_1.Schema({
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },
    // Denormalized fields (stored for historical accuracy)
    projectName: { type: String, required: true },
    projectNumber: { type: String, required: true },
    clientName: { type: String, required: true },
    location: { type: String, required: true },
    building: { type: String, required: true },
    apartmentNumber: { type: String, required: true },
    // LPO details - only store reference ID
    lpoId: { type: mongoose_1.Schema.Types.ObjectId, ref: "LPO" },
    // Report period
    reportMonth: { type: Date, required: true },
    reportPeriodStart: { type: Date, required: true },
    reportPeriodEnd: { type: Date, required: true },
    // Financial data
    budget: { type: Number, required: true, min: 0 },
    expenses: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, default: 0 },
    description: { type: String },
    attachments: [attachmentSchema],
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
// Auto-calculate profit before saving
projectProfitSchema.pre("save", function (next) {
    this.profit = this.budget - this.expenses;
    next();
});
// Indexes
projectProfitSchema.index({ project: 1, reportMonth: 1 });
projectProfitSchema.index({ projectName: 1 });
projectProfitSchema.index({ reportMonth: 1 });
projectProfitSchema.index({ profit: 1 });
projectProfitSchema.index({ createdBy: 1 });
projectProfitSchema.index({ lpoId: 1 }); // Index for LPO reference
exports.ProjectProfit = (0, mongoose_1.model)("ProjectProfit", projectProfitSchema);
//# sourceMappingURL=projectProfitModel.js.map