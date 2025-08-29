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
    projectName: { type: String, required: true },
    poNumber: { type: String, required: true },
    startDate: { type: Date, required: true },
    budget: { type: Number, required: true, min: 0 },
    expenses: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, default: 0 },
    description: { type: String },
    attachments: [attachmentSchema],
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
projectProfitSchema.pre("save", function (next) {
    this.profit = this.budget - this.expenses;
    next();
});
projectProfitSchema.index({ projectName: 1 });
projectProfitSchema.index({ poNumber: 1 });
projectProfitSchema.index({ startDate: 1 });
projectProfitSchema.index({ profit: 1 });
projectProfitSchema.index({ createdBy: 1 });
exports.ProjectProfit = (0, mongoose_1.model)("ProjectProfit", projectProfitSchema);
//# sourceMappingURL=projectProfitModel.js.map