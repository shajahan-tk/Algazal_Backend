"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LPO = void 0;
const mongoose_1 = require("mongoose");
const lpoItemSchema = new mongoose_1.Schema({
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
});
const lpoSchema = new mongoose_1.Schema({
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    lpoNumber: {
        type: String,
        required: true,
    },
    lpoDate: {
        type: Date,
        required: true,
    },
    supplier: {
        type: String,
        required: true,
    },
    items: [lpoItemSchema],
    documents: [
        {
            url: { type: String, required: true },
            key: { type: String, required: true },
            name: { type: String, required: true },
            mimetype: { type: String, required: true },
            size: { type: Number, required: true },
        },
    ],
    totalAmount: {
        type: Number,
        required: true,
        min: 0,
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });
// Auto-calculate total amount before saving
lpoSchema.pre("save", function (next) {
    this.totalAmount = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
    next();
});
// Indexes
lpoSchema.index({ lpoNumber: 1 });
lpoSchema.index({ supplier: 1 });
lpoSchema.index({ lpoDate: 1 });
exports.LPO = (0, mongoose_1.model)("LPO", lpoSchema);
//# sourceMappingURL=lpoModel.js.map