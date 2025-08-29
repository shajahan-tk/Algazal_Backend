"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkCompletion = void 0;
// models/workCompletionModel.ts
const mongoose_1 = require("mongoose");
const workCompletionImageSchema = new mongoose_1.Schema({
    title: { type: String, required: true },
    imageUrl: { type: String, required: true },
    s3Key: { type: String, required: true },
    description: { type: String },
    uploadedAt: { type: Date, default: Date.now },
});
const workCompletionSchema = new mongoose_1.Schema({
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    images: [workCompletionImageSchema],
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });
// Indexes for faster queries
workCompletionSchema.index({ project: 1 });
workCompletionSchema.index({ createdBy: 1 });
exports.WorkCompletion = (0, mongoose_1.model)("WorkCompletion", workCompletionSchema);
//# sourceMappingURL=workCompletionModel.js.map