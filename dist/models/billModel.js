"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bill = void 0;
const mongoose_1 = require("mongoose");
const attachmentSchema = new mongoose_1.Schema({
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    filePath: { type: String, required: true },
});
const billSchema = new mongoose_1.Schema({
    billType: {
        type: String,
        required: true,
        enum: [
            "general",
            "fuel",
            "mess",
            "vehicle",
            "accommodation",
            "commission",
        ],
    },
    billDate: { type: Date, required: true },
    paymentMethod: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    attachments: [attachmentSchema],
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    // General Bill Fields
    category: { type: mongoose_1.Schema.Types.ObjectId, ref: "Category" },
    shop: { type: mongoose_1.Schema.Types.ObjectId, ref: "Shop" },
    invoiceNo: { type: String, trim: true },
    remarks: { type: String, trim: true },
    // Fuel Bill Fields
    description: { type: String, trim: true },
    vehicle: { type: mongoose_1.Schema.Types.ObjectId, ref: "Vehicle" },
    kilometer: { type: Number, min: 0 },
    liter: { type: Number, min: 0 },
    // Vehicle Bill Fields
    purpose: { type: String, trim: true },
    vehicles: [{ type: mongoose_1.Schema.Types.ObjectId, ref: "Vehicle" }],
    // Accommodation Bill Fields
    roomNo: { type: String, trim: true },
    note: { type: String, trim: true },
}, { timestamps: true });
// Indexes
billSchema.index({ billType: 1 });
billSchema.index({ billDate: -1 });
billSchema.index({ shop: 1 });
billSchema.index({ vehicle: 1 });
billSchema.index({ vehicles: 1 });
billSchema.index({ amount: 1 });
billSchema.index({ createdBy: 1 });
billSchema.index({ category: 1 });
exports.Bill = (0, mongoose_1.model)("Bill", billSchema);
//# sourceMappingURL=billModel.js.map