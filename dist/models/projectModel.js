"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Project = void 0;
const mongoose_1 = require("mongoose");
const projectSchema = new mongoose_1.Schema({
    projectName: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, "Project name cannot exceed 100 characters"],
    },
    projectDescription: {
        type: String,
        trim: true,
        maxlength: [500, "Description cannot exceed 500 characters"],
    },
    client: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Client",
        required: true,
    },
    location: {
        type: String,
        required: true,
        trim: true,
    },
    building: {
        type: String,
        required: true,
        trim: true,
    },
    apartmentNumber: {
        type: String,
        required: true,
        trim: true,
    },
    status: {
        type: String,
        enum: [
            "draft",
            "estimation_prepared",
            "quotation_sent",
            "quotation_approved",
            "quotation_rejected",
            "lpo_received",
            "team_assigned",
            "work_started",
            "in_progress",
            "work_completed",
            "quality_check",
            "client_handover",
            "final_invoice_sent",
            "payment_received",
            "on_hold",
            "cancelled",
            "project_closed",
        ],
        default: "draft",
    },
    progress: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
    },
    // New date fields
    completionDate: { type: Date },
    handoverDate: { type: Date },
    acceptanceDate: { type: Date },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    updatedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    assignedTo: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    projectNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    assignedWorkers: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: "User",
        },
    ],
    assignedDriver: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    grnNumber: {
        typw: String,
    },
}, { timestamps: true });
projectSchema.index({ projectName: 1 });
projectSchema.index({ client: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ progress: 1 });
exports.Project = (0, mongoose_1.model)("Project", projectSchema);
//# sourceMappingURL=projectModel.js.map