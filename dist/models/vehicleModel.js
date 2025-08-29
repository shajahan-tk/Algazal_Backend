"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vehicle = void 0;
const mongoose_1 = require("mongoose");
const attachmentSchema = new mongoose_1.Schema({
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    filePath: { type: String, required: true },
});
const vehicleSchema = new mongoose_1.Schema({
    vehicleNumber: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        uppercase: true,
    },
    vehicleType: {
        type: String,
        required: true,
        enum: ["car", "truck", "van", "pickup", "motorcycle", "other"],
    },
    make: { type: String, required: true, trim: true },
    vechicleModel: { type: String, required: true, trim: true },
    year: {
        type: Number,
        required: true,
        min: 1900,
        max: new Date().getFullYear() + 1,
    },
    color: { type: String, trim: true },
    registrationDate: { type: Date, required: true },
    insuranceExpiry: { type: Date, required: true },
    lastServiceDate: { type: Date },
    currentMileage: { type: Number, default: 0, min: 0 },
    status: {
        type: String,
        enum: ["active", "inactive", "maintenance"],
        default: "active",
    },
    attachments: [attachmentSchema],
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });
// Indexes
vehicleSchema.index({ vehicleNumber: 1 });
vehicleSchema.index({ vehicleType: 1 });
vehicleSchema.index({ status: 1 });
vehicleSchema.index({ make: 1 });
vehicleSchema.index({ model: 1 });
exports.Vehicle = (0, mongoose_1.model)("Vehicle", vehicleSchema);
//# sourceMappingURL=vehicleModel.js.map