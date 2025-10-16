"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Quotation = void 0;
const mongoose_1 = require("mongoose");
const quotationImageSchema = new mongoose_1.Schema({
    title: { type: String, required: true },
    imageUrl: { type: String, required: true },
    s3Key: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
});
const quotationItemSchema = new mongoose_1.Schema({
    description: {
        type: String,
        required: [true, "Item description is required"],
        trim: true,
    },
    uom: {
        type: String,
        required: [true, "Unit of measurement is required"],
        trim: true,
    },
    quantity: {
        type: Number,
        required: true,
        min: 0,
    },
    unitPrice: {
        type: Number,
        required: true,
        min: 0,
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0,
    },
});
const quotationSchema = new mongoose_1.Schema({
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    estimation: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Estimation",
        required: true,
    },
    quotationNumber: {
        type: String,
        required: true,
        unique: true,
    },
    date: {
        type: Date,
        default: Date.now,
    },
    validUntil: {
        type: Date,
        required: true,
    },
    scopeOfWork: {
        type: [String],
        required: true,
    },
    items: {
        type: [quotationItemSchema],
        required: true,
        validate: {
            validator: (v) => v.length > 0,
            message: "At least one item is required",
        },
    },
    images: [quotationImageSchema],
    subtotal: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
    vatPercentage: {
        type: Number,
        default: 5,
        min: 0,
    },
    vatAmount: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
    netAmount: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
    termsAndConditions: {
        type: [String],
        required: true,
    },
    preparedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    approvedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    isApproved: {
        type: Boolean,
        default: false,
    },
    approvalComment: {
        type: String,
    },
}, { timestamps: true });
quotationSchema.pre("save", function (next) {
    this.subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
    this.vatAmount = this.subtotal * (this.vatPercentage / 100);
    this.netAmount = this.subtotal + this.vatAmount;
    next();
});
quotationSchema.index({ project: 1 });
quotationSchema.index({ estimation: 1 });
quotationSchema.index({ isApproved: 1 });
exports.Quotation = (0, mongoose_1.model)("Quotation", quotationSchema);
//# sourceMappingURL=quotationModel.js.map