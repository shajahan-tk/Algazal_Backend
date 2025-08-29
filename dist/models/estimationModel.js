"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Estimation = void 0;
const mongoose_1 = require("mongoose");
const estimationItemSchema = new mongoose_1.Schema({
    description: { type: String, required: true },
    uom: { type: String, required: true }, // Added UOM field
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
});
const termItemSchema = new mongoose_1.Schema({
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
});
const labourItemSchema = new mongoose_1.Schema({
    designation: { type: String, required: true },
    days: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
});
const estimationSchema = new mongoose_1.Schema({
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    estimationNumber: {
        type: String,
        required: true,
    },
    workStartDate: {
        type: Date,
        required: true,
    },
    workEndDate: {
        type: Date,
        required: true,
        validate: {
            validator: function (value) {
                return value > this.workStartDate;
            },
            message: "Work end date must be after start date",
        },
    },
    validUntil: {
        type: Date,
        required: true,
    },
    paymentDueBy: {
        type: Number,
        required: true,
        min: 0,
    },
    subject: {
        type: String,
    },
    materials: [estimationItemSchema],
    labour: [labourItemSchema],
    termsAndConditions: [termItemSchema],
    estimatedAmount: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
    quotationAmount: {
        type: Number,
        min: 0,
    },
    commissionAmount: {
        type: Number,
        min: 0,
    },
    profit: {
        type: Number,
    },
    preparedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    checkedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    approvedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    isChecked: {
        type: Boolean,
        default: false,
    },
    isApproved: {
        type: Boolean,
        default: false,
    },
    approvalComment: {
        type: String,
    },
}, { timestamps: true });
estimationSchema.pre("save", function (next) {
    const materialsTotal = this.materials.reduce((sum, item) => sum + (item.total || 0), 0);
    const labourTotal = this.labour.reduce((sum, item) => sum + (item.total || 0), 0);
    const termsTotal = this.termsAndConditions.reduce((sum, item) => sum + (item.total || 0), 0);
    this.estimatedAmount = materialsTotal + labourTotal + termsTotal;
    if (this.quotationAmount) {
        this.profit =
            this.quotationAmount -
                this.estimatedAmount -
                (this.commissionAmount || 0);
    }
    next();
});
estimationSchema.index({ project: 1 });
estimationSchema.index({ estimationNumber: 1 });
estimationSchema.index({ isApproved: 1 });
estimationSchema.index({ isChecked: 1 });
estimationSchema.index({ workStartDate: 1 });
estimationSchema.index({ workEndDate: 1 });
exports.Estimation = (0, mongoose_1.model)("Estimation", estimationSchema);
//# sourceMappingURL=estimationModel.js.map